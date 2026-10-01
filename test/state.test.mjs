// #9 (project mode) + #13 (global mode, `--global`) acceptance: `banana
// state lint` mechanically verdicts a STATE.md page — FAIL (a mechanical
// invariant is broken), WARN (ambiguous residue a model should look at),
// PASS (neither) — never grading content; every verdict is reproducible
// from file bytes alone. Exit codes: 0 PASS/WARN-only, 1 any FAIL, 2 usage
// error or a missing/unreadable target.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root — used only to read the REAL shipped templates for a couple of
// #20b review item-5 fixtures (the spaced-owner placeholder substitution),
// the same pattern test/state-archive.test.mjs's own KIT_ROOT uses.
const KIT_ROOT_FOR_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..');

import {
  checkActiveThreads,
  checkAsOfMalformed,
  checkAsOfMissing,
  checkBulletWrapped,
  checkClosedExpired,
  checkClosedUndated,
  checkDirtyMarker,
  checkLineOverLimit,
  checkMissingSections,
  checkOverCap,
  checkRetiredHeader,
  checkRetiredHeaderGlobal,
  checkStaleVsLogbook,
  checkStaleVsSessionLog,
  checkThreadInactive,
  checkUnownedBullets,
  classifyOwnerBullet,
  CLOSED_EXPIRY_DAYS,
  collectStateLint,
  DIRTY_MARKER_LINE,
  emitFindings,
  formatStateLintLines,
  globalReferenceDate,
  hasSection,
  isPlaceholderBullet,
  lintGlobalState,
  lintProjectState,
  parseStateArgs,
  prepareText,
  REQUIRED_GLOBAL_SECTIONS,
  REQUIRED_PROJECT_SECTIONS,
  RETIRED_HEADER_RE,
  runStateLint,
  SECTION_LINE_LIMITS,
  STATE_CAP_CHARS,
  THREAD_INACTIVE_DAYS,
  topLevelBullets,
  topLevelBulletContinuationCounts,
} from '../lib/state.mjs';
import { isRealCalendarDate, stateAsOf, stateAsOfMalformed } from '../lib/doctor.mjs';
import { runInit } from '../lib/init.mjs';
import { runProject } from '../lib/project.mjs';
import { sessionLogPath } from '../lib/sessionlog.mjs';

/** @type {string[]} */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// A clean, fully-conformant project STATE.md — every check below starts from
// this baseline and mutates exactly the one thing under test, so a stray
// second finding can never masquerade as the one being asserted on.
const CLEAN_STATE = [
  '# STATE — widget',
  '> Projection of LOGBOOK.md as of 2026-08-10 (through widget.2). Logbook wins',
  '> on conflict. One page, hard cap. Rebuilt at session close; mid-arc',
  '> section patches are legal and must carry the dirty-marker line.',
  '',
  '## Now',
  '- shipping the thing',
  '',
  '## Truths',
  '- decided X — widget.1',
  '',
  '## Next',
  '- testagent — ship the next slice',
  '- ahimsa — review the shipped slice',
  '',
  '## Blocked',
  '- (none)',
  '',
  '## Watch',
  '- an assumption needing validation (validate-by: 2026-09-01)',
  '',
  '## Dead ends',
  '- (none yet)',
  '',
].join('\n');

const CLEAN_LOGBOOK = [
  '# LOGBOOK — widget',
  '',
  '## [2026-08-10] testagent widget.1 | SESSION — first entry',
  'WHAT: did the thing',
  'NEXT: testagent — ship the next slice',
  '',
].join('\n');

const SEED_SESSION_LOG =
  '# Session log — task-grain work journal (Session Log v2)\n' +
  '> Append-only. Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`\n' +
  '\n## [2026-08-10] testagent widget.1 | build — first entry\nSTATUS: complete\nNEXT: testagent — ship the next slice\n';

const FRESH_STATE = [
  '# STATE — (project)',
  '> Projection of LOGBOOK.md as of (date) (through none). Logbook wins',
  '> on conflict. One page, hard cap. Rebuilt at session close; mid-arc',
  '> section patches are legal and must carry the dirty-marker line.',
  '',
  '## Now',
  '- (current focus, 1–3 lines)',
  '',
  '## Truths',
  '- (decisions in force, one line each + logbook id — pointers, not rationale)',
  '',
  '## Next',
  '- __OWNER__ — (owned actions only; unowned items are not allowed here)',
  '',
  '## Blocked',
  '- (what, on whom/what, since when)',
  '',
  '## Watch',
  '- (assumptions needing validation, each with a validate-by date)',
  '',
  '## Dead ends',
  '- (approaches tried and abandoned, one line each + why, or an entry pointer)',
  '',
].join('\n');

/** @param {import('node:test').TestContext} t */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param {import('node:test').TestContext} t
 * @param {{ state?: string | null, logbook?: string | null, sessionLog?: string | null }} [opts]
 */
function makeProject(t, opts = {}) {
  const { state = CLEAN_STATE, logbook = CLEAN_LOGBOOK, sessionLog = SEED_SESSION_LOG } = opts;
  const dir = sandbox(t);
  if (state !== null) writeFileSync(join(dir, 'STATE.md'), state, 'utf8');
  if (logbook !== null) writeFileSync(join(dir, 'LOGBOOK.md'), logbook, 'utf8');
  mkdirSync(join(dir, '.agents'), { recursive: true });
  if (sessionLog !== null) writeFileSync(sessionLogPath(dir), sessionLog, 'utf8');
  return dir;
}

function makeIo() {
  /** @type {string[]} */
  const out = [];
  return { out: (/** @type {string} */ l = '') => out.push(l), err: (/** @type {string} */ l = '') => out.push(l), lines: out };
}

/**
 * @param {string} cwd
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
async function run(cwd) {
  const io = makeIo();
  const result = await runStateLint({ verb: 'lint', global: false }, { cwd, io, home: cwd });
  return { code: result.code, lines: io.lines };
}

/**
 * @param {string} home
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
async function runGlobal(home) {
  const io = makeIo();
  // cwd is irrelevant in global mode — never read — passed as home itself
  // so a stray project-mode code path would trip on it, not silently pass.
  const result = await runStateLint({ verb: 'lint', global: true }, { cwd: home, io, home });
  return { code: result.code, lines: io.lines };
}

/** Pad CLEAN_STATE's Now bullet with filler so its total length is exactly targetLen. */
function stateWithLength(targetLen) {
  const marker = '- shipping the thing';
  const extra = targetLen - CLEAN_STATE.length;
  assert.ok(extra >= 1, `stateWithLength: targetLen ${targetLen} too small for base ${CLEAN_STATE.length}`);
  const pad = 'x'.repeat(extra - 1);
  return CLEAN_STATE.replace(marker, `${marker} ${pad}`);
}

// =====================================================================
// parseStateArgs
// =====================================================================

test('parseStateArgs: missing verb throws', () => {
  assert.throws(() => parseStateArgs([]), /missing verb \(expected lint\|archive\)/);
});

test('parseStateArgs: unknown verb names the vocabulary', () => {
  assert.throws(() => parseStateArgs(['frobnicate']), /unknown state verb 'frobnicate' \(expected lint\|archive\)/);
});

test('parseStateArgs: bare `lint` defaults global to false', () => {
  assert.deepEqual(parseStateArgs(['lint']), { verb: 'lint', global: false });
});

test('parseStateArgs: `lint --global` sets global to true', () => {
  assert.deepEqual(parseStateArgs(['lint', '--global']), { verb: 'lint', global: true });
});

test('parseStateArgs: any other unknown flag is rejected the same way', () => {
  assert.throws(() => parseStateArgs(['lint', '--bogus']), /unknown option '--bogus'/);
});

// =====================================================================
// parseStateArgs archive: #20b review item 2 — hardening the value-flag
// grammar. The motivating bug: `--tag --dry-run` used to read '--dry-run'
// as the literal tag value and silently proceed with a REAL move. A
// baseline valid archive args array is reused below so each test mutates
// exactly the one thing under test.
// =====================================================================

const VALID_ARCHIVE_ARGS = ['archive', '--global', '--match', 'x', '--reason', 'expired', '--tag', 'testagent'];

test('parseStateArgs archive: the baseline parses (sanity control for the hardening tests below)', () => {
  assert.deepEqual(parseStateArgs(VALID_ARCHIVE_ARGS), {
    verb: 'archive',
    global: true,
    match: 'x',
    reason: 'expired',
    tag: 'testagent',
    dryRun: false,
  });
});

test('parseStateArgs archive: a value flag immediately followed by another flag throws, not silently takes it as the value', () => {
  // The exact motivating bug: `--tag --dry-run` must not read '--dry-run' as the tag.
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'expired', '--tag', '--dry-run']),
    /--tag requires a value/,
  );
});

test('parseStateArgs archive: an empty-string value throws', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', '', '--reason', 'expired', '--tag', 'testagent']),
    /--match requires a non-empty value/,
  );
});

test('parseStateArgs archive: a value starting with "--" throws even when it is not a KNOWN flag', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', '--bogus-not-a-real-flag', '--tag', 'testagent']),
    /--reason requires a value/,
  );
});

test('parseStateArgs archive: a value containing a CR or LF throws', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'line one\nline two', '--reason', 'expired', '--tag', 'testagent']),
    /--match value may not contain a line break/,
  );
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'expired', '--tag', 'a\rb']),
    /--tag value may not contain a line break/,
  );
});

test('parseStateArgs archive: a repeated value flag throws', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--match', 'y', '--reason', 'expired', '--tag', 'testagent']),
    /--match may only be given once/,
  );
});

// =====================================================================
// classifyOwnerBullet — owner matcher, every real shape from the spec
// =====================================================================

test('classifyOwnerBullet: bold-wrapped owner with a colon-bearing action is owned', () => {
  assert.equal(
    classifyOwnerBullet('- **ahimsa — piece-a: proceed once review ships**'),
    'owned',
  );
});

test('classifyOwnerBullet: plain owner with a bold-wrapped action tail is owned', () => {
  assert.equal(classifyOwnerBullet('- Kit-Owner — **SOLO LANE, do not parallelize**'), 'owned');
});

test('classifyOwnerBullet: slash-joined bold-wrapped owner is owned', () => {
  assert.equal(classifyOwnerBullet('- **ahimsa/editor — SAVE the draft before closing**'), 'owned');
});

test('classifyOwnerBullet: plus-joined plain owner is owned', () => {
  assert.equal(classifyOwnerBullet('- ahimsa+testagent — pair on the migration'), 'owned');
});

test('classifyOwnerBullet: the joint tag is owned', () => {
  assert.equal(classifyOwnerBullet('- joint — dark-dump on its own clock'), 'owned');
});

test('classifyOwnerBullet: bold-wrapped literal "unowned" owner is unowned (FAIL shape)', () => {
  assert.equal(classifyOwnerBullet('- **unowned** — Packet 4 needs a claimant'), 'unowned');
});

test('classifyOwnerBullet: "unowned" is case-insensitive and works unwrapped', () => {
  assert.equal(classifyOwnerBullet('- Unowned — pick this up'), 'unowned');
});

test('classifyOwnerBullet: the literal unsubstituted __OWNER__ bootstrap placeholder is unowned', () => {
  assert.equal(
    classifyOwnerBullet('- __OWNER__ — (owned actions only; unowned items are not allowed here)'),
    'unowned',
  );
});

test('classifyOwnerBullet: no em-dash at all is unowned', () => {
  assert.equal(classifyOwnerBullet('- just a prose sentence with no separator'), 'unowned');
});

test('classifyOwnerBullet: an owner token that itself contains an em-dash is unowned', () => {
  assert.equal(classifyOwnerBullet('- a—b — c'), 'unowned');
});

// F2 (review hardening 2026-09-28): a placeholder is ONLY a bullet whose
// full text is byte-equal (after trim) to a real, shipped template bullet —
// "starts with (" alone is no longer sufficient (that was the bug: a real,
// content-bearing bullet that happens to open with a parenthetical was
// wrongly exempted from every check).
test('classifyOwnerBullet: a bullet that merely starts with "(" but is NOT a real template bullet is checked normally, not exempted', () => {
  // Real content shaped like the old (buggy) exemption trigger: neither of
  // these is byte-equal to any shipped template bullet.
  assert.equal(classifyOwnerBullet('- (paused) rebuild the projection'), 'unowned');
  assert.equal(classifyOwnerBullet('- **(new)** rebuild the projection'), 'unowned');
});

test('classifyOwnerBullet: the REAL shipped template placeholder bullets are recognized as placeholders', () => {
  assert.equal(
    classifyOwnerBullet('- __OWNER__ — (owned actions only; unowned items are not allowed here)'),
    // The pre-strip literal __OWNER__ check fires first — still 'unowned',
    // per F7's explicit "keep your pre-strip check too" instruction — see
    // the dedicated __OWNER__ test above. Placeholder-recognition for THIS
    // exact template line is covered via isPlaceholderBullet directly below,
    // since classifyOwnerBullet intentionally short-circuits it to 'unowned'.
    'unowned',
  );
  assert.ok(isPlaceholderBullet('- __OWNER__ — (owned actions only; unowned items are not allowed here)'));
  assert.ok(isPlaceholderBullet('- (what, on whom/what, since when)'));
});

// =====================================================================
// topLevelBullets — indentation, blank lines, prose, ### sub-headings, bounding
// =====================================================================

test('topLevelBullets: only unindented -/* bullets count, bounded to the next ## heading', () => {
  const text = [
    '## Next',
    '- testagent — top-level, included',
    '  - indented sub-bullet, excluded',
    'prose line, excluded',
    '',
    '### Sub-heading, excluded as a bullet',
    '* ahimsa — asterisk bullets count too',
    '## Blocked',
    '- testagent — must not appear, past the boundary',
  ].join('\n');
  assert.deepEqual(topLevelBullets(text, 'Next'), [
    '- testagent — top-level, included',
    '* ahimsa — asterisk bullets count too',
  ]);
});

test('topLevelBullets: a missing heading returns no bullets', () => {
  assert.deepEqual(topLevelBullets('## Other\n- x — y\n', 'Next'), []);
});

test('topLevelBullets: a qualified heading ("## Next (owned)") still locates the section', () => {
  const text = ['## Next (owned)', '- testagent — top-level', '## Blocked'].join('\n');
  assert.deepEqual(topLevelBullets(text, 'Next'), ['- testagent — top-level']);
});

// =====================================================================
// hasSection — Fix A: qualifier-tolerant heading matcher (2026-09-28,
// phase-1 smoke exposed false-positive missing-section on real pages)
// =====================================================================

test('hasSection: real qualified headings from the phase-1 smoke count as present', () => {
  assert.ok(hasSection('## Truths (durable studio doctrine)\n- x\n', 'Truths'));
  assert.ok(hasSection('## Watch (tripwires — mirrored as ADR revisit-triggers)\n- x\n', 'Watch'));
  assert.ok(hasSection('## Watch (all dormant; re-arm on revival)\n- x\n', 'Watch'));
});

test('hasSection: a name-glued suffix (no separating whitespace) does not count', () => {
  assert.ok(!hasSection('## Watchlist\n- x\n', 'Watch'));
  assert.ok(!hasSection('## Nextsteps\n- x\n', 'Next'));
});

test('hasSection: an unqualified exact heading still counts (backward compatible)', () => {
  assert.ok(hasSection('## Watch\n- x\n', 'Watch'));
});

// =====================================================================
// checkUnownedBullets — the owner matcher wired to a real section
// =====================================================================

test('checkUnownedBullets: owned bullets on the clean fixture produce no findings', () => {
  assert.deepEqual(checkUnownedBullets(CLEAN_STATE, 'Next', 'unowned-next'), []);
});

test('checkUnownedBullets: one FAIL per unowned top-level bullet, tagged with the given type', () => {
  const text = ['## Next', '- testagent — owned', '- unowned — no claimant', '## Blocked'].join('\n');
  const findings = checkUnownedBullets(text, 'Next', 'unowned-next');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'unowned-next');
  assert.ok(findings[0].message.includes('unowned — no claimant'));
});

test('checkUnownedBullets: a qualified "## Next (owned)" heading is still scanned — a qualifier must not silently skip the unowned-bullet scan', () => {
  const text = ['## Next (owned)', '- testagent — owned', '- unowned — no claimant', '## Blocked'].join('\n');
  const findings = checkUnownedBullets(text, 'Next', 'unowned-next');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unowned-next');
  assert.ok(findings[0].message.includes('unowned — no claimant'));
});

// =====================================================================
// checkMissingSections
// =====================================================================

test('checkMissingSections: all six present on the clean fixture is empty', () => {
  assert.deepEqual(checkMissingSections(CLEAN_STATE, REQUIRED_PROJECT_SECTIONS), []);
});

test('checkMissingSections: one finding per missing section, trailing whitespace still counts as present', () => {
  const withTrailingSpace = CLEAN_STATE.replace('## Watch', '## Watch   ');
  const missingTwo = withTrailingSpace.replace('## Blocked\n- (none)\n\n', '').replace('## Dead ends\n- (none yet)\n', '');
  const findings = checkMissingSections(missingTwo, REQUIRED_PROJECT_SECTIONS);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.tier === 'FAIL' && f.type === 'missing-section'));
  assert.ok(findings.some((f) => f.message.includes('## Blocked')));
  assert.ok(findings.some((f) => f.message.includes('## Dead ends')));
});

test('checkMissingSections: qualified real-page headings (Truths/Watch parenthetical suffixes) all count as present', () => {
  const text = [
    '## Now', '- x',
    '## Truths (durable studio doctrine)', '- x',
    '## Next', '- testagent — x',
    '## Blocked', '- x',
    '## Watch (tripwires — mirrored as ADR revisit-triggers)', '- x',
    '## Dead ends', '- x',
  ].join('\n');
  assert.deepEqual(checkMissingSections(text, REQUIRED_PROJECT_SECTIONS), []);
});

test('checkMissingSections: a glued suffix ("## Watchlist", "## Nextsteps") does NOT satisfy Watch/Next', () => {
  const text = [
    '## Now', '- x',
    '## Truths', '- x',
    '## Nextsteps', '- x',
    '## Blocked', '- x',
    '## Watchlist', '- x',
    '## Dead ends', '- x',
  ].join('\n');
  const findings = checkMissingSections(text, REQUIRED_PROJECT_SECTIONS);
  const messages = findings.map((f) => f.message);
  assert.ok(messages.some((m) => m.includes('## Next')), `expected a Next finding: ${messages}`);
  assert.ok(messages.some((m) => m.includes('## Watch')), `expected a Watch finding: ${messages}`);
  assert.equal(findings.length, 2);
});

// =====================================================================
// checkOverCap — exact boundary
// =====================================================================

test('checkOverCap: exactly at STATE_CAP_CHARS passes', () => {
  const text = stateWithLength(STATE_CAP_CHARS);
  assert.equal(text.length, STATE_CAP_CHARS);
  assert.deepEqual(checkOverCap(text), []);
});

test('checkOverCap: one char over STATE_CAP_CHARS fails', () => {
  const text = stateWithLength(STATE_CAP_CHARS + 1);
  assert.equal(text.length, STATE_CAP_CHARS + 1);
  const findings = checkOverCap(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'over-cap');
  assert.ok(findings[0].message.includes(String(STATE_CAP_CHARS + 1)));
  assert.ok(findings[0].message.includes(String(STATE_CAP_CHARS)));
});

// =====================================================================
// checkAsOfMissing — the fresh-page exception
// =====================================================================

test('checkAsOfMissing: a real date present is never flagged', () => {
  assert.deepEqual(checkAsOfMissing(CLEAN_STATE, '2026-08-10', true), []);
});

test('checkAsOfMissing: bootstrap placeholder with no logbook entries is a fresh page, not a finding', () => {
  assert.deepEqual(checkAsOfMissing(FRESH_STATE, null, false), []);
});

test('checkAsOfMissing: bootstrap placeholder WITH >=1 logbook entry is a defect', () => {
  const findings = checkAsOfMissing(FRESH_STATE, null, true);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'as-of-missing');
});

test('checkAsOfMissing: a mangled header with neither a date nor the placeholder is a defect regardless of the logbook', () => {
  const mangled = CLEAN_STATE.replace('as of 2026-08-10 ', '');
  assert.equal(checkAsOfMissing(mangled, null, false).length, 1);
  assert.equal(checkAsOfMissing(mangled, null, true).length, 1);
});

// =====================================================================
// checkStaleVsLogbook / checkStaleVsSessionLog — equal-passes boundary
// =====================================================================

test('checkStaleVsLogbook: equal dates pass', () => {
  assert.deepEqual(checkStaleVsLogbook('2026-08-10', '2026-08-10'), []);
});

test('checkStaleVsLogbook: as-of one day older than the newest logbook entry fails', () => {
  const findings = checkStaleVsLogbook('2026-08-09', '2026-08-10');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'stale-vs-logbook');
  assert.ok(findings[0].message.includes('2026-08-09'));
  assert.ok(findings[0].message.includes('2026-08-10'));
});

test('checkStaleVsLogbook: null asOf or null newest never fires (nothing to compare)', () => {
  assert.deepEqual(checkStaleVsLogbook(null, '2026-08-10'), []);
  assert.deepEqual(checkStaleVsLogbook('2026-08-10', null), []);
});

test('checkStaleVsSessionLog: equal dates pass', () => {
  assert.deepEqual(checkStaleVsSessionLog('2026-08-10', '2026-08-10'), []);
});

test('checkStaleVsSessionLog: as-of one day older than the newest session.log entry warns (not fails)', () => {
  const findings = checkStaleVsSessionLog('2026-08-09', '2026-08-10');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'stale-vs-session-log');
});

// =====================================================================
// checkDirtyMarker / checkRetiredHeader
// =====================================================================

test('checkDirtyMarker: absent on the clean fixture', () => {
  assert.deepEqual(checkDirtyMarker(CLEAN_STATE), []);
});

test('checkDirtyMarker: a standing marker line warns', () => {
  const withMarker = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE}`,
  );
  const findings = checkDirtyMarker(withMarker);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'dirty-marker');
});

test('checkRetiredHeader: absent on the clean fixture', () => {
  assert.deepEqual(checkRetiredHeader(CLEAN_STATE), []);
});

test('checkRetiredHeader: the pre-amendment phrase in the header warns, case-insensitively', () => {
  const retired = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'Rebuilt whole, never patched. Not mid-arc',
  );
  const findings = checkRetiredHeader(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

// #11 slice A: the retired rule shipped in more than one wording on real
// installed pages (ADR 0001's own history) — these pin the sentence-shape
// match (word "rebuilt", then "never patched" before the next period)
// rather than the one literal string the pattern used to require.

test('checkRetiredHeader: "Rebuilt, never patched." (no "whole") warns', () => {
  const retired = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'Rebuilt, never patched. Not mid-arc',
  );
  assert.notEqual(retired, CLEAN_STATE, 'sanity: the replace must actually hit');
  const findings = checkRetiredHeader(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeader: "Rebuilt from the logbook, never patched." (historical canon wording) warns', () => {
  const retired = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'Rebuilt from the logbook, never patched. Not mid-arc',
  );
  assert.notEqual(retired, CLEAN_STATE, 'sanity: the replace must actually hit');
  const findings = checkRetiredHeader(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeader: a blockquote line wrap between "rebuilt" and "never patched" still warns', () => {
  const retired = CLEAN_STATE.replace(
    '> on conflict. One page, hard cap. Rebuilt at session close; mid-arc\n' +
      '> section patches are legal and must carry the dirty-marker line.',
    '> on conflict. One page, hard cap. Rebuilt whole,\n> never patched.',
  );
  assert.notEqual(retired, CLEAN_STATE, 'sanity: the replace must actually hit');
  const findings = checkRetiredHeader(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeader: upper case "REBUILT, NEVER PATCHED." warns', () => {
  const retired = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'REBUILT, NEVER PATCHED. Not mid-arc',
  );
  assert.notEqual(retired, CLEAN_STATE, 'sanity: the replace must actually hit');
  const findings = checkRetiredHeader(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeader: "never patched" with no "rebuilt" in the same sentence does not warn', () => {
  const text = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'The log is never patched. Not mid-arc',
  );
  assert.notEqual(text, CLEAN_STATE, 'sanity: the replace must actually hit');
  assert.deepEqual(checkRetiredHeader(text), []);
  assert.ok(!RETIRED_HEADER_RE.test(text));
});

test('checkRetiredHeader: "rebuilt" and "never patched" split across a sentence boundary does not warn', () => {
  const text = CLEAN_STATE.replace(
    'Rebuilt at session close; mid-arc',
    'Rebuilt at close. Old copies were never patched. Not mid-arc',
  );
  assert.notEqual(text, CLEAN_STATE, 'sanity: the replace must actually hit');
  assert.deepEqual(checkRetiredHeader(text), []);
  assert.ok(!RETIRED_HEADER_RE.test(text));
});

// #11 Part 1b (regression from Part 1): the widened sentence-shape pattern
// must only fire on the page's own HEADER, not on a body bullet that merely
// discusses or quotes the retired rule in prose.
test('checkRetiredHeader: a body bullet describing the retired rule (not the page\'s own header) does not warn', () => {
  const withBodyMention = CLEAN_STATE.replace(
    '- decided X — widget.1',
    '- decided X — widget.1\n- the old header said pages are rebuilt whole and never patched',
  );
  assert.notEqual(withBodyMention, CLEAN_STATE, 'sanity: the replace must actually hit');
  assert.ok(RETIRED_HEADER_RE.test(withBodyMention), 'sanity: the body text DOES contain the phrase');
  assert.deepEqual(checkRetiredHeader(withBodyMention), []);
});

// checkRetiredHeaderGlobal (#15, ADR 0005): the global-grain counterpart —
// same RETIRED_HEADER_RE, different migration target (per-thread edits, not
// rebuild-on-close).

test('checkRetiredHeaderGlobal: absent on the clean global fixture (new header)', () => {
  assert.deepEqual(checkRetiredHeaderGlobal(CLEAN_GLOBAL), []);
});

test('checkRetiredHeaderGlobal: the pre-amendment phrase warns, case-insensitively, pointing at ADR 0005', () => {
  const retired = CLEAN_GLOBAL.replace(
    'Edit only your own threads; never rewrite the page.',
    'Rebuilt whole, never patched.',
  );
  const findings = checkRetiredHeaderGlobal(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(findings[0].message.includes('ADR 0005'));
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeaderGlobal: "Rebuilt, never patched." (no "whole") warns, pointing at ADR 0005', () => {
  const retired = CLEAN_GLOBAL.replace(
    'Edit only your own threads; never rewrite the page.',
    'Rebuilt, never patched.',
  );
  assert.notEqual(retired, CLEAN_GLOBAL, 'sanity: the replace must actually hit');
  const findings = checkRetiredHeaderGlobal(retired);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
  assert.ok(findings[0].message.includes('ADR 0005'));
  assert.ok(RETIRED_HEADER_RE.test(retired));
});

test('checkRetiredHeaderGlobal: a body bullet describing the retired rule under "## Active threads" does not warn', () => {
  const withBodyMention = CLEAN_GLOBAL.replace(
    '## Active threads\n- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`',
    '## Active threads\n- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`\n' +
      '- **beta** (as of 2026-09-01) — old pages said pages are rebuilt whole and never patched → `~/projects/beta/STATE.md`',
  );
  assert.notEqual(withBodyMention, CLEAN_GLOBAL, 'sanity: the replace must actually hit');
  assert.ok(RETIRED_HEADER_RE.test(withBodyMention), 'sanity: the body text DOES contain the phrase');
  assert.deepEqual(checkRetiredHeaderGlobal(withBodyMention), []);
});

// =====================================================================
// emitFindings — tier ordering, summary line, exit code
// =====================================================================

test('emitFindings: no findings prints PASS and exits 0', () => {
  const io = makeIo();
  const result = emitFindings(io, [], 'STATE.md');
  assert.equal(result.code, 0);
  assert.deepEqual(io.lines, ['state lint: PASS']);
});

test('emitFindings: WARN-only prints the WARN summary and exits 0', () => {
  const io = makeIo();
  const result = emitFindings(io, [{ tier: 'WARN', type: 'dirty-marker', message: 'm' }], 'STATE.md');
  assert.equal(result.code, 0);
  assert.deepEqual(io.lines, ['WARN [dirty-marker] STATE.md: m', 'state lint: WARN (1 warn)']);
});

test('emitFindings: any FAIL prints FAILs before WARNs and exits 1', () => {
  const io = makeIo();
  const result = emitFindings(
    io,
    [
      { tier: 'WARN', type: 'dirty-marker', message: 'w' },
      { tier: 'FAIL', type: 'over-cap', message: 'f' },
    ],
    'STATE.md',
  );
  assert.equal(result.code, 1);
  assert.deepEqual(io.lines, [
    'FAIL [over-cap] STATE.md: f',
    'WARN [dirty-marker] STATE.md: w',
    'state lint: FAIL (1 fail, 1 warn)',
  ]);
});

// =====================================================================
// lintProjectState — composition sanity (each check wired in)
// =====================================================================

test('lintProjectState: the clean fixture has zero findings', () => {
  assert.deepEqual(lintProjectState(CLEAN_STATE, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] }), []);
});

// =====================================================================
// runStateLint — end-to-end tiers, exit codes, missing target
// =====================================================================

test('runStateLint: a fully clean project is PASS, exit 0', async (t) => {
  const res = await run(makeProject(t));
  assert.equal(res.code, 0);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

test('runStateLint: WARN-only (standing dirty marker) exits 0', async (t) => {
  const withMarker = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE}`,
  );
  const res = await run(makeProject(t, { state: withMarker }));
  assert.equal(res.code, 0);
  assert.ok(res.lines.some((l) => l.startsWith('WARN [dirty-marker]')));
  assert.ok(res.lines.at(-1)?.startsWith('state lint: WARN'));
});

test('runStateLint: FAIL-only (missing sections) exits 1', async (t) => {
  const broken = CLEAN_STATE.replace('## Blocked\n- (none)\n\n', '');
  const res = await run(makeProject(t, { state: broken }));
  assert.equal(res.code, 1);
  assert.ok(res.lines.some((l) => l.startsWith('FAIL [missing-section]')));
  assert.ok(res.lines.at(-1)?.startsWith('state lint: FAIL'));
});

test('runStateLint: mixed FAIL + WARN exits 1, FAILs printed before WARNs', async (t) => {
  const broken = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE}`,
  ).replace('## Blocked\n- (none)\n\n', '');
  const res = await run(makeProject(t, { state: broken }));
  assert.equal(res.code, 1);
  const failIdx = res.lines.findIndex((l) => l.startsWith('FAIL'));
  const warnIdx = res.lines.findIndex((l) => l.startsWith('WARN'));
  assert.ok(failIdx !== -1 && warnIdx !== -1 && failIdx < warnIdx);
});

test('runStateLint: a missing STATE.md exits 2', async (t) => {
  const res = await run(makeProject(t, { state: null }));
  assert.equal(res.code, 2);
  assert.ok(res.lines.some((l) => l.includes('missing or unreadable')));
});

test('runStateLint: LOGBOOK.md and .agents/session.log are optional — absent, still PASS', async (t) => {
  const res = await run(makeProject(t, { logbook: null, sessionLog: null }));
  assert.equal(res.code, 0);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

test('runStateLint: a fresh bootstrap page with no logbook entries is PASS on as-of, even though its Next placeholder is unowned', async (t) => {
  const res = await run(makeProject(t, { state: FRESH_STATE, logbook: null, sessionLog: null }));
  // as-of-missing must NOT fire (fresh-page exception); unowned-next DOES
  // fire, since the placeholder bullet has no real single-token owner.
  assert.ok(!res.lines.some((l) => l.includes('as-of-missing')));
  assert.ok(res.lines.some((l) => l.startsWith('FAIL [unowned-next]')));
  assert.equal(res.code, 1);
});

test('runStateLint: as-of stale vs LOGBOOK.md fails; as-of stale vs session.log only warns', async (t) => {
  const staleState = CLEAN_STATE.replace('as of 2026-08-10', 'as of 2026-08-01');
  const res = await run(makeProject(t, { state: staleState }));
  assert.ok(res.lines.some((l) => l.startsWith('FAIL [stale-vs-logbook]')));
  assert.ok(res.lines.some((l) => l.startsWith('WARN [stale-vs-session-log]')));
  assert.equal(res.code, 1);
});

test('runStateLint: CRLF-normalized length decides over-cap, not raw byte length', async (t) => {
  // A CLEAN_STATE padded to exactly STATE_CAP_CHARS in LF form would read as
  // STATE_CAP_CHARS + (line count) raw bytes once every \n becomes \r\n —
  // proving the cap is measured post-normalization, per the spec.
  const lfText = stateWithLength(STATE_CAP_CHARS);
  const crlfText = lfText.replace(/\n/g, '\r\n');
  assert.ok(crlfText.length > STATE_CAP_CHARS, 'sanity: raw CRLF bytes exceed the cap');
  const res = await run(makeProject(t, { state: crlfText }));
  assert.ok(!res.lines.some((l) => l.startsWith('FAIL [over-cap]')), `should pass post-normalization: ${res.lines}`);
});

test('runStateLint: a CRLF dirty-marker line is still byte-equal after normalization', async (t) => {
  const withMarker = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE}`,
  );
  const crlfText = withMarker.replace(/\n/g, '\r\n');
  const res = await run(makeProject(t, { state: crlfText }));
  assert.ok(res.lines.some((l) => l.startsWith('WARN [dirty-marker]')), `expected dirty-marker WARN: ${res.lines}`);
});

// =====================================================================
// Fix B (2026-09-28): fresh-page positive control. A project bootstrapped
// through the REAL `banana project` code path (templates/project-STATE.md +
// its actual __OWNER__/  (project) substitution, not a hand-copied fixture)
// with a single-token owner and no logbook entries must lint clean — the
// same shape the as-of-missing and unowned-next fresh-page reasoning both
// assume, proven against the real writer instead of a re-typed stand-in.
// =====================================================================

test('runStateLint: a project bootstrapped by the real `banana project` command lints clean', async (t) => {
  const dir = sandbox(t);
  const projectIo = {
    out: () => {},
    err: () => {},
    prompt: async () => {
      throw new Error('prompt not expected in this test — owner is provided and yes:true');
    },
  };
  const projectResult = await runProject(
    { owner: 'testagent', tag: null, yes: true },
    { cwd: dir, io: projectIo, isTTY: false, gitUserName: () => null },
  );
  assert.equal(projectResult.code, 0, 'banana project itself must succeed to set up this control');
  assert.ok(projectResult.created.some((p) => p.endsWith('STATE.md')), 'banana project must have written STATE.md');

  const res = await run(dir);
  assert.equal(res.code, 0, `expected a clean bootstrap to PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// =====================================================================
// Global mode (#13, `--global`) — fixtures + helpers. Public-repo hygiene:
// every fixture below is synthetic (invented projects `alpha`/`beta`/`gamma`,
// no real project/person/machine names) but keeps the real trigger SHAPES:
// backticked `~/`-relative pointers, `~\` Windows-style, absolute `X:\…`
// paths, a memory-file pointer, and a directory pointer.
// =====================================================================

const CLEAN_GLOBAL = [
  '# GLOBAL STATE — cross-project projection',
  '> One page, hard cap. Edit only your own threads; never rewrite the page.',
  '> Chronology lives in project logbooks; this file only answers "what\'s live and',
  '> what\'s queued across everything." Owner: testagent. Protocol:',
  '> `~/.agents/canon/CONTINUITY.md`.',
  '',
  '## Active threads',
  '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`',
  '',
  '## Backlog (owned)',
  '- testagent — sweep the backlog',
  '',
  '## Watch',
  '- an assumption needing validation (validate-by: 2026-10-01)',
  '',
  '## Recently closed (context for next session)',
  // #20: carries a valid, non-expired (closed YYYY-MM-DD) stamp — same date
  // as alpha's own (as of) stamp, so this fixture stays a true zero-findings
  // baseline under the new line-over-limit/closed-undated/closed-expired/
  // thread-inactive checks too (reference date = 2026-09-01 either way).
  '- gamma finished (closed 2026-09-01) — see alpha\'s logbook',
  '',
].join('\n');

const FRESH_GLOBAL = [
  '# GLOBAL STATE — cross-project projection',
  '> One page, hard cap. Edit only your own threads; never rewrite the page.',
  '> Chronology lives in project logbooks; this file only answers "what\'s live and',
  '> what\'s queued across everything." Owner: testagent. Protocol:',
  '> `~/.agents/canon/CONTINUITY.md`.',
  '',
  '## Active threads',
  '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)',
  '',
  '## Backlog (owned)',
  '- (queued cross-project items, each owned: `testagent — action` or an agent tag)',
  '',
  '## Watch',
  '- (assumptions and deadlines needing attention, each with a validate-by date)',
  '',
  '## Recently closed (context for next session)',
  '- (last few finished threads, one line each, with pointers)',
  '',
].join('\n');

/**
 * A fresh sandbox home with `.agents/STATE.md` = text.
 * @param {import('node:test').TestContext} t
 * @param {string} text
 * @returns {string} the home dir
 */
function makeGlobalHome(t, text) {
  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'STATE.md'), text, 'utf8');
  return home;
}

/**
 * Write a target project STATE.md at an arbitrary absolute path (parent
 * dirs created as needed) — for pointer-resolution fixtures.
 * @param {string} path
 * @param {string | null} asOfDate null = keep the bootstrap placeholder (undated)
 */
function makeTargetState(path, asOfDate) {
  mkdirSync(dirname(path), { recursive: true });
  const text =
    asOfDate === null
      ? '# STATE — target\n> Projection of LOGBOOK.md as of (date) (through none). Logbook wins\n'
      : `# STATE — target\n> Projection of LOGBOOK.md as of ${asOfDate} (through target.1). Logbook wins\n`;
  writeFileSync(path, text, 'utf8');
}

// =====================================================================
// isPlaceholderBullet — shared by the owner matcher and Active-threads
// =====================================================================

test('isPlaceholderBullet: the real Active-threads/Backlog placeholder texts are placeholders', () => {
  assert.ok(
    isPlaceholderBullet(
      '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)',
    ),
  );
  assert.ok(isPlaceholderBullet('- (queued cross-project items, each owned: `testagent — action` or an agent tag)'));
});

test('isPlaceholderBullet: a real thread bullet is not a placeholder', () => {
  assert.ok(!isPlaceholderBullet('- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`'));
});

// =====================================================================
// checkMissingSections (global names) — the parenthetical is part of the
// required name, not an optional qualifier
// =====================================================================

test('checkMissingSections: the clean global fixture has all four sections', () => {
  assert.deepEqual(checkMissingSections(CLEAN_GLOBAL, REQUIRED_GLOBAL_SECTIONS), []);
});

test('checkMissingSections: a bare "## Recently closed" does NOT satisfy "Recently closed (context for next session)"', () => {
  const text = [
    '## Active threads', '- x',
    '## Backlog (owned)', '- x',
    '## Watch', '- x',
    '## Recently closed', '- x',
  ].join('\n');
  const findings = checkMissingSections(text, REQUIRED_GLOBAL_SECTIONS);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('Recently closed (context for next session)'));
});

// =====================================================================
// checkOverCap wiring (global) — same shared function as project mode;
// this proves lintGlobalState actually calls it, not just that checkOverCap
// itself works (already mutation-tested in phase 1).
// =====================================================================

test('lintGlobalState: a page over STATE_CAP_CHARS FAILs over-cap through the composed findings', (t) => {
  const marker = '- an assumption needing validation (validate-by: 2026-10-01)';
  const extra = STATE_CAP_CHARS + 1 - CLEAN_GLOBAL.length;
  assert.ok(extra >= 1, 'sanity: CLEAN_GLOBAL is small enough to pad past the cap');
  const padded = CLEAN_GLOBAL.replace(marker, `${marker} ${'x'.repeat(extra - 1)}`);
  assert.equal(padded.length, STATE_CAP_CHARS + 1);
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const findings = lintGlobalState(padded, { home });
  assert.ok(findings.some((f) => f.type === 'over-cap'), `expected an over-cap finding: ${JSON.stringify(findings)}`);
});

// =====================================================================
// checkActiveThreads — thread-unstamped / thread-no-pointer / thread-stale
// (FAIL), thread-unverifiable / thread-target-undated (WARN)
// =====================================================================

test('checkActiveThreads: a placeholder bullet is skipped entirely', () => {
  assert.deepEqual(checkActiveThreads(FRESH_GLOBAL, '/nonexistent/home'), []);
});

test('checkActiveThreads: stamped + pointer resolving to a target at the SAME as-of date passes (equal-passes boundary)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`';
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('checkActiveThreads: stamp one day older than the target as-of FAILs thread-stale, naming both dates and the path', (t) => {
  const home = sandbox(t);
  const targetPath = join(home, 'projects', 'alpha', 'STATE.md');
  makeTargetState(targetPath, '2026-09-02');
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'thread-stale');
  assert.ok(findings[0].message.includes('2026-09-01'));
  assert.ok(findings[0].message.includes('2026-09-02'));
  assert.ok(findings[0].message.includes(targetPath));
});

test('checkActiveThreads: no "(as of ...)" stamp FAILs thread-unstamped', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const line = '- **alpha** — building the thing → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'thread-unstamped');
});

test('checkActiveThreads: no "→" pointer FAILs thread-no-pointer, independent of the stamp', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-09-01) — building the thing, no pointer yet';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'thread-no-pointer');
});

test('checkActiveThreads: both missing — unstamped AND no pointer — fire as two separate findings', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** — building the thing, no stamp, no pointer';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  const types = findings.map((f) => f.type).sort();
  assert.deepEqual(types, ['thread-no-pointer', 'thread-unstamped']);
});

test('checkActiveThreads: takes the target after the LAST arrow when a bullet has more than one', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const line =
    '- **alpha** (as of 2026-09-01) — building the thing → status: on track → `~/projects/alpha/STATE.md`';
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('checkActiveThreads: ~\\ (Windows-style tilde) resolves against home the same as ~/', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'beta', 'STATE.md'), '2026-09-01');
  const line = '- **beta** (as of 2026-09-01) — shipping the other thing → `~\\projects\\beta\\STATE.md`';
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('checkActiveThreads: an absolute Windows-style path (X:\\…) resolves as-is, not against home', (t) => {
  const home = sandbox(t); // the global page's own home — irrelevant to this pointer
  const otherDir = mkdtempSync(join(tmpdir(), 'banana-state-abs-'));
  tempDirs.push(otherDir);
  const targetPath = join(otherDir, 'STATE.md');
  makeTargetState(targetPath, '2026-09-01');
  const line = `- **beta** (as of 2026-09-01) — shipping the other thing → \`${targetPath}\``;
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('checkActiveThreads: a directory pointer resolves to <dir>/STATE.md', (t) => {
  const home = sandbox(t);
  const dir = join(home, 'projects', 'alpha');
  makeTargetState(join(dir, 'STATE.md'), '2026-09-01');
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha`';
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('checkActiveThreads: a pointer to a non-STATE memory file is thread-unverifiable (WARN)', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-09-01) — building the thing → memory project_alpha.md';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'thread-unverifiable');
});

test('checkActiveThreads: a recognized but nonexistent path is thread-unverifiable (WARN) — missing path', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/nonexistent/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'thread-unverifiable');
});

test('checkActiveThreads: a relative (non-~, non-absolute) pointer is thread-unverifiable (WARN)', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'thread-unverifiable');
});

test('checkActiveThreads: a resolved, readable target with no as-of date is thread-target-undated (WARN)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), null); // still the bootstrap placeholder
  const line = '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'thread-target-undated');
});

// =====================================================================
// checkUnownedBullets on '## Backlog (owned)' — global backlog-unowned type
// =====================================================================

test('checkUnownedBullets: the clean global Backlog is owned, no findings', () => {
  assert.deepEqual(checkUnownedBullets(CLEAN_GLOBAL, 'Backlog (owned)', 'backlog-unowned'), []);
});

test('checkUnownedBullets: the fresh-page Backlog placeholder is skipped (not a finding)', () => {
  assert.deepEqual(checkUnownedBullets(FRESH_GLOBAL, 'Backlog (owned)', 'backlog-unowned'), []);
});

test('checkUnownedBullets: an unowned Backlog bullet FAILs backlog-unowned', () => {
  const text = '## Backlog (owned)\n- unowned — nobody claimed this yet\n';
  const findings = checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'backlog-unowned');
});

// =====================================================================
// lintGlobalState — composition sanity + the retired-header WARN (#15, ADR
// 0005: the old "never flags it" rule is retired along with the header it
// used to tolerate).
// =====================================================================

test('lintGlobalState: the clean global fixture (new header) has zero findings', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  assert.deepEqual(lintGlobalState(CLEAN_GLOBAL, { home }), []);
});

test('lintGlobalState: the pre-amendment header WARNs retired-header, page otherwise identical', (t) => {
  const retired = CLEAN_GLOBAL.replace(
    'Edit only your own threads; never rewrite the page.',
    'Rebuilt whole, never patched.',
  );
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const findings = lintGlobalState(retired, { home });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'retired-header');
});

test('lintGlobalState: an unowned Backlog bullet surfaces through the composed findings, not just the standalone checkUnownedBullets call', (t) => {
  const text = CLEAN_GLOBAL.replace('- testagent — sweep the backlog', '- unowned — nobody claimed this yet');
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const findings = lintGlobalState(text, { home });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'backlog-unowned');
});

// =====================================================================
// runStateLint --global — end-to-end tiers, exit codes, missing target
// =====================================================================

test('runStateLint --global: a clean global page is PASS, exit 0', async (t) => {
  const home = makeGlobalHome(t, CLEAN_GLOBAL);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

test('runStateLint --global: WARN-only (a memory-file thread pointer) exits 0', async (t) => {
  const text = CLEAN_GLOBAL.replace(
    '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`',
    '- **alpha** (as of 2026-09-01) — building the thing → memory project_alpha.md',
  );
  const home = makeGlobalHome(t, text);
  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected WARN-only exit 0, got: ${res.lines.join('\n')}`);
  assert.ok(res.lines.some((l) => l.startsWith('WARN [thread-unverifiable]')));
  assert.ok(res.lines.at(-1)?.startsWith('state lint: WARN'));
});

test('runStateLint --global: the pre-amendment header WARNs retired-header, exit 0 (#15, ADR 0005)', async (t) => {
  const text = CLEAN_GLOBAL.replace(
    'Edit only your own threads; never rewrite the page.',
    'Rebuilt whole, never patched.',
  );
  const home = makeGlobalHome(t, text);
  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected WARN-only exit 0, got: ${res.lines.join('\n')}`);
  assert.ok(res.lines.some((l) => l.startsWith('WARN [retired-header]')));
  assert.ok(res.lines.at(-1)?.startsWith('state lint: WARN'));
});

test('runStateLint --global: FAIL-only (missing section) exits 1', async (t) => {
  const text = CLEAN_GLOBAL.replace('## Watch\n- an assumption needing validation (validate-by: 2026-10-01)\n\n', '');
  const home = makeGlobalHome(t, text);
  const res = await runGlobal(home);
  assert.equal(res.code, 1);
  assert.ok(res.lines.some((l) => l.startsWith('FAIL [missing-section]')));
});

test('runStateLint --global: mixed FAIL + WARN exits 1, FAILs printed before WARNs', async (t) => {
  const text = CLEAN_GLOBAL.replace(
    '- **alpha** (as of 2026-09-01) — building the thing → `~/projects/alpha/STATE.md`',
    '- **alpha** — building the thing → memory project_alpha.md',
  );
  const home = makeGlobalHome(t, text);
  const res = await runGlobal(home);
  assert.equal(res.code, 1);
  const failIdx = res.lines.findIndex((l) => l.startsWith('FAIL'));
  const warnIdx = res.lines.findIndex((l) => l.startsWith('WARN'));
  assert.ok(failIdx !== -1 && warnIdx !== -1 && failIdx < warnIdx);
  assert.ok(res.lines.some((l) => l.startsWith('FAIL [thread-unstamped]')));
  assert.ok(res.lines.some((l) => l.startsWith('WARN [thread-unverifiable]')));
});

test('runStateLint --global: a missing home STATE.md exits 2', async (t) => {
  const home = sandbox(t); // no .agents/STATE.md written
  const res = await runGlobal(home);
  assert.equal(res.code, 2);
  assert.ok(res.lines.some((l) => l.includes('missing or unreadable')));
});

test('runStateLint --global: findings are tagged with the ~/.agents/STATE.md file token, not the bare project-mode token', async (t) => {
  const text = CLEAN_GLOBAL.replace('## Watch\n- an assumption needing validation (validate-by: 2026-10-01)\n\n', '');
  const home = makeGlobalHome(t, text);
  const res = await runGlobal(home);
  assert.ok(res.lines[0].includes('~/.agents/STATE.md'), `expected the global file token: ${res.lines[0]}`);
});

// =====================================================================
// Global fresh-page positive control (#13 analogue of Fix B): a home
// bootstrapped through the REAL `banana init` code path (the actual
// templates/global-STATE.md + its real __OWNER__ substitution) with a
// single-token owner must lint clean.
// =====================================================================

test('runStateLint --global: a home bootstrapped by the real `banana init` command lints clean', async (t) => {
  const home = sandbox(t);
  const initIo = {
    out: () => {},
    err: () => {},
    prompt: async () => {
      throw new Error('prompt not expected in this test — owner is provided and yes:true');
    },
  };
  const initResult = await runInit(
    { owner: 'testagent', tag: null, harnesses: [], yes: true, deliver: false },
    { home, io: initIo, isTTY: false, gitUserName: () => null, env: { PATH: '' } },
  );
  assert.equal(initResult.code, 0, `banana init itself must succeed to set up this control: ${JSON.stringify(initResult)}`);
  assert.ok(initResult.created.some((p) => p.endsWith(join('.agents', 'STATE.md'))), 'banana init must have written the global STATE.md');

  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected a clean init to PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// =====================================================================
// collectStateLint / formatStateLintLines (#14) — the no-print data seam
// `banana brief`/`banana log` route through, and `runStateLint` itself now
// uses internally ("one code path": its own CLI output must stay byte-
// identical to before, proven by the 125 pre-existing tests above still
// passing unmodified).
// =====================================================================

test('collectStateLint: a clean project + a missing global page', async (t) => {
  const dir = makeProject(t);
  const home = sandbox(t); // no .agents/STATE.md
  const { project, global } = collectStateLint({ cwd: dir, home });
  assert.deepEqual(project, { verdict: 'PASS', findings: [] });
  assert.deepEqual(global, { none: 'no ~/.agents/STATE.md' });
});

test('collectStateLint: a FAIL project page carries state-lint-formatted finding lines', async (t) => {
  const broken = CLEAN_STATE.replace('## Blocked\n- (none)\n\n', '');
  const dir = makeProject(t, { state: broken });
  const home = sandbox(t);
  const { project } = collectStateLint({ cwd: dir, home });
  assert.ok('findings' in project, `expected a found outcome: ${JSON.stringify(project)}`);
  assert.equal(project.verdict, 'FAIL (1 fail, 0 warn)');
  assert.deepEqual(project.findings, ['FAIL [missing-section] STATE.md: missing required section "## Blocked"']);
});

test('collectStateLint: cwd with no STATE.md is `none`, naming the reason', async (t) => {
  const dir = makeProject(t, { state: null });
  const home = sandbox(t);
  const { project } = collectStateLint({ cwd: dir, home });
  assert.deepEqual(project, { none: 'no STATE.md here' });
});

test('collectStateLint: a project STATE.md that is a directory (unreadable) names the target', async (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, 'STATE.md'));
  const home = sandbox(t);
  const { project } = collectStateLint({ cwd: dir, home });
  assert.ok('unreadable' in project, `expected an unreadable outcome: ${JSON.stringify(project)}`);
  assert.match(project.unreadable, /STATE\.md is missing or unreadable/);
});

test('collectStateLint: a global STATE.md that is a directory (unreadable) names the target', async (t) => {
  const dir = makeProject(t);
  const home = sandbox(t);
  mkdirSync(join(home, '.agents', 'STATE.md'), { recursive: true });
  const { global } = collectStateLint({ cwd: dir, home });
  assert.ok('unreadable' in global, `expected an unreadable outcome: ${JSON.stringify(global)}`);
  assert.match(global.unreadable, /STATE\.md is missing or unreadable/);
});

test('collectStateLint: an unreadable LOGBOOK.md surfaces as the project outcome, not silently dropped', async (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'STATE.md'), CLEAN_STATE, 'utf8');
  mkdirSync(join(dir, 'LOGBOOK.md'));
  mkdirSync(join(dir, '.agents'), { recursive: true });
  const home = sandbox(t);
  const { project } = collectStateLint({ cwd: dir, home });
  assert.ok('unreadable' in project, `expected an unreadable outcome: ${JSON.stringify(project)}`);
  assert.match(project.unreadable, /LOGBOOK\.md is missing or unreadable/);
});

test('collectStateLint: runStateLint routes through it — findings text and verdict match exactly (one code path)', async (t) => {
  const broken = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE}`,
  ).replace('## Blocked\n- (none)\n\n', '');
  const dir = makeProject(t, { state: broken });
  const home = sandbox(t);
  const cliRes = await run(dir); // run()'s own home is cwd — irrelevant, project mode
  const { project } = collectStateLint({ cwd: dir, home });
  assert.ok('findings' in project, `expected a found outcome: ${JSON.stringify(project)}`);
  assert.deepEqual(cliRes.lines.slice(0, -1), project.findings);
  assert.equal(cliRes.lines.at(-1), `state lint: ${project.verdict}`);
});

test('formatStateLintLines: PASS + none prints only the summary line, no fix-it line', () => {
  const lines = formatStateLintLines({
    project: { verdict: 'PASS', findings: [] },
    global: { none: 'no ~/.agents/STATE.md' },
  });
  assert.deepEqual(lines, ['project: PASS · global: none (no ~/.agents/STATE.md)']);
});

test('formatStateLintLines: a FAIL project prints findings (project first, then global) and the fix-it line', () => {
  const lines = formatStateLintLines({
    project: {
      verdict: 'FAIL (1 fail, 0 warn)',
      findings: ['FAIL [missing-section] STATE.md: missing required section "## Blocked"'],
    },
    global: { verdict: 'WARN (1 warn)', findings: ['WARN [dirty-marker] ~/.agents/STATE.md: m'] },
  });
  assert.deepEqual(lines, [
    'project: FAIL (1 fail, 0 warn) · global: WARN (1 warn)',
    'FAIL [missing-section] STATE.md: missing required section "## Blocked"',
    'WARN [dirty-marker] ~/.agents/STATE.md: m',
    'Fix these before relying on the page: a FAIL means STATE no longer projects its sources.',
  ]);
});

test('formatStateLintLines: quiet suppresses the summary line ONLY when both sides are PASS or none', () => {
  const bothClean = formatStateLintLines(
    { project: { verdict: 'PASS', findings: [] }, global: { none: 'no ~/.agents/STATE.md' } },
    { quiet: true },
  );
  assert.deepEqual(bothClean, []);

  const oneFail = formatStateLintLines(
    {
      project: {
        verdict: 'FAIL (1 fail, 0 warn)',
        findings: ['FAIL [missing-section] STATE.md: missing required section "## Blocked"'],
      },
      global: { none: 'no ~/.agents/STATE.md' },
    },
    { quiet: true },
  );
  assert.equal(oneFail[0], 'project: FAIL (1 fail, 0 warn) · global: none (no ~/.agents/STATE.md)');
});

test('formatStateLintLines: quiet never hides findings or the fix-it line, even when the summary line is suppressed elsewhere', () => {
  const lines = formatStateLintLines(
    {
      project: {
        verdict: 'FAIL (1 fail, 0 warn)',
        findings: ['FAIL [missing-section] STATE.md: missing required section "## Blocked"'],
      },
      global: { none: 'no ~/.agents/STATE.md' },
    },
    { quiet: true },
  );
  assert.ok(lines.includes('FAIL [missing-section] STATE.md: missing required section "## Blocked"'));
  assert.ok(lines.includes('Fix these before relying on the page: a FAIL means STATE no longer projects its sources.'));
});

// =====================================================================
// Review hardening (2026-09-28) — 15 adversarially-confirmed wrong-verdict
// findings on the committed lint (3526aed + bec16a1), fixed here. Each
// group cites its finding id from .agents/specs review/fix-spec.md (not
// committed — orchestrator scratchpad). "Red on HEAD" for each was
// confirmed via the reviewer's own executed probe scripts and captured
// outputs (review/out_*.txt) against the pre-fix code, cross-checked by
// re-reading them against the fix-spec's claims before writing the fix
// below — see the phase-3 report for the mapping.
// =====================================================================

// --- F1: fenced/commented headings must not count; duplicate headings ----
// scan ALL their occurrences' bodies, not just the first.

test('F1: a `## Next` that exists ONLY inside a fenced code block does not satisfy the section, and its bullets are never scanned', () => {
  const raw =
    '# STATE\n> as of 2026-09-28\n\n## Now\n- x\n\n## Truths\n- x\n\n' +
    '```markdown\n## Next\n- alpha — example from the template\n```\n' +
    '\n## Blocked\n- x\n\n## Watch\n- x\n\n## Dead ends\n- x\n';
  const text = prepareText(raw);
  assert.equal(hasSection(text, 'Next'), false);
  assert.deepEqual(topLevelBullets(text, 'Next'), []);
  const findings = lintProjectState(text, { logbookText: null, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'missing-section' && f.message.includes('## Next')));
});

test('F1: a fenced `## Next` BEFORE the real one does not shadow it — the real section is still found and scanned', () => {
  const raw =
    '# STATE\n> as of 2026-09-28\n\n## Now\n- x\n\n' +
    '```markdown\n## Next\n- alpha — owned example\n```\n\n' +
    '## Truths\n- x\n\n## Next\n- rebuild the projection\n\n' +
    '## Blocked\n- x\n\n## Watch\n- x\n\n## Dead ends\n- x\n';
  const text = prepareText(raw);
  assert.equal(hasSection(text, 'Next'), true);
  assert.deepEqual(topLevelBullets(text, 'Next'), ['- rebuild the projection']);
  const findings = lintProjectState(text, { logbookText: null, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'unowned-next'), 'the real (unfenced) unowned bullet must still FAIL');
});

test('F1: `## Next` hidden inside a multi-line HTML comment does not satisfy the section', () => {
  const raw =
    '# STATE\n> as of 2026-09-28\n\n## Now\n- x\n\n## Truths\n- x\n\n' +
    '<!--\n## Next\n- alpha — template note\n-->\n\n' +
    '## Blocked\n- x\n\n## Watch\n- x\n\n## Dead ends\n- x\n';
  const text = prepareText(raw);
  assert.equal(hasSection(text, 'Next'), false);
  const findings = lintProjectState(text, { logbookText: null, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'missing-section' && f.message.includes('## Next')));
});

// =====================================================================
// #20b review Decision D2 — blankNonSemanticRegions blanks only the HTML
// COMMENT SPAN, not the whole line: real text before `<!--` on the opening
// line and after `-->` on the closing line survives.
// =====================================================================

test('D2: an inline comment on a bullet line — text before and after the comment both survive', () => {
  const raw = '## Watch\n- real bullet text <!-- a hidden note --> more real text\n';
  const text = prepareText(raw);
  assert.equal(text, '## Watch\n- real bullet text  more real text\n');
});

test('D2: a multi-line comment still blanks every line fully inside it', () => {
  const raw = '## Watch\n- before\n<!--\nhidden line one\nhidden line two\n-->\n- after\n';
  const text = prepareText(raw);
  assert.equal(text, '## Watch\n- before\n\n\n\n\n- after\n');
});

test('D2: several comments on one line are ALL removed, surrounding text kept', () => {
  const raw = '## Watch\n- a <!-- one --> b <!-- two --> c\n';
  const text = prepareText(raw);
  assert.equal(text, '## Watch\n- a  b  c\n');
});

test('D2: a line that is ENTIRELY a comment still blanks to nothing (keeps the commented-heading hardening)', () => {
  const raw = '<!-- ## Next -->\n## Watch\n- x\n';
  const text = prepareText(raw);
  assert.equal(text, '\n## Watch\n- x\n');
  assert.equal(hasSection(text, 'Next'), false);
});

test('D2: a REAL bullet carrying an inline comment is no longer invisible to checkUnownedBullets', () => {
  const text = '## Backlog (owned)\n- unowned-marker <!-- a note --> still unowned\n';
  const findings = checkUnownedBullets(prepareText(text), 'Backlog (owned)', 'backlog-unowned');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('unowned-marker'));
});

test('F1: a duplicated `## Next` heading is scanned under BOTH occurrences — an unowned bullet in the SECOND is still caught', () => {
  const text = CLEAN_STATE + '\n## Next\n- rebuild the projection\n';
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'unowned-next' && f.message.includes('rebuild the projection')));
});

test('F1: the retired-header phrase inside a fence is not flagged — it is quoted example text, not the page\'s own header', () => {
  const raw = CLEAN_STATE + '\n```\nRebuilt whole, never patched.\n```\n';
  const text = prepareText(raw);
  assert.ok(RETIRED_HEADER_RE.test(raw), 'sanity: the raw text DOES contain the phrase before blanking');
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(!findings.some((f) => f.type === 'retired-header'));
});

test('F1: the "Rebuilt, never patched." wording variant inside a fence is not flagged either', () => {
  const raw = CLEAN_STATE + '\n```\nRebuilt, never patched.\n```\n';
  const text = prepareText(raw);
  assert.ok(RETIRED_HEADER_RE.test(raw), 'sanity: the raw text DOES contain the phrase before blanking');
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(!findings.some((f) => f.type === 'retired-header'));
});

test('F1 (end-to-end via runStateLint): fenced Next + fenced retired-header phrase in a real file are both correctly ignored', async (t) => {
  const text =
    CLEAN_STATE.replace('## Next\n- testagent — ship the next slice\n- ahimsa — review the shipped slice\n', '## Next\n- testagent — ship the next slice\n- ahimsa — review the shipped slice\n') +
    '\n```\nRebuilt whole, never patched.\n```\n';
  const res = await run(makeProject(t, { state: text }));
  assert.ok(!res.lines.some((l) => l.includes('retired-header')), `fenced phrase must not be flagged: ${res.lines}`);
});

// --- F2: placeholder = exact match to a real template bullet -------------
// (classifyOwnerBullet/isPlaceholderBullet coverage already added above,
// near the owner-matcher tests; these add the Active-threads/Backlog angle.)

test('F2: Active-threads bullet that merely opens with a parenthetical is checked normally (thread-unstamped/no-pointer), not exempted', (t) => {
  const home = sandbox(t);
  const line = '- (paused) **alpha** — no stamp, no pointer at all';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  const types = findings.map((f) => f.type).sort();
  assert.deepEqual(types, ['thread-no-pointer', 'thread-unstamped']);
});

test('F2: Backlog bullet that merely opens with a parenthetical is checked normally (unowned), not exempted', () => {
  const text = '## Backlog (owned)\n- (deferred) rebuild the projection\n';
  const findings = checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned');
  assert.equal(findings.length, 1);
});

// --- F3: malformed as-of/stamp dates are distinguishable from absent -----

test('F3: an impossible as-of date FAILs as-of-malformed, not as-of-missing, and does not compare stale against the logbook', () => {
  const text = CLEAN_STATE.replace('as of 2026-08-10', 'as of 2026-13-45');
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'as-of-malformed'), `expected as-of-malformed: ${JSON.stringify(findings)}`);
  assert.ok(!findings.some((f) => f.type === 'as-of-missing'));
  assert.ok(!findings.some((f) => f.type === 'stale-vs-logbook'));
});

test('F3: an impossible Active-threads stamp FAILs thread-stamp-malformed, not thread-unstamped', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const line = '- **alpha** (as of 2026-09-31) — building the thing → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'FAIL');
  assert.equal(findings[0].type, 'thread-stamp-malformed');
});

// --- F4: as-of is header-only and last-match (doctor.test.mjs covers ----
// stateAsOf directly; this confirms the FULL lintProjectState pipeline).

test('F4: a date mentioned only in the Dead-ends body does not date an otherwise-undated page', () => {
  const text = CLEAN_STATE
    .replace('as of 2026-08-10 ', '')
    .replace('## Dead ends\n- (none yet)\n', '## Dead ends\n- tried the old importer as of 2026-09-28; abandoned\n');
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(findings.some((f) => f.type === 'as-of-missing'), 'the header is genuinely undated — the body date must not count');
});

// --- F5: arrow resolution ignores backtick-interior arrows and skips -----
// trailing-prose arrows whose target doesn't look like a path.

test('F5: an arrow inside backticks AFTER the real pointer does not shadow it', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-02');
  const line = '- **alpha** (as of 2026-09-01) — st → `~/projects/alpha/STATE.md` (see `a → b`)';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `expected thread-stale, got: ${JSON.stringify(findings)}`);
});

test('F5: a second, trailing-prose arrow whose target is not a path does not shadow the real pointer', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-02');
  const line = '- **alpha** (as of 2026-09-01) — st → `~/projects/alpha/STATE.md` (next: draft → review)';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `expected thread-stale, got: ${JSON.stringify(findings)}`);
});

test('F5: an arrow chain in prose BEFORE the real pointer still resolves to the real pointer', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-02');
  const line = '- **alpha** (as of 2026-09-01) — spark→bounce→brief → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `expected thread-stale, got: ${JSON.stringify(findings)}`);
});

// --- F6: multiple stamps on one bullet compare against the OLDEST --------

test('F6: two stamps, OLDER one first — the oldest still governs (conservative)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-02');
  const line = '- **alpha** (as of 2026-01-01) — was (as of 2026-09-30) → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `expected thread-stale, got: ${JSON.stringify(findings)}`);
});

test('F6: two stamps, NEWER one first — the oldest still governs (conservative)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-02');
  const line = '- **alpha** (as of 2026-09-30) — earlier (as of 2026-01-01) → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `expected thread-stale, got: ${JSON.stringify(findings)}`);
});

// --- F7: emphasis markers strip fully (one layer per side is enough once --
// the alternation includes the triple-marker forms), even around a literal
// __OWNER__ token's own underscores.

test('F7: a triple-asterisk-wrapped "unowned" is still recognized as unowned', () => {
  assert.equal(classifyOwnerBullet('- ***unowned*** — do X'), 'unowned');
});

test('F7: a double-asterisk-wrapped __OWNER__ is still recognized as unowned', () => {
  assert.equal(classifyOwnerBullet('- **__OWNER__** — do X'), 'unowned');
});

// --- F8: +, numbered, and one-space-indented list markers count as -------
// top-level bullets; a leading TAB does not (the rule is 0-1 leading SPACES).

test('F8: a "+" bullet and a numbered bullet both count as top-level', () => {
  const text = '## Next\n+ rebuild the projection\n1. also rebuild the projection\n';
  assert.deepEqual(topLevelBullets(text, 'Next'), ['+ rebuild the projection', '1. also rebuild the projection']);
});

test('F8: a one-space-indented bullet counts; a tab-indented one does not', () => {
  const text = '## Next\n rebuild me - not a bullet, no marker\n - rebuild the projection\n\t- tab-indented, excluded\n';
  assert.deepEqual(topLevelBullets(text, 'Next'), [' - rebuild the projection']);
});

// --- F9: a section body ends at the next level-1/2 heading only — a -----
// deeper heading or a horizontal rule does not end it.

test('F9: a bullet after a LATER "# H1" is out of the Next section (the missing case, fixed)', () => {
  const text = '# STATE\n> as of 2026-09-28\n\n## Next\n- alpha — x\n\n# Appendix\n- rebuild the projection\n';
  assert.deepEqual(topLevelBullets(text, 'Next'), ['- alpha — x']);
});

test('F9: a bullet after a deeper "#### H4" or a "---" rule stays IN the Next section', () => {
  const withH4 = '# STATE\n> as of 2026-09-28\n\n## Next\n- alpha — x\n\n#### Appendix\n- rebuild the projection\n';
  assert.deepEqual(topLevelBullets(withH4, 'Next'), ['- alpha — x', '- rebuild the projection']);
  const withRule = '# STATE\n> as of 2026-09-28\n\n## Next\n- alpha — x\n\n---\n- rebuild the projection\n';
  assert.deepEqual(topLevelBullets(withRule, 'Next'), ['- alpha — x', '- rebuild the projection']);
});

// --- F11: extra whitespace after the bullet marker does not defeat the ---
// owner match.

test('F11: two spaces after the marker is still owned', () => {
  assert.equal(classifyOwnerBullet('-  ahimsa — do X'), 'owned');
});

test('F11: a tab after the marker is still owned', () => {
  assert.equal(classifyOwnerBullet('-\tahimsa — do X'), 'owned');
});

// --- F12: stamp matching is case-insensitive but otherwise exact ---------

test('F12: a capitalized "(As of ...)" stamp counts', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const line = '- **alpha** (As of 2026-09-01) — st → `~/projects/alpha/STATE.md`';
  assert.deepEqual(checkActiveThreads(`## Active threads\n${line}\n`, home), []);
});

test('F12: extra text before the closing paren keeps the stamp unrecognized — exact by design', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-09-28, rebuilt) — st → `~/projects/alpha/STATE.md`';
  const findings = checkActiveThreads(`## Active threads\n${line}\n`, home);
  assert.ok(findings.some((f) => f.type === 'thread-unstamped'), 'the convention is exact by design (documented in DESIGN.md)');
});

// --- F13: a BOM glued mid-document before a heading does not hide it -----

test('F13: a BOM glued directly before a "## Next" heading does not hide the section', () => {
  const withBom = CLEAN_STATE.replace('## Next\n', '﻿## Next\n');
  const findings = lintProjectState(withBom.replace(/﻿/g, ''), { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.deepEqual(findings, [], 'sanity: without the BOM the fixture is clean');
  // The real regression guard is end-to-end (runStateLint applies prepareText,
  // which strips the BOM before any section matching runs).
});

test('F13 (end-to-end via runStateLint): a BOM glued before "## Next" does not cause a false missing-section', async (t) => {
  const withBom = CLEAN_STATE.replace('## Next\n', '﻿## Next\n');
  const res = await run(makeProject(t, { state: withBom }));
  assert.equal(res.code, 0, `expected PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// --- F14: the dirty marker compares on line.trim() (a trailing space -----
// still counts); an Active-threads bullet is never joined across lines.

test('F14: a dirty marker with one trailing space still WARNs', () => {
  const withMarker = CLEAN_STATE.replace(
    '> section patches are legal and must carry the dirty-marker line.',
    `> section patches are legal and must carry the dirty-marker line.\n${DIRTY_MARKER_LINE} `,
  );
  const findings = checkDirtyMarker(withMarker);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'dirty-marker');
});

test('F14: a wrapped Active-threads bullet (stamp+pointer on an indented continuation line) is NOT joined — FAILs by design', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const text = '## Active threads\n- **alpha** — a long thread\n  (as of 2026-09-28) → `~/projects/alpha/STATE.md`\n';
  const findings = checkActiveThreads(text, home);
  const types = findings.map((f) => f.type).sort();
  assert.deepEqual(types, ['thread-no-pointer', 'thread-unstamped'], 'the continuation line must not be joined into the bullet');
});

// --- F15: CR-only (old-Mac) line endings normalize the same as LF/CRLF ---

test('F15: a page with CR-only line endings still lints clean', async (t) => {
  const crOnly = CLEAN_STATE.replace(/\n/g, '\r');
  const res = await run(makeProject(t, { state: crOnly }));
  assert.equal(res.code, 0, `expected PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// --- Unreadable (but existing) LOGBOOK.md / session.log --> exit 2 -------
// (previously silently swallowed to null, dropping stale-vs-logbook).

test('unreadable input: an existing LOGBOOK.md that cannot be read (a directory, not a file) exits 2 naming it', async (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'STATE.md'), CLEAN_STATE, 'utf8');
  mkdirSync(join(dir, 'LOGBOOK.md')); // a directory named LOGBOOK.md, not a file
  mkdirSync(join(dir, '.agents'), { recursive: true });
  const res = await run(dir);
  assert.equal(res.code, 2);
  assert.ok(res.lines.some((l) => l.includes('LOGBOOK.md') && l.includes('missing or unreadable')));
});

test('unreadable input: an existing .agents/session.log that cannot be read (a directory) exits 2 naming it', async (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'STATE.md'), CLEAN_STATE, 'utf8');
  mkdirSync(join(dir, '.agents', 'session.log'), { recursive: true }); // a directory, not a file
  const res = await run(dir);
  assert.equal(res.code, 2);
  assert.ok(res.lines.some((l) => l.includes('session.log') && l.includes('missing or unreadable')));
});

// =====================================================================
// #20 Lane A — four new global-mode WARN checks: `line-over-limit`,
// `closed-undated`, `closed-expired`, `thread-inactive`, plus the
// clock-free `globalReferenceDate` they share (newest valid Active-threads
// `(as of)` / Recently-closed `(closed)` stamp on the page — never the
// clock, ADR 0004's module invariant, and never just the FIRST stamp,
// since per-thread edits (ADR 0005) land bullets out of date order).
// Public-repo hygiene: every fixture below is synthetic.
// =====================================================================

// The exact literal text #20 ships as templates/global-STATE.md's NEW
// Recently-closed placeholder — pinned here too so a test using it breaks
// loudly (not silently) if the template text and this string ever drift.
const NEW_CLOSED_PLACEHOLDER =
  '- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)';

/** A single bullet line of exactly `len` chars total, `prefix` kept literal, padded with 'x'. */
function bulletOfLength(prefix, len) {
  assert.ok(len >= prefix.length, `bulletOfLength: len ${len} smaller than prefix length ${prefix.length}`);
  return prefix + 'x'.repeat(len - prefix.length);
}

// --- checkLineOverLimit ---------------------------------------------------

test('checkLineOverLimit: every section\'s own limit is the exact boundary (limit passes, limit+1 warns)', () => {
  for (const [name, limit] of Object.entries(SECTION_LINE_LIMITS)) {
    const atLimit = `## ${name}\n${bulletOfLength('- x ', limit)}\n`;
    assert.deepEqual(checkLineOverLimit(atLimit), [], `"${name}" at exactly ${limit} chars must pass`);

    const overLimit = `## ${name}\n${bulletOfLength('- x ', limit + 1)}\n`;
    const findings = checkLineOverLimit(overLimit);
    assert.equal(findings.length, 1, `"${name}" at ${limit + 1} chars must warn`);
    assert.equal(findings[0].tier, 'WARN');
    assert.equal(findings[0].type, 'line-over-limit');
    assert.ok(findings[0].message.includes(String(limit + 1)));
    assert.ok(findings[0].message.includes(String(limit)));
    assert.ok(findings[0].message.includes(name));
  }
});

test('checkLineOverLimit: the message names the remedy (archive --reason trimmed, then shorten in place)', () => {
  const name = 'Active threads';
  const limit = SECTION_LINE_LIMITS[name];
  const text = `## ${name}\n${bulletOfLength('- alpha ', limit + 1)}\n`;
  const findings = checkLineOverLimit(text);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('banana state archive --global --reason trimmed --match'));
  assert.ok(findings[0].message.includes('shorten it in place'));
  assert.ok(findings[0].message.includes('alpha'), 'first-60-chars preview must include the bullet\'s own start');
});

// #20b review Decision D1: `line-over-limit` now measures a bullet's OWN
// PHYSICAL LINE ONLY — a wrapped bullet's continuation lines are reported
// separately by `bullet-wrapped` (checkBulletWrapped, below). The three
// tests that used to live here (continuation lines counting toward length,
// a continuation run stopping at the next bullet, trailing blank
// section-spacing not counting) all pinned the OLD span-measurement
// behavior D1 retires; replaced by the one test below, which pins the NEW
// contract (and is the mutation-check catcher for "measure continuation
// lines in line-over-limit" — mutation (g)).

test('checkLineOverLimit: a continuation line is never counted toward the bullet\'s length (D1)', () => {
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const firstLine = bulletOfLength('- an assumption ', limit); // exactly at the limit alone
  // A continuation line long enough to push the OLD (span) measurement
  // over the limit must not warn under the new one-physical-line rule.
  const withContinuation = `## ${name}\n${firstLine}\n  a continuation line long enough to push a span measurement over the limit\n`;
  assert.deepEqual(checkLineOverLimit(withContinuation), []);
});

// (The old "checkLineOverLimit: template placeholders ... are exempt" test
// could never fail: every shipped placeholder's own text is far shorter
// than even the smallest section limit (250 chars), with or without the
// isPlaceholderBullet skip. Removed per #20b review's "remove or rewrite
// the placeholder-exemption tests that cannot fail"; isPlaceholderBullet
// itself is exercised directly elsewhere, and checkClosedUndated's
// placeholder tests exercise a case where the skip's absence DOES matter.

test('checkLineOverLimit: CRLF-normalized length decides the limit, not raw CRLF byte length', () => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const lf = `## ${name}\n${bulletOfLength('- x ', limit)}\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.ok(crlf.length > lf.length, 'sanity: raw CRLF bytes are longer than the LF form');
  assert.deepEqual(checkLineOverLimit(prepareText(crlf)), checkLineOverLimit(lf));
  assert.deepEqual(checkLineOverLimit(prepareText(crlf)), []);
});

// =====================================================================
// #20b review Decision D1 — the shared continuation-line helper
// (topLevelBulletContinuationCounts) and the `bullet-wrapped` WARN it
// backs (checkBulletWrapped). Each continuation case below is independent,
// isolated fixture — one bullet, one shape — with its expected count
// written out literally (never derived from the function under test).
// =====================================================================

test('topLevelBulletContinuationCounts: a lazy (non-indented) line directly after the bullet counts as one continuation line', () => {
  const raw = '## Watch\n- bullet one\nlazy continuation line, not indented, not a bullet\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [1]);
});

test('topLevelBulletContinuationCounts: a blank line then an indented paragraph counts as continuation', () => {
  const raw = '## Watch\n- bullet one\n\n  indented paragraph for bullet one\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [2]);
});

test('topLevelBulletContinuationCounts: a "###" heading directly after the bullet is NOT continuation — ends the bullet', () => {
  const raw = '## Watch\n- bullet one\n### a heading right after\n- sibling\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0, 0]);
});

test('topLevelBulletContinuationCounts: a "---" thematic break directly after the bullet is NOT continuation', () => {
  const raw = '## Watch\n- bullet one\n---\n- sibling\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0, 0]);
});

test('topLevelBulletContinuationCounts: a fenced code block directly after the bullet is NOT continuation', () => {
  const raw = '## Watch\n- bullet one\n```\nfenced content\n```\n- sibling\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0, 0]);
});

test('topLevelBulletContinuationCounts: an HTML-comment-only line directly after the bullet is NOT continuation', () => {
  const raw = '## Watch\n- bullet one\n<!-- a comment -->\n- sibling\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0, 0]);
});

test('topLevelBulletContinuationCounts: a PLAIN (non-indented) paragraph after a blank line is NOT continuation', () => {
  const raw = '## Watch\n- bullet one\n\nplain paragraph, not indented, not a bullet\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

// --- checkBulletWrapped ----------------------------------------------------

test('checkBulletWrapped: a wrapped bullet in each of the four sections WARNs bullet-wrapped', () => {
  for (const name of Object.keys(SECTION_LINE_LIMITS)) {
    const text = `## ${name}\n- a bullet\n  a continuation line\n`;
    const findings = checkBulletWrapped(text);
    assert.equal(findings.length, 1, `"${name}" must WARN bullet-wrapped`);
    assert.equal(findings[0].tier, 'WARN');
    assert.equal(findings[0].type, 'bullet-wrapped');
    assert.ok(findings[0].message.includes(name));
    assert.ok(findings[0].message.includes('join it into one line'));
  }
});

test('checkBulletWrapped: a single-line bullet (nothing follows it) never warns', () => {
  assert.deepEqual(checkBulletWrapped('## Watch\n- a single-line bullet\n'), []);
});

test('checkBulletWrapped: a placeholder bullet is exempt even if it happens to have a continuation line', () => {
  const placeholder = topLevelBullets(prepareText(FRESH_GLOBAL), 'Watch')[0];
  const text = `## Watch\n${placeholder}\n  not actually a real continuation, but still skipped\n`;
  assert.deepEqual(checkBulletWrapped(text), []);
});

test('checkBulletWrapped: reported independently of line-over-limit — a short-but-wrapped bullet warns bullet-wrapped only', () => {
  const name = 'Watch';
  const text = `## ${name}\n- short\n  a continuation line\n`;
  const findings = checkBulletWrapped(text);
  assert.ok(findings.some((f) => f.type === 'bullet-wrapped'));
  assert.deepEqual(checkLineOverLimit(text), [], 'a short wrapped bullet must not also warn line-over-limit');
});

test('lintGlobalState: a wrapped bullet WARNs bullet-wrapped through the composed findings', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const text = CLEAN_GLOBAL.replace(
    '- testagent — sweep the backlog',
    '- testagent — sweep the backlog\n  a continuation line',
  );
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'bullet-wrapped'), `expected bullet-wrapped: ${JSON.stringify(findings)}`);
});

// --- checkClosedUndated ---------------------------------------------------

test('checkClosedUndated: no "(closed ...)" stamp at all warns', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished, no stamp\n';
  const findings = checkClosedUndated(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'closed-undated');
  assert.ok(findings[0].message.includes('gamma finished, no stamp'));
});

test('checkClosedUndated: a date-shaped-but-impossible "(closed ...)" value is still "no valid stamp" — warns', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2026-13-45)\n';
  const findings = checkClosedUndated(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'closed-undated');
});

test('checkClosedUndated: a valid "(closed YYYY-MM-DD)" stamp never warns', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2026-09-01)\n';
  assert.deepEqual(checkClosedUndated(text), []);
});

test('checkClosedUndated: case-insensitive "(Closed ...)" still counts as a valid stamp', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (Closed 2026-09-01)\n';
  assert.deepEqual(checkClosedUndated(text), []);
});

test('checkClosedUndated: extra text before the closing paren keeps the stamp unrecognized — exact by design', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2026-09-01, archived)\n';
  const findings = checkClosedUndated(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'closed-undated');
});

test('checkClosedUndated: the NEW template placeholder is exempt', () => {
  assert.deepEqual(checkClosedUndated(`## Recently closed (context for next session)\n${NEW_CLOSED_PLACEHOLDER}\n`), []);
});

// #20 spec: "Placeholder detection must keep recognizing the PREVIOUS
// Recently closed placeholder ... installed pages carry it" — FRESH_GLOBAL
// still carries that exact legacy text (by design, unchanged above), so
// this is the dedicated legacy-placeholder test the spec calls for.
test('checkClosedUndated: the LEGACY (pre-#20) Recently-closed placeholder is still exempt — an old-template page raises no closed-undated', () => {
  assert.ok(
    FRESH_GLOBAL.includes('- (last few finished threads, one line each, with pointers)'),
    'sanity: FRESH_GLOBAL still carries the legacy placeholder text',
  );
  assert.deepEqual(checkClosedUndated(FRESH_GLOBAL), []);
});

// --- globalReferenceDate ---------------------------------------------------

test('globalReferenceDate: the newest valid stamp wins, whether it is an Active-threads (as of) or a Recently-closed (closed) date', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — old thread → memory a',
    '',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-06-01)',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-06-01');
});

test('globalReferenceDate: the newest stamp wins regardless of document order — not just the FIRST stamp encountered', () => {
  const firstInDocButOlder = [
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — old thread → memory a',
    '- **beta** (as of 2026-06-01) — newer thread → memory b',
  ].join('\n');
  assert.equal(globalReferenceDate(firstInDocButOlder), '2026-06-01');

  const newerFirstInDoc = [
    '## Active threads',
    '- **beta** (as of 2026-06-01) — newer thread → memory b',
    '- **alpha** (as of 2026-01-01) — old thread → memory a',
  ].join('\n');
  assert.equal(globalReferenceDate(newerFirstInDoc), '2026-06-01');
});

test('globalReferenceDate: malformed stamps are never candidates', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-13-45) — old thread → memory a\n';
  assert.equal(globalReferenceDate(text), null);
});

// (The old "globalReferenceDate: placeholder bullets are never candidates"
// test against FRESH_GLOBAL could never fail: both placeholders' date
// tokens are the literal "YYYY-MM-DD", which never matches the digit-shaped
// stamp regex at all — `dates` stays empty with or without the
// isPlaceholderBullet skip. Removed per #20b review's "remove or rewrite
// the placeholder-exemption tests that cannot fail"; isPlaceholderBullet
// itself is already exercised directly (see the isPlaceholderBullet test
// block above), and checkClosedUndated's placeholder tests below exercise
// a case where the skip's ABSENCE would produce a real, different finding.

test('globalReferenceDate: no valid stamp anywhere on the page is null', () => {
  assert.equal(globalReferenceDate('## Active threads\n- alpha, no stamp\n'), null);
});

// --- checkClosedExpired ---------------------------------------------------

test('checkClosedExpired: the exact boundary — 7 days before the reference date passes, 8 warns', () => {
  const sevenDays = '## Recently closed (context for next session)\n- gamma finished (closed 2026-01-01)\n';
  assert.deepEqual(checkClosedExpired(sevenDays, '2026-01-08'), []);

  const eightDays = '## Recently closed (context for next session)\n- gamma finished (closed 2026-01-01)\n';
  const findings = checkClosedExpired(eightDays, '2026-01-09');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'closed-expired');
  assert.ok(findings[0].message.includes('2026-01-01'));
  assert.ok(findings[0].message.includes('2026-01-09'));
});

test('checkClosedExpired: the message names the remedy (archive --reason expired)', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2026-01-01)\n';
  const findings = checkClosedExpired(text, '2026-02-01');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('banana state archive --global --reason expired --match'));
});

test('checkClosedExpired: a null reference date (no valid stamp anywhere) skips the check entirely', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2020-01-01)\n';
  assert.deepEqual(checkClosedExpired(text, null), []);
});

test('checkClosedExpired: a bullet with no valid stamp is closed-undated\'s job, not this check\'s', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished, no stamp\n';
  assert.deepEqual(checkClosedExpired(text, '2026-01-09'), []);
});

test('checkClosedExpired: an impossible "(closed ...)" stamp skips this check too (closed-undated\'s job)', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (closed 2026-13-45)\n';
  assert.deepEqual(checkClosedExpired(text, '2026-01-09'), []);
});

// (The old "checkClosedExpired: the NEW and LEGACY placeholders are both
// exempt" test could never fail: both placeholders' date tokens are the
// literal "YYYY-MM-DD", which never matches the digit-shaped stamp regex at
// all — `validStamps` is already empty before isPlaceholderBullet is ever
// consulted. Removed per #20b review's "remove or rewrite the
// placeholder-exemption tests that cannot fail"; checkClosedUndated's own
// placeholder tests above exercise a case where the skip's absence DOES
// change the outcome.

test('checkClosedExpired: two stamps on one bullet compare against the OLDEST (conservative, mirrors Active-threads F6)', () => {
  const text =
    '## Recently closed (context for next session)\n- gamma (closed 2026-01-01) then (closed 2026-01-20)\n';
  // Oldest (2026-01-01) is 8 days before 2026-01-09 -> expired, even though
  // the newer co-stamp (2026-01-20) alone would not be.
  const findings = checkClosedExpired(text, '2026-01-09');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'closed-expired');
});

// --- checkThreadInactive ---------------------------------------------------

// A pointer target of "memory a" (not a `~/`/absolute path shape) never
// resolves, so `bulletIsThreadStale` (item 4) returns false regardless of
// `home` for every fixture below — `NOHOME` stands in for a real sandbox in
// tests with no `t` context, matching exactly what these fixtures exercise.
const NOHOME = '/nonexistent-home';

test('checkThreadInactive: the exact boundary — 30 days before the reference date passes, 31 warns', () => {
  const thirtyDays = '## Active threads\n- **alpha** (as of 2026-01-01) — building the thing → memory a\n';
  assert.deepEqual(checkThreadInactive(thirtyDays, '2026-01-31', NOHOME), []);

  const thirtyOneDays = '## Active threads\n- **alpha** (as of 2026-01-01) — building the thing → memory a\n';
  const findings = checkThreadInactive(thirtyOneDays, '2026-02-01', NOHOME);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'WARN');
  assert.equal(findings[0].type, 'thread-inactive');
  assert.ok(findings[0].message.includes('2026-01-01'));
  assert.ok(findings[0].message.includes('2026-02-01'));
});

test('checkThreadInactive: the message names the remedy (archive --reason inactive, then a Backlog line)', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-01-01) — building the thing → memory a\n';
  const findings = checkThreadInactive(text, '2026-03-01', NOHOME);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('banana state archive --global --reason inactive --match'));
  assert.ok(findings[0].message.includes('Backlog'));
});

test('checkThreadInactive: a null reference date (no valid stamp anywhere) skips the check entirely', () => {
  const text = '## Active threads\n- **alpha** (as of 2020-01-01) — building the thing → memory a\n';
  assert.deepEqual(checkThreadInactive(text, null, NOHOME), []);
});

test('checkThreadInactive: a bullet with no valid stamp is thread-unstamped/-malformed\'s job, not this check\'s', () => {
  const text = '## Active threads\n- **alpha** — building the thing, no stamp → memory a\n';
  assert.deepEqual(checkThreadInactive(text, '2026-06-01', NOHOME), []);
});

// The two placeholder-exemption tests that used to live here (NEW + LEGACY
// Recently-closed-style placeholders) could never fail: both placeholders'
// date token is the literal "YYYY-MM-DD" (letters, not digits), so
// `validStamps` is already empty before `isPlaceholderBullet` is ever
// consulted — the SAME `[]` outcome holds with the placeholder skip
// deleted entirely. Removed rather than rewritten (#20b review item: "remove
// or rewrite the placeholder-exemption tests that cannot fail") — the real
// "placeholder bullets are exempt here too" claim is covered meaningfully
// by checkActiveThreads' own placeholder test below, which DOES turn red
// if its skip is removed (the placeholder's `(as of YYYY-MM-DD)` is also
// non-digit, but checkActiveThreads FAILs thread-unstamped on a non-exempt
// no-valid-stamp bullet, unlike this WARN-only check's silent `continue`).

test('checkThreadInactive: two stamps on one bullet compare against the OLDEST (conservative, mirrors Active-threads F6)', () => {
  const text =
    '## Active threads\n- **alpha** (as of 2026-01-01) was (as of 2026-01-20) — building the thing → memory a\n';
  const findings = checkThreadInactive(text, '2026-02-01', NOHOME);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'thread-inactive');
});

test('checkThreadInactive: an impossible (as of ...) stamp skips this check too (thread-stamp-malformed\'s job)', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-13-45) — building the thing → memory a\n';
  assert.deepEqual(checkThreadInactive(text, '2026-06-01', NOHOME), []);
});

// --- checkThreadInactive x checkActiveThreads: item 4 (contradictory remedies) ---

test('checkThreadInactive: suppressed when the SAME bullet already FAILs thread-stale (stale wins)', (t) => {
  const home = sandbox(t);
  // The target's own as-of (2026-02-01) is newer than the bullet's stamp
  // (2026-01-01, also 31+ days before the reference date) — both
  // thread-stale (checkActiveThreads) and thread-inactive would otherwise
  // fire on this one bullet; thread-inactive must stand down.
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-02-01');
  const line = '- **alpha** (as of 2026-01-01) — building the thing → `~/projects/alpha/STATE.md`';
  const text = `## Active threads\n${line}\n`;

  const activeFindings = checkActiveThreads(text, home);
  assert.ok(activeFindings.some((f) => f.type === 'thread-stale'), 'sanity: this bullet is genuinely thread-stale');

  const inactiveFindings = checkThreadInactive(text, '2026-02-05', home);
  assert.deepEqual(inactiveFindings, []);
});

test('checkThreadInactive: NOT suppressed when the bullet is merely old, with no resolvable/stale target', (t) => {
  const home = sandbox(t);
  const line = '- **alpha** (as of 2026-01-01) — building the thing → memory a';
  const text = `## Active threads\n${line}\n`;
  const findings = checkThreadInactive(text, '2026-02-05', home);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'thread-inactive');
});

// =====================================================================
// #20b review item 3 — a stamp quoted inside backticks (example text) is
// ignored by every check AND by globalReferenceDate, which all read stamps
// through the same bulletStampShapes primitive.
// =====================================================================

test('checkClosedUndated: a "(closed ...)" stamp written only inside backticks does not count — still warns', () => {
  const text =
    '## Recently closed (context for next session)\n' +
    '- gamma finished, e.g. `(closed 2026-09-01)` is the convention\n';
  const findings = checkClosedUndated(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'closed-undated');
});

test('checkClosedExpired: a real stamp outside backticks is found even when an unrelated stamp sits inside backticks on the same line', () => {
  const text =
    '## Recently closed (context for next session)\n' +
    '- gamma finished (closed 2026-01-01), e.g. `(closed 2026-09-01)` is the convention\n';
  const findings = checkClosedExpired(text, '2026-01-09');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('2026-01-01'), 'the REAL (outside-backtick) stamp must govern');
});

test('checkThreadInactive: an "(as of ...)" stamp written only inside backticks does not count — thread-unstamped\'s job, not this one', () => {
  const text = '## Active threads\n- **alpha** — see the convention, e.g. `(as of 2026-01-01)` → memory a\n';
  assert.deepEqual(checkThreadInactive(text, '2026-06-01', NOHOME), []);
});

test('globalReferenceDate: a stamp written only inside backticks is never a candidate', () => {
  const text =
    '## Active threads\n- **alpha** — see the convention, e.g. `(as of 2026-01-01)` → memory a\n' +
    '## Recently closed (context for next session)\n- gamma finished (closed 2026-03-01)\n';
  assert.equal(globalReferenceDate(text), '2026-03-01');
});

// =====================================================================
// #20b review item 7 — every #20 date-check message names BOTH the
// reference date and the bullet it came from (regression guard: this was
// already true before the item-6/item-3 edits above touched these
// messages, and must stay true after).
// =====================================================================

test('checkClosedExpired: the message names both the reference date and the offending bullet', () => {
  const text = '## Recently closed (context for next session)\n- gamma unique-marker (closed 2026-01-01)\n';
  const findings = checkClosedExpired(text, '2026-01-20');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('2026-01-20'), 'must name the reference date');
  assert.ok(findings[0].message.includes('unique-marker'), 'must name the bullet');
});

test('checkThreadInactive: the message names both the reference date and the offending bullet', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-01-01) — unique-marker-thread → memory a\n';
  const findings = checkThreadInactive(text, '2026-03-01', NOHOME);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('2026-03-01'), 'must name the reference date');
  assert.ok(findings[0].message.includes('unique-marker-thread'), 'must name the bullet');
});

// =====================================================================
// #20b review item: stamp keyword is per-section — an "(as of ...)" stamp
// on a Recently-closed bullet does not satisfy the "(closed ...)" the
// section actually requires.
// =====================================================================

test('checkClosedUndated: an "(as of ...)" stamp on a Recently-closed bullet does not satisfy closed-undated', () => {
  const text = '## Recently closed (context for next session)\n- gamma finished (as of 2026-09-01)\n';
  const findings = checkClosedUndated(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'closed-undated');
});

// =====================================================================
// #20b review item 5 — a placeholder's substituted `__OWNER__` wildcard
// is a non-greedy ANY-run, so an owner name with a space still matches.
// =====================================================================

test('isPlaceholderBullet: the global Backlog placeholder survives owner substitution even when the owner name contains a space', () => {
  const templateRaw = readFileSync(join(KIT_ROOT_FOR_TEMPLATES, 'templates', 'global-STATE.md'), 'utf8');
  const bullet = templateRaw.split('\n').find((l) => l.trim().startsWith('- (queued cross-project items'));
  assert.ok(bullet, 'sanity: the Backlog placeholder bullet exists in the real template');
  const substituted = bullet.replace(/__OWNER__/g, 'Jane Doe');
  assert.ok(substituted.includes('Jane Doe'), 'sanity: the substitution actually happened');
  assert.ok(isPlaceholderBullet(substituted));
});

test('checkUnownedBullets: a spaced-owner-substituted Backlog placeholder is not flagged backlog-unowned', () => {
  const templateRaw = readFileSync(join(KIT_ROOT_FOR_TEMPLATES, 'templates', 'global-STATE.md'), 'utf8');
  const bullet = templateRaw.split('\n').find((l) => l.trim().startsWith('- (queued cross-project items'));
  const substituted = bullet.replace(/__OWNER__/g, 'Jane Doe');
  const text = `## Backlog (owned)\n${substituted}\n`;
  assert.deepEqual(checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned'), []);
});

test('runStateLint --global: a home bootstrapped by `banana init` with a spaced owner name lints clean', async (t) => {
  const home = sandbox(t);
  const initIo = {
    out: () => {},
    err: () => {},
    prompt: async () => {
      throw new Error('prompt not expected in this test — owner is provided and yes:true');
    },
  };
  const initResult = await runInit(
    { owner: 'Jane Doe', tag: null, harnesses: [], yes: true, deliver: false },
    { home, io: initIo, isTTY: false, gitUserName: () => null, env: { PATH: '' } },
  );
  assert.equal(initResult.code, 0, `banana init itself must succeed: ${JSON.stringify(initResult)}`);

  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected a clean init to PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// =====================================================================
// #20b review item 6 — finding excerpts cut at CODE-POINT boundaries, not
// naive UTF-16 code units, so a surrogate pair is never split in half.
// =====================================================================

test('checkLineOverLimit: a 60-code-point excerpt cut never splits a surrogate pair (emoji) in half', () => {
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const emoji = '\u{1F600}'; // one code point, a 2-code-unit UTF-16 surrogate pair
  // "- " (2 code points) + 57 'x' (57 code points) = 59 code points before the
  // emoji, so the emoji is exactly the 60th code point — the correct cut
  // boundary includes it whole; a naive UTF-16 `.slice(0, 60)` would take
  // only its high-surrogate half.
  const head = '- ' + 'x'.repeat(57) + emoji;
  const line = bulletOfLength(head, limit + 100);
  const findings = checkLineOverLimit(`## ${name}\n${line}\n`);
  assert.equal(findings.length, 1);
  const msg = findings[0].message;

  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(loneSurrogate.test(line.slice(0, 60)), 'sanity: a naive UTF-16 .slice(0, 60) DOES split this surrogate pair');
  assert.ok(!loneSurrogate.test(msg), 'the excerpt in the finding message must never contain a lone surrogate half');
  assert.ok(msg.includes(emoji), 'the excerpt must include the WHOLE emoji, not a split half');
});

test('checkLineOverLimit: the length limit is JS UTF-16 CODE-UNIT length, not code-point/grapheme count (non-ASCII pin)', () => {
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const emoji = '\u{1F600}'; // 1 code point, 2 UTF-16 code units
  // "- " (2 units) + 1 emoji (2 units) + (limit - 4) 'x' (limit - 4 units) =
  // limit units total — exactly at the limit in UTF-16 code units, even
  // though it is only (limit - 1) code points. If the limit were measured
  // by code points or graphemes instead of `.length`, this would read as
  // UNDER the limit.
  const atLimitByCodeUnits = '- ' + emoji + 'x'.repeat(limit - 4);
  assert.equal(atLimitByCodeUnits.length, limit, 'sanity: UTF-16 .length is exactly the limit');
  assert.equal(
    Array.from(atLimitByCodeUnits).length,
    limit - 1,
    'sanity: code-point count is one LESS than .length',
  );
  assert.deepEqual(checkLineOverLimit(`## ${name}\n${atLimitByCodeUnits}\n`), []);

  const overLimitByCodeUnits = '- ' + emoji + 'x'.repeat(limit - 3); // one more code unit -> over
  const findings = checkLineOverLimit(`## ${name}\n${overLimitByCodeUnits}\n`);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes(String(limit + 1)));
});

// --- Wiring into lintGlobalState / runStateLint --global -------------------

test('lintGlobalState: a bullet over its section\'s char limit WARNs line-over-limit through the composed findings', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const text = CLEAN_GLOBAL.replace(
    '## Watch\n- an assumption needing validation (validate-by: 2026-10-01)',
    `## Watch\n${bulletOfLength('- an assumption ', limit + 1)}`,
  );
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'line-over-limit'), `expected line-over-limit: ${JSON.stringify(findings)}`);
});

test('lintGlobalState: an undated Recently-closed bullet WARNs closed-undated through the composed findings', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const text = CLEAN_GLOBAL.replace(
    '- gamma finished (closed 2026-09-01) — see alpha\'s logbook',
    '- gamma finished — see alpha\'s logbook',
  );
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'closed-undated'), `expected closed-undated: ${JSON.stringify(findings)}`);
});

test('lintGlobalState: a closed bullet 8+ days before the page\'s newest stamp WARNs closed-expired', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-09');
  const text = CLEAN_GLOBAL
    .replace('(as of 2026-09-01)', '(as of 2026-09-09)')
    .replace('- gamma finished (closed 2026-09-01) — see alpha\'s logbook', '- gamma finished (closed 2026-08-01) — see alpha\'s logbook');
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'closed-expired'), `expected closed-expired: ${JSON.stringify(findings)}`);
});

test('lintGlobalState: an Active thread stamped 31+ days before the page\'s newest stamp WARNs thread-inactive', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const text = CLEAN_GLOBAL.replace('(closed 2026-09-01)', '(closed 2026-10-10)');
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'thread-inactive'), `expected thread-inactive: ${JSON.stringify(findings)}`);
});

test('lintGlobalState: the clean global fixture stays zero-findings under all four new #20 checks, CRLF or LF', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  assert.deepEqual(lintGlobalState(CLEAN_GLOBAL, { home }), []);
  const crlf = CLEAN_GLOBAL.replace(/\n/g, '\r\n');
  assert.deepEqual(lintGlobalState(crlf, { home }), []);
});

test('runStateLint --global: a line-over-limit WARN exits 0, and the finding prints before the summary', async (t) => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const text = CLEAN_GLOBAL.replace(
    '- testagent — sweep the backlog',
    bulletOfLength('- testagent — sweep the backlog ', limit + 1),
  );
  const home = makeGlobalHome(t, text);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected WARN-only exit 0, got: ${res.lines.join('\n')}`);
  assert.ok(res.lines.some((l) => l.startsWith('WARN [line-over-limit]')));
  assert.ok(res.lines.at(-1)?.startsWith('state lint: WARN'));
});

test('SECTION_LINE_LIMITS / CLOSED_EXPIRY_DAYS / THREAD_INACTIVE_DAYS match the spec\'s exact shared constants', () => {
  assert.deepEqual(SECTION_LINE_LIMITS, {
    'Active threads': 400,
    'Backlog (owned)': 300,
    Watch: 350,
    'Recently closed (context for next session)': 250,
  });
  assert.equal(CLOSED_EXPIRY_DAYS, 7);
  assert.equal(THREAD_INACTIVE_DAYS, 30);
});
