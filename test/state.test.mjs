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
  bulletStampShapes,
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
  commentBoundaryFlags,
  DIRTY_MARKER_LINE,
  emitFindings,
  formatStateLintLines,
  globalReferenceDate,
  hasSection,
  isPlaceholderBullet,
  lintGlobalState,
  lintProjectState,
  oldestValidStamp,
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
  validateAgentTag,
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

test('isPlaceholderBullet: H41 — a placeholder carrying a trailing inline comment is still a placeholder, even on the RAW (comment-included) line', () => {
  assert.ok(
    isPlaceholderBullet(
      '- (queued cross-project items, each owned: `testagent — action` or an agent tag) <!-- keep while empty -->',
    ),
  );
  assert.ok(
    isPlaceholderBullet(
      '- (assumptions and deadlines needing attention, each with a validate-by date) <!-- keep while empty -->',
    ),
  );
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

test('formatStateLintLines: a FAIL project + a FAIL global prints findings in full (project first, then global) and the fix-it line', () => {
  // A FAIL global side must still print every finding verbatim (#20c E7:
  // the WARN-only one-line summary below never applies to a FAIL side).
  const lines = formatStateLintLines({
    project: {
      verdict: 'FAIL (1 fail, 0 warn)',
      findings: ['FAIL [missing-section] STATE.md: missing required section "## Blocked"'],
    },
    global: {
      verdict: 'FAIL (1 fail, 0 warn)',
      findings: ['FAIL [missing-section] ~/.agents/STATE.md: missing required section "## Watch"'],
    },
  });
  assert.deepEqual(lines, [
    'project: FAIL (1 fail, 0 warn) · global: FAIL (1 fail, 0 warn)',
    'FAIL [missing-section] STATE.md: missing required section "## Blocked"',
    'FAIL [missing-section] ~/.agents/STATE.md: missing required section "## Watch"',
    'Fix these before relying on the page: a FAIL means STATE no longer projects its sources.',
  ]);
});

// --- #20c E7: a WARN-only global side never dumps every #20 WARN verbatim
// into brief/log close — critic K1 measured the real page's block growing
// from 1 line to 19 (~5 KB) once #20's five WARN checks landed. One line
// stands in: the verdict, a count per finding TYPE, and a pointer to the
// standalone command. A FAIL global side is untouched by this (tested
// above) — only standalone `state lint` prints every WARN, and it never
// calls formatStateLintLines at all (confirmed by the dedicated
// runStateLint test further down, which still prints the WARN in full).

test('formatStateLintLines: a WARN-only global side collapses to one line — verdict, per-type counts, pointer to `state lint --global`', () => {
  const lines = formatStateLintLines({
    project: { verdict: 'PASS', findings: [] },
    global: {
      verdict: 'WARN (3 warn)',
      findings: [
        'WARN [line-over-limit] ~/.agents/STATE.md: a',
        'WARN [line-over-limit] ~/.agents/STATE.md: b',
        'WARN [closed-undated] ~/.agents/STATE.md: c',
      ],
    },
  });
  assert.deepEqual(lines, [
    'project: PASS · global: WARN (3 warn)',
    'global state lint: WARN (3 warn) (2 line-over-limit, 1 closed-undated) — run `banana state lint --global` for details',
  ]);
});

test('formatStateLintLines: a WARN-only global side never prints the fix-it line (no FAIL present)', () => {
  const lines = formatStateLintLines({
    project: { verdict: 'PASS', findings: [] },
    global: { verdict: 'WARN (1 warn)', findings: ['WARN [dirty-marker] ~/.agents/STATE.md: m'] },
  });
  assert.ok(!lines.some((l) => l.includes('Fix these before relying on the page')));
});

test('formatStateLintLines: a WARN-only global side still respects `quiet` the same as any other non-clean outcome', () => {
  const lines = formatStateLintLines(
    {
      project: { verdict: 'PASS', findings: [] },
      global: { verdict: 'WARN (1 warn)', findings: ['WARN [dirty-marker] ~/.agents/STATE.md: m'] },
    },
    { quiet: true },
  );
  assert.equal(lines[0], 'project: PASS · global: WARN (1 warn)');
  assert.ok(lines.some((l) => l.startsWith('global state lint: WARN')));
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

test('D2/H29: a multi-line comment preserves real text before "<!--" on its OPENING line and after "-->" on its CLOSING line', () => {
  const raw = '- **alpha** (as of 2026-09-30) — status → `~/p/STATE.md` <!-- note\nmore note --> tail\n';
  const text = prepareText(raw);
  assert.equal(text, '- **alpha** (as of 2026-09-30) — status → `~/p/STATE.md` \n tail\n');
});

test('topLevelBullets: D2/H29 — the bullet survives a multi-line comment tail carrying real text on both boundary lines', () => {
  const raw = '## Watch\n- **alpha** (as of 2026-09-30) — status → `~/p/STATE.md` <!-- note\nmore note --> tail\n';
  const text = prepareText(raw);
  assert.deepEqual(topLevelBullets(text, 'Watch'), ['- **alpha** (as of 2026-09-30) — status → `~/p/STATE.md` ']);
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

// =====================================================================
// F1 (#20e) — a "<!--" or "-->" quoted inside a backtick CODE SPAN is
// literal text (the E4 CommonMark rule), not a real comment boundary.
// blankNonSemanticRegions/stripCommentsFromLine must mask code spans
// (the same maskBacktickSpans rule bulletStampShapes/classifyOwnerBullet
// already apply) before scanning for comment markers.
// =====================================================================

test('D2/F1 (#20e): a "<!--" quoted inside a backtick code span is literal text, not a real comment opener — later lines are not blanked', () => {
  const raw = '## Watch\n- teach the lint that a `<!--` inside a code span is literal\n- second watch line\n';
  const text = prepareText(raw);
  assert.equal(text, raw);
});

test('D2/F1 (#20e): a "-->" quoted inside a backtick code span does not close a REAL comment opened earlier', () => {
  const raw = '## Watch\n<!-- real note\nquoting `-->` as example text\nstill inside -->\n- after\n';
  const text = prepareText(raw);
  assert.equal(text, '## Watch\n\n\n\n- after\n');
});

test('F1 (#20e, end-to-end): a Blocked bullet quoting "<!--" in a code span does not hide the sections after it from lintProjectState', () => {
  const raw = CLEAN_STATE.replace(
    '## Blocked\n- (none)\n',
    '## Blocked\n- waiting on review: teach the lint that a `<!--` inside a code span is literal\n',
  );
  const text = prepareText(raw);
  assert.equal(hasSection(text, 'Watch'), true);
  assert.equal(hasSection(text, 'Dead ends'), true);
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(
    !findings.some((f) => f.type === 'missing-section'),
    `no missing-section FAIL expected: ${JSON.stringify(findings)}`,
  );
});

// =====================================================================
// G3 (#20d, fixing C1/H6/H40/F3) — commentBoundaryFlags: the SAME
// open/close walk the archive used to do on its own, but fence-aware —
// `lib/state-archive.mjs` consumes this exported helper instead of its own
// fence-blind copy. Expected values below are written out independently,
// never computed by calling commentBoundaryFlags itself.
// =====================================================================

test('commentBoundaryFlags: G3 — an opener with no closer on its own line "leaves" inside the comment; the line that really closes it "enters" already inside one', () => {
  const rawLines = [
    '<!-- reviewed 2026-09-20: nothing new',
    '-->- cache: re-check by 2026-10-12',
    '- second watch line',
  ];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: true },
    { entering: true, leaving: false },
    { entering: false, leaving: false },
  ]);
});

test('commentBoundaryFlags: G3 — a comment that opens and closes on the SAME line never crosses a boundary', () => {
  const rawLines = ['- a bullet <!-- note --> with an inline comment'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [{ entering: false, leaving: false }]);
});

test('commentBoundaryFlags: G3/H6/H40/F3 — an unclosed "<!--" quoted inside a fenced example never opens a real comment; a plain bullet below the fence never crosses a boundary', () => {
  const rawLines = ['```', '<!-- unclosed example opener', '```', '- a plain bullet below the fence'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: false }, // fence opener line itself
    { entering: false, leaving: false }, // fenced content — never scanned for comments
    { entering: false, leaving: false }, // fence closer line itself
    { entering: false, leaving: false }, // real content below the fence — never crosses a boundary
  ]);
});

test('commentBoundaryFlags: G3/H40 — a real comment opened BEFORE a fence stays open across it, even when the fence quotes a literal "-->"', () => {
  const rawLines = ['<!-- owner notes:', '```', '-->', '```', '-->- a bullet that really closes the comment'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: true }, // opens, unclosed on its own line
    { entering: false, leaving: false }, // fence opener — blanked, carries the open comment through
    { entering: false, leaving: false }, // fenced "-->" — never a real closer
    { entering: false, leaving: false }, // fence closer — blanked
    { entering: true, leaving: false }, // the REAL closer, still inside the comment carried through the fence
  ]);
});

test('commentBoundaryFlags: F6 (#20e) — a genuinely UNFENCED middle line with no comment markers of its own still carries the open state through to the real closer two lines later', () => {
  const rawLines = ['<!-- reviewed 2026-09-20:', 'nothing new this week', '-->- cache: re-check by 2026-10-12'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: true },
    { entering: true, leaving: true },
    { entering: true, leaving: false },
  ]);
});

test('commentBoundaryFlags: F1 (#20e) — a "<!--" quoted inside a backtick code span is literal text, never opens a real comment', () => {
  const rawLines = ['- teach the lint that a `<!--` inside a code span is literal', '- second watch line'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: false },
    { entering: false, leaving: false },
  ]);
});

test('commentBoundaryFlags: F1 (#20e) — a "-->" quoted inside a backtick code span does not close a REAL comment carried in from an earlier line', () => {
  const rawLines = ['<!-- real note', 'quoting `-->` as example text', 'still inside -->', '- after'];
  assert.deepEqual(commentBoundaryFlags(rawLines), [
    { entering: false, leaving: true },
    { entering: true, leaving: true },
    { entering: true, leaving: false },
    { entering: false, leaving: false },
  ]);
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

test('checkClosedExpired: H54 — a real, non-expired stamp outside backticks governs even when an OLDER example stamp sits inside backticks on the same line (masking must never widen the oldest-stamp selection)', () => {
  const text =
    '## Recently closed (context for next session)\n' +
    '- gamma finished (closed 2026-01-08), e.g. `(closed 2020-01-01)` is the convention\n';
  const findings = checkClosedExpired(text, '2026-01-09');
  assert.deepEqual(findings, [], 'the backticked example stamp must never widen the oldest-stamp selection');
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

test('globalReferenceDate: H54 — a Recently-closed example stamp quoted inside backticks, NEWER than the real one, is never a candidate (masking must cover the closed-stamp read too)', () => {
  const text =
    '## Active threads\n- **alpha** (as of 2026-03-01) — real thread → memory a\n' +
    '## Recently closed (context for next session)\n' +
    '- gamma finished, e.g. `(closed 2099-01-01)` is the convention\n';
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

// =====================================================================
// #20c re-review fixes. Public-repo hygiene: every fixture below is
// synthetic. Each test's expected value is written out independently,
// never computed by calling the function under test.
// =====================================================================

// --- H42: an owner name containing a space can own a REAL bullet, not
// just a placeholder — #20b item 5 widened the PLACEHOLDER wildcard but
// left the OWNER MATCHER at a single-token `\S+`, so a page bootstrapped
// with a spaced owner lints clean only until the first real line in that
// owner's name is written.
// =====================================================================

test('classifyOwnerBullet: H42/G4 — a multi-word owner on a REAL (non-placeholder) bullet is owned WHEN it equals the page\'s declared owner', () => {
  assert.equal(classifyOwnerBullet('- Jane Doe — review the draft proposal', 'Jane Doe'), 'owned');
});

test('classifyOwnerBullet: H42/G4 — an owner whose LAST word happens to be "unowned" is still owned (the literal check is on the WHOLE captured token)', () => {
  // The owner token is everything up to the first " — "; "Jane unowned"
  // as a whole is not the literal string "unowned", so this must NOT be
  // caught by the unowned-literal check — a sanity guard that widening
  // the capture to `.+?` didn't also widen what counts as the literal.
  // G4 (#20d): a multi-word owner also needs to equal the declared owner.
  assert.equal(classifyOwnerBullet('- Jane unowned — pick this up', 'Jane unowned'), 'owned');
});

test('classifyOwnerBullet: G4 — a multi-word owner that does NOT equal the page\'s declared owner is unowned, even though a declared owner exists', () => {
  assert.equal(classifyOwnerBullet('- Someone Else — review the draft proposal', 'Jane Doe'), 'unowned');
});

test('classifyOwnerBullet: G4 — with no declared owner to compare against, a multi-word owner is unowned (falls to the single-word rule)', () => {
  assert.equal(classifyOwnerBullet('- Jane Doe — review the draft proposal'), 'unowned');
});

test('classifyOwnerBullet: G4/F4 — an em-dash quoted inside a code span is masked, so it is never read as the owner delimiter', () => {
  assert.equal(classifyOwnerBullet('- see `a — b` for details'), 'unowned');
});

// #20e F7: the test above is unowned EITHER way (masked: no em-dash left to
// match at all; unmasked: the captured owner "see `a" still has a space, so
// G4's multi-word rule catches it too) — it cannot tell masking from no
// masking. This fixture does: the captured owner is a SINGLE word either
// way (no space, so G4 never even applies), so only the masking decides
// whether a real owner delimiter is found at all.
test('classifyOwnerBullet: F7 (#20e) — a fixture where code-span masking actually changes the verdict: masked finds no owner delimiter, unmasked would', () => {
  assert.equal(classifyOwnerBullet('- `npm — test` fails on CI'), 'unowned');
  assert.equal(classifyOwnerBullet('- `claude — later` — note'), 'unowned');
});

test('classifyOwnerBullet: G4/F4 — prose before the first em-dash is not an owner unless it is the page\'s declared owner or a known agent tag', () => {
  assert.equal(classifyOwnerBullet('- review the draft — waiting on the vendor'), 'unowned');
  assert.equal(classifyOwnerBullet('- Unowned item — needs an owner'), 'unowned');
});

test('checkUnownedBullets: H42/G4 — a real Backlog bullet owned by a two-word name matching the declared owner is NOT flagged backlog-unowned', () => {
  const text = '## Backlog (owned)\n- Jane Doe — review the draft proposal\n';
  assert.deepEqual(checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned', 'Jane Doe'), []);
});

test('checkUnownedBullets: H42/G4 — a real project Next bullet owned by a two-word name matching the declared owner is NOT flagged unowned-next', () => {
  const text = '## Next\n- Jane Doe — fix the build\n';
  assert.deepEqual(checkUnownedBullets(text, 'Next', 'unowned-next', 'Jane Doe'), []);
});

test('checkUnownedBullets: G4/F4 — prose before an em-dash does not exempt a Backlog bullet from backlog-unowned', () => {
  const text = '## Backlog (owned)\n- Widget cleanup — needs a volunteer\n';
  const findings = checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'backlog-unowned');
});

test('runStateLint --global: H42 — a home bootstrapped with a spaced owner lints clean after writing a REAL Backlog line in that owner\'s name', async (t) => {
  const home = sandbox(t);
  const initIo = { out: () => {}, err: () => {}, prompt: async () => { throw new Error('not expected'); } };
  const initResult = await runInit(
    { owner: 'Jane Doe', tag: null, harnesses: [], yes: true, deliver: false },
    { home, io: initIo, isTTY: false, gitUserName: () => null, env: { PATH: '' } },
  );
  assert.equal(initResult.code, 0);
  const stateMdPath = join(home, '.agents', 'STATE.md');
  const withRealBullet = readFileSync(stateMdPath, 'utf8').replace(
    '- (queued cross-project items, each owned: `Jane Doe — action` or an agent tag)',
    '- Jane Doe — review the draft proposal',
  );
  assert.notEqual(withRealBullet, readFileSync(stateMdPath, 'utf8'), 'sanity: the replace actually hit');
  writeFileSync(stateMdPath, withRealBullet, 'utf8');
  const res = await runGlobal(home);
  assert.equal(res.code, 0, `expected PASS, got: ${res.lines.join('\n')}`);
  assert.deepEqual(res.lines, ['state lint: PASS']);
});

// =====================================================================
// E3 — H67: a bullet whose only content is an HTML comment is not a
// bullet at all (D2's span-only blanking reduces `- <!-- note -->` to the
// bare marker `- `, which every OTHER check then misread as a real, empty
// bullet). H68: a `- - -` / `* * *` thematic break is a RULE, not a
// bullet, even though its own first marker satisfies BULLET_MARKER_RE.
// =====================================================================

test('topLevelBullets: E3/H67 — a bullet whose only content is an HTML comment is not a bullet, in either grain', () => {
  const globalText = prepareText('## Active threads\n- <!-- nothing in flight -->\n');
  assert.deepEqual(topLevelBullets(globalText, 'Active threads'), []);
  const projectText = prepareText('## Next\n- <!-- owner — action, once we know -->\n');
  assert.deepEqual(topLevelBullets(projectText, 'Next'), []);
});

test('topLevelBullets: E3/H67 — the multi-line comment form behaves the same way', () => {
  const text = prepareText('## Watch\n- <!--\n  nothing yet\n-->\n');
  assert.deepEqual(topLevelBullets(text, 'Watch'), []);
});

test('lintGlobalState: E3/H67 — a page whose only Active/Backlog/Closed content is a commented-out bullet lints clean', (t) => {
  const home = sandbox(t);
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- <!-- nothing in flight -->',
    '',
    '## Backlog (owned)',
    '- <!-- add items -->',
    '',
    '## Watch',
    '- x',
    '',
    '## Recently closed (context for next session)',
    '- <!-- none yet -->',
    '',
  ].join('\n');
  assert.deepEqual(lintGlobalState(text, { home }), []);
});

test('lintProjectState: E3/H67 — a `## Next` holding only a commented-out bullet does not FAIL unowned-next', () => {
  const text = CLEAN_STATE.replace(
    '- testagent — ship the next slice\n- ahimsa — review the shipped slice',
    '- <!-- owner — action, once we know -->',
  );
  const findings = lintProjectState(text, { logbookText: CLEAN_LOGBOOK, sessionEntries: [] });
  assert.ok(!findings.some((f) => f.type === 'unowned-next'), JSON.stringify(findings));
});

test('topLevelBullets: E3/H68 — a `- - -` / `* * *` thematic break is a RULE, not a bullet, in every section', () => {
  const text = prepareText('## Recently closed (context for next session)\n- - -\n* * *\n');
  assert.deepEqual(topLevelBullets(text, 'Recently closed (context for next session)'), []);
});

test('checkClosedUndated: E3/H68 — a thematic break between Recently-closed bullets is never flagged closed-undated', () => {
  const text = '## Recently closed (context for next session)\n- - -\n- gamma finished (closed 2026-09-01)\n';
  assert.deepEqual(checkClosedUndated(text), []);
});

test('checkUnownedBullets: E3/H68 — a thematic break in Backlog is never flagged backlog-unowned', () => {
  const text = '## Backlog (owned)\n* * *\n- testagent — sweep the backlog\n';
  assert.deepEqual(checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned'), []);
});

// =====================================================================
// E4 — the CommonMark code-span rule: a run of N backticks is closed only
// by a LATER run of exactly N backticks; an unpaired run is literal text.
// H8: the pre-E4 toggle-per-backtick masked everything after an unpaired
// (apostrophe-typo) backtick, hiding a real stamp. H61: the pre-E4 toggle
// read a double-backtick span as two EMPTY single-backtick spans, leaving
// its content (including a stamp) unmasked.
// =====================================================================

test('bulletStampShapes: E4/H8 — an unpaired backtick no longer masks a real stamp after it', () => {
  assert.deepEqual(bulletStampShapes("- **x** → `~/p/STATE.md` — won`t ship (as of 2026-09-30)"), ['2026-09-30']);
});

test('checkActiveThreads: E4/H8 — an unpaired backtick no longer hides a real stamp, end to end', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'p', 'STATE.md'), '2026-09-01');
  const text = "## Active threads\n- **x** → `~/projects/p/STATE.md` — won`t ship (as of 2026-09-30)\n";
  const findings = checkActiveThreads(text, home);
  assert.ok(!findings.some((f) => f.type === 'thread-unstamped'), JSON.stringify(findings));
});

test('checkClosedUndated: E4/H8 — an unpaired backtick no longer hides a real "(closed ...)" stamp', () => {
  const text = "## Recently closed (context for next session)\n- didn`t ship docs (closed 2026-09-30)\n";
  assert.deepEqual(checkClosedUndated(text), []);
});

test('bulletStampShapes: E4/H61 — a double-backtick span masks as ONE span, not two empty single-backtick ones', () => {
  assert.deepEqual(bulletStampShapes('- e.g. ``(as of 2099-01-01)`` more text'), []);
});

test('bulletStampShapes: E4 — a double-backtick span containing a literal single backtick is still masked whole (CommonMark pairing)', () => {
  assert.deepEqual(bulletStampShapes('- ``quoted `code` (as of 2099-01-01)`` text'), []);
});

test('globalReferenceDate: E4/H61 — a double-backtick-quoted example stamp never becomes the reference date', () => {
  const text = [
    '## Active threads',
    '- **alpha** — e.g. ``(as of 2099-01-01)`` → memory a',
    '- **beta** (as of 2026-01-01) — real thread → memory b',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-01-01');
});

// =====================================================================
// H43/C50 — trimLine (the 120-char FAIL excerpt) is cut at CODE POINTS,
// same as excerpt60's cut, never a naive UTF-16 slice (C50's existing pin
// covers only excerpt60/line-over-limit; trimLine was still unpinned).
// =====================================================================

test('checkUnownedBullets: H43/C50 — the FAIL excerpt (trimLine) is cut at 120 CODE POINTS, never splitting a surrogate pair', () => {
  const emoji = '\u{1F680}'; // one code point, a UTF-16 surrogate pair
  // "- " (2 code points) + 117 'x' (117 code points) = 119 code points
  // before the emoji, so it sits exactly at the 120th code point — the
  // correct cut includes it whole; a naive UTF-16 `.slice(0, 120)` would
  // take only its high-surrogate half. No em-dash anywhere, so this is
  // unowned by the "no em-dash at all" rule, independent of the owner regex.
  const line = '- ' + 'x'.repeat(117) + emoji + ' and plenty more unowned prose after it';
  const findings = checkUnownedBullets(`## Next\n${line}\n`, 'Next', 'unowned-next');
  assert.equal(findings.length, 1);
  const msg = findings[0].message;
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(loneSurrogate.test(line.slice(0, 120)), 'sanity: a naive UTF-16 .slice(0, 120) DOES split this surrogate pair');
  assert.ok(!loneSurrogate.test(msg), 'the FAIL message must never contain a lone surrogate half');
  assert.ok(msg.includes(emoji), 'the excerpt must include the WHOLE emoji, not a split half');
});

// =====================================================================
// E1/C15/H11 — a WARN's printed excerpt is cut from the RAW page line
// (comment included), never the fence/comment-blanked line every other
// check reads: when a bullet carries an inline comment inside its first
// 60 code points, an excerpt cut from the PREPARED line (with the comment
// span already removed) is NOT a substring of the page, so pasting it as
// `--match` fails with "no line matches" — even though the decision (the
// bullet IS over the limit) is still made on the prepared line.
// =====================================================================

test('checkLineOverLimit: E1/C15/H11 — the excerpt is a substring of the RAW page line, comment included, through the real lintGlobalState pipeline', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  // The comment sits inside the first 60 code points of the RAW line; the
  // PREPARED (comment-blanked) line reads differently there — an excerpt
  // cut from the prepared line would not be a substring of the raw page.
  const rawLine = bulletOfLength('- Commented <!-- note --> watch word ', limit + 20);
  const text = CLEAN_GLOBAL.replace(
    '- an assumption needing validation (validate-by: 2026-10-01)',
    rawLine,
  );
  const findings = lintGlobalState(text, { home });
  const overLimit = findings.find((f) => f.type === 'line-over-limit');
  assert.ok(overLimit, `expected line-over-limit: ${JSON.stringify(findings)}`);
  const quoted = overLimit.message.match(/: "([^"]*)" —/);
  assert.ok(quoted, overLimit.message);
  assert.ok(rawLine.includes(quoted[1]), `excerpt "${quoted[1]}" must be a substring of the RAW page line`);
});

// F13 — C15/H11's own pin covers only line-over-limit; the other four
// #20 WARNs that name --match (bullet-wrapped, closed-undated,
// closed-expired, thread-inactive) need the SAME pin, through the SAME
// real lintGlobalState pipeline, or a revert to the prepared-line excerpt
// on any of them goes uncaught.

test('checkBulletWrapped: E1/C15/H11/F13 — the excerpt is a substring of the RAW page line, comment included, through the real lintGlobalState pipeline', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const rawLine = '- Commented <!-- note --> wrapped watch word';
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- **alpha** (as of 2026-09-01) — building the thing → memory a',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    rawLine,
    '  a continuation line',
    '',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-09-01) — see alpha\'s logbook',
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home });
  const wrapped = findings.find((f) => f.type === 'bullet-wrapped');
  assert.ok(wrapped, `expected bullet-wrapped: ${JSON.stringify(findings)}`);
  const quoted = wrapped.message.match(/: "([^"]*)" —/);
  assert.ok(quoted, wrapped.message);
  assert.ok(rawLine.includes(quoted[1]), `excerpt "${quoted[1]}" must be a substring of the RAW page line`);
});

test('checkClosedUndated: E1/C15/H11/F13 — the excerpt is a substring of the RAW page line, comment included, through the real lintGlobalState pipeline', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const rawLine = '- gamma <!-- note --> finished, no stamp here';
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- **alpha** (as of 2026-09-01) — building the thing → memory a',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    '- an assumption needing validation (validate-by: 2026-10-01)',
    '',
    '## Recently closed (context for next session)',
    rawLine,
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home });
  const undated = findings.find((f) => f.type === 'closed-undated');
  assert.ok(undated, `expected closed-undated: ${JSON.stringify(findings)}`);
  const quoted = undated.message.match(/"([^"]*)"$/);
  assert.ok(quoted, undated.message);
  assert.ok(rawLine.includes(quoted[1]), `excerpt "${quoted[1]}" must be a substring of the RAW page line`);
});

test('checkClosedExpired: E1/C15/H11/F13 — the excerpt is a substring of the RAW page line, comment included, through the real lintGlobalState pipeline', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const rawLine = '- gamma <!-- note --> finished (closed 2026-01-01)';
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- **alpha** (as of 2026-09-01) — building the thing → memory a',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    '- an assumption needing validation (validate-by: 2026-10-01)',
    '',
    '## Recently closed (context for next session)',
    rawLine,
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home });
  const expired = findings.find((f) => f.type === 'closed-expired');
  assert.ok(expired, `expected closed-expired: ${JSON.stringify(findings)}`);
  const quoted = expired.message.match(/: "([^"]*)" —/);
  assert.ok(quoted, expired.message);
  assert.ok(rawLine.includes(quoted[1]), `excerpt "${quoted[1]}" must be a substring of the RAW page line`);
});

test('checkThreadInactive: E1/C15/H11/F13 — the excerpt is a substring of the RAW page line, comment included, through the real lintGlobalState pipeline', (t) => {
  const home = sandbox(t);
  const rawLine = '- **eta** <!-- note --> (as of 2026-01-01) — idle with a note. → memory eta';
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    rawLine,
    '- **zeta** (as of 2026-09-01) — newer thread, sets the reference date → memory zeta',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    '- an assumption needing validation (validate-by: 2026-10-01)',
    '',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-09-01) — see alpha\'s logbook',
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home: sandbox(t) });
  const inactive = findings.find((f) => f.type === 'thread-inactive');
  assert.ok(inactive, `expected thread-inactive: ${JSON.stringify(findings)}`);
  const quoted = inactive.message.match(/: "([^"]*)" —/);
  assert.ok(quoted, inactive.message);
  assert.ok(rawLine.includes(quoted[1]), `excerpt "${quoted[1]}" must be a substring of the RAW page line`);
});

// =====================================================================
// E2 (refining D1): the continuation scan reads RAW lines (never
// fence/comment-blanked), so an INDENTED fence/comment and its body are
// absorbed as continuation "whatever they hold" (C4), while a comment-only
// line at column 0 is a barrier but NEVER the loose-paragraph's "one
// blank separator" (H9). topLevelBulletContinuationCounts' third
// (optional) `rawLines` argument carries the true raw lines in these
// fixtures — the first two args alone (defaulting rawLines to the
// prepared text) would reproduce the OLD, wrong behavior these tests
// pin against.
// =====================================================================

test('topLevelBulletContinuationCounts: E2/C4 — an INDENTED fence mid-bullet, with prose after it, is captured whole (not split)', () => {
  const raw = [
    '## Watch',
    '- beta-watch: re-check with this command.',
    '  ```powershell',
    '  Get-PSDrive C,D',
    '  ```',
    '  then compare. Validate-by 2026-10-12.',
    '- sibling',
    '',
  ].join('\n');
  const rawLines = raw.split('\n');
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch', rawLines), [4, 0]);
});

test('topLevelBulletContinuationCounts: E2/C4 — a bullet whose ENTIRE continuation is an indented fence (nothing follows it)', () => {
  const raw = ['## Watch', '- beta-watch: see below.', '  ```', '  fenced content', '  ```', ''].join('\n');
  const rawLines = raw.split('\n');
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch', rawLines), [3]);
});

test('topLevelBulletContinuationCounts: E2/C4 — an INDENTED multi-line comment mid-bullet, with prose after it, is captured whole', () => {
  const raw = [
    '## Watch',
    '- beta-watch: re-check per note.',
    '  <!-- internal note',
    '  spans two lines -->',
    '  then compare. Validate-by 2026-10-12.',
    '- sibling',
    '',
  ].join('\n');
  const rawLines = raw.split('\n');
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch', rawLines), [3, 0]);
});

test('topLevelBulletContinuationCounts: H9 — a comment-only line at column 0 ends the bullet, and is NEVER the loose-paragraph\'s one blank separator', () => {
  const raw = [
    '## Watch',
    '- Cache check: 3 GB used (validate-by 2026-10-12)',
    '<!-- the next line is an unrelated section note -->',
    '  numbers measured with dir /s',
    '',
  ].join('\n');
  const rawLines = raw.split('\n');
  // Pre-H9 fix: the comment blanked to one empty line, which the loose
  // rule misread as the "exactly one blank" separator, counting the
  // comment line PLUS the indented line after it as continuation ([2] or
  // [3]). Correct: the comment-only line is a barrier; the bullet has
  // ZERO continuation lines, and the indented paragraph is NOT its tail.
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch', rawLines), [0]);
});

test('checkBulletWrapped: H9 — the comment-only-line case through the real WARN check, not just the helper', () => {
  const raw = [
    '## Watch',
    '- Cache check: 3 GB used (validate-by 2026-10-12)',
    '<!-- the next line is an unrelated section note -->',
    '  numbers measured with dir /s',
    '',
  ].join('\n');
  const rawLines = raw.split('\n');
  assert.deepEqual(checkBulletWrapped(prepareText(raw), rawLines), []);
});

// =====================================================================
// H31 — every D1/E2 barrier type pinned by more than one representative;
// H59 — the loose-paragraph rule's exact thresholds (one blank only, 2+
// spaces or a tab, every contiguous indented line counted).
// =====================================================================

test('topLevelBulletContinuationCounts: H31 — a level-4 heading ("####") ends the bullet, not just "###"', () => {
  const raw = '## Watch\n- item\n#### Notes\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: H31 — a "***" thematic break ends the bullet, not just "---"', () => {
  const raw = '## Watch\n- item\n***\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: H31 — a blank line then a TAB-indented paragraph counts as continuation, not just 2-space', () => {
  const raw = '## Watch\n- item\n\n\tindented with a tab\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [2]);
});

test('topLevelBulletContinuationCounts: H59 — TWO blank lines in a row end the bullet; the loose rule needs EXACTLY one', () => {
  const raw = '## Watch\n- item\n\n\n  indented\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: H59 — a single leading space after the blank does not count as indented (needs 2+ spaces or a tab)', () => {
  const raw = '## Watch\n- item\n\n x one-space\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: H59 — every contiguous indented line after the one blank is counted, not just the first', () => {
  const raw = '## Watch\n- item\n\n  line one\n  line two\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [3]);
});

test('topLevelBulletContinuationCounts: H31 — a "___" thematic break ends the bullet, not just "---"/"***"', () => {
  const raw = '## Watch\n- item\n___\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: H31 — level-5 AND level-6 headings ("#####"/"######") both end the bullet, not just up to "####"', () => {
  const raw5 = '## Watch\n- item\n##### Notes\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw5), 'Watch'), [0]);
  const raw6 = '## Watch\n- item\n###### Notes\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw6), 'Watch'), [0]);
});

// =====================================================================
// G5 (#20d, fixing H59/F2) — a line of ONLY spaces/tabs after a bullet is
// blank for the continuation rule, never a continuation line (even though
// it also matches the 2-space/tab INDENTED shape): the blank check must
// run BEFORE the indented check, and a blank's own lookahead must require
// the NEXT line to be non-blank too.
// =====================================================================

test('topLevelBulletContinuationCounts: G5/H59/F2 — a line of only two spaces right after the bullet is blank, not an indented continuation', () => {
  const raw = '## Watch\n- item\n  \n- sibling\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0, 0]);
});

test('topLevelBulletContinuationCounts: G5/H59/F2 — a TAB-only line right after the bullet is blank, not an indented continuation', () => {
  const raw = '## Watch\n- item\n\t\n### Notes\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('topLevelBulletContinuationCounts: G5/H59/F2 — a whitespace-only SECOND blank line still ends the bullet (the lookahead needs a non-blank indented line, not merely an indented-SHAPED one)', () => {
  const raw = '## Watch\n- item\n\n  \n  indented\n';
  assert.deepEqual(topLevelBulletContinuationCounts(prepareText(raw), 'Watch'), [0]);
});

test('checkBulletWrapped: G5/H59/F2 — a whitespace-only line after a bullet never WARNs bullet-wrapped (through the real check, not just the helper)', () => {
  const text = '## Watch\n- item\n  \n- sibling\n';
  assert.deepEqual(checkBulletWrapped(text), []);
});

test('lintGlobalState: G5/H59/F2 — a whitespace-only line after a real Backlog bullet lints clean (no false bullet-wrapped) through the composed findings', (t) => {
  const home = sandbox(t);
  const text = CLEAN_GLOBAL.replace('- testagent — sweep the backlog\n', '- testagent — sweep the backlog\n  \n');
  const findings = lintGlobalState(text, { home });
  assert.ok(!findings.some((f) => f.type === 'bullet-wrapped'), JSON.stringify(findings));
});

// =====================================================================
// H76 — a bullet that is BOTH over its section limit AND wrapped WARNs
// both independently; neither check suppresses the other.
// =====================================================================

test('checkLineOverLimit + checkBulletWrapped: H76 — a bullet over its limit AND wrapped WARNs both, together', () => {
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const firstLine = bulletOfLength('- a long watch bullet ', limit + 50);
  const text = `## ${name}\n${firstLine}\n  a continuation line\n`;
  const overLimit = checkLineOverLimit(text);
  const wrapped = checkBulletWrapped(text);
  assert.equal(overLimit.length, 1, `expected line-over-limit: ${JSON.stringify(overLimit)}`);
  assert.equal(wrapped.length, 1, `expected bullet-wrapped: ${JSON.stringify(wrapped)}`);
});

// =====================================================================
// C28 — line-over-limit through lintGlobalState on a CRLF page, boundary
// exact, with NO hand normalization by the test itself.
// =====================================================================

test('lintGlobalState: C28 — a CRLF global page with a Backlog bullet EXACTLY at its limit stays clean', (t) => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const atLimit = CLEAN_GLOBAL.replace(
    '- testagent — sweep the backlog',
    bulletOfLength('- testagent — sweep the backlog ', limit),
  );
  const crlf = atLimit.replace(/\n/g, '\r\n');
  assert.deepEqual(lintGlobalState(crlf, { home }), []);
});

test('lintGlobalState: C28 — the same CRLF page one char over the limit WARNs exactly once', (t) => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const overLimit = CLEAN_GLOBAL.replace(
    '- testagent — sweep the backlog',
    bulletOfLength('- testagent — sweep the backlog ', limit + 1),
  );
  const crlf = overLimit.replace(/\n/g, '\r\n');
  const findings = lintGlobalState(crlf, { home });
  assert.equal(findings.filter((f) => f.type === 'line-over-limit').length, 1, JSON.stringify(findings));
});

// =====================================================================
// C44 — the reference date's scope: Watch/Backlog stamps never count,
// and it is computed from the PREPARED (fence/comment-blanked) text, not
// a hand-normalized or raw one.
// =====================================================================

test('globalReferenceDate: C44 — stamps in Watch/Backlog never count toward the reference date', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-09-30) — real thread → memory a',
    '## Backlog (owned)',
    '- testagent — reopen gamma (closed 2026-12-15)',
    '## Watch',
    '- vendor quote validity (as of 2026-12-01)',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-09-29)',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-09-30');
});

test('lintGlobalState: C44 — a Watch/Backlog stamp never makes a real thread read inactive or a real closed line read expired', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-30');
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- **alpha** (as of 2026-09-30) — real thread → `~/projects/alpha/STATE.md`',
    '',
    '## Backlog (owned)',
    '- testagent — reopen gamma (closed 2026-12-15)',
    '',
    '## Watch',
    '- vendor quote validity (as of 2026-12-01)',
    '',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-09-29)',
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home });
  assert.ok(!findings.some((f) => f.type === 'thread-inactive'), JSON.stringify(findings));
  assert.ok(!findings.some((f) => f.type === 'closed-expired'), JSON.stringify(findings));
});

test('lintGlobalState: C44/F14 — a hidden stamp on Active threads (a MULTI-LINE comment) or Recently closed (a FENCED bullet) never feeds the reference date', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-30');
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '<!--',
    '- **hidden** (as of 2099-01-01) — commented out',
    '-->',
    '- **alpha** (as of 2026-09-30) — real thread → `~/projects/alpha/STATE.md`',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    '- an assumption needing validation (validate-by: 2026-10-01)',
    '',
    '## Recently closed (context for next session)',
    '```',
    '- gamma finished (closed 2099-01-01)',
    '```',
    '- delta finished (closed 2026-09-29)',
    '',
  ].join('\n');
  // Red-first sanity: this fixture can tell PREPARED text from RAW text —
  // unlike the single-line `<!-- - **hidden** ... -->` shape, where
  // isTopLevelBulletLine fails on BOTH raw and prepared text (the line
  // starts with `<!--` either way), so no mutation of this test's own
  // reach could ever turn it red (F14).
  assert.equal(
    globalReferenceDate(prepareText(text)),
    '2026-09-30',
    'sanity: the hidden (2099-01-01) stamps must never win on the PREPARED text',
  );
  const findings = lintGlobalState(text, { home });
  assert.ok(
    !findings.some((f) => f.type === 'thread-inactive' || f.type === 'closed-expired'),
    JSON.stringify(findings),
  );
});

// =====================================================================
// C45 — checkLineOverLimit's own 60-code-point cut, independently
// computed (not merely "the message includes a short marker").
// H58 — the SAME 60-code-point cut (excerpt60, not trimLine's 120)
// pinned for the other four excerpt-bearing WARNs too.
// =====================================================================

test('checkLineOverLimit: C45 — the excerpt is exactly the first 60 code points, independently computed', () => {
  const name = 'Active threads';
  const limit = SECTION_LINE_LIMITS[name];
  const line = bulletOfLength('- alpha ', limit + 200);
  const findings = checkLineOverLimit(`## ${name}\n${line}\n`);
  assert.equal(findings.length, 1);
  const expected60 = Array.from(line).slice(0, 60).join('');
  const expected61 = Array.from(line).slice(0, 61).join('');
  assert.ok(findings[0].message.includes(`"${expected60}"`), findings[0].message);
  assert.ok(!findings[0].message.includes(expected61), 'must not leak a 61st code point (that would mean trimLine\'s 120 cut, not excerpt60\'s 60)');
});

// H58's own emoji helper: 59 code points, then an emoji as the 60th — the
// same shape the line-over-limit emoji test (above) uses. A naive UTF-16
// `.slice(0, 60)` cuts the emoji's surrogate pair in half; `excerpt60`'s
// code-point cut must not. A plain ASCII-padded fixture (the tests' OLD
// shape) cannot tell `excerpt60` apart from a UTF-16 `.slice(0, 60)`, since
// both give the identical result on ASCII text.
const H58_EMOJI = '\u{1F600}';
const H58_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const H58_HEAD = '- ' + 'x'.repeat(57) + H58_EMOJI; // 60 code points exactly

/** Assert findings[0]'s excerpt is exactly the 60-code-point H58_HEAD, emoji whole. */
function assertH58Excerpt(message, line) {
  const expected60 = Array.from(line).slice(0, 60).join('');
  const expected61 = Array.from(line).slice(0, 61).join('');
  assert.equal(expected60, H58_HEAD, 'sanity: the emoji sits exactly at code point 60');
  assert.ok(message.includes(`"${expected60}"`), message);
  assert.ok(!message.includes(expected61), 'must not leak a 61st code point (trimLine\'s 120 cut, not excerpt60\'s 60)');
  assert.ok(!H58_LONE_SURROGATE.test(message), 'the excerpt must never contain a lone surrogate half');
  assert.ok(message.includes(H58_EMOJI), 'the excerpt must include the WHOLE emoji, not a split half');
}

test('checkBulletWrapped: H58 — the excerpt is cut at 60 CODE POINTS, not trimLine\'s 120 UTF-16 units (emoji at the cut)', () => {
  const name = 'Watch';
  const limit = SECTION_LINE_LIMITS[name];
  const line = bulletOfLength(H58_HEAD, limit + 100);
  const text = `## ${name}\n${line}\n  a continuation line\n`;
  const findings = checkBulletWrapped(text);
  assert.equal(findings.length, 1);
  assertH58Excerpt(findings[0].message, line);
});

test('checkClosedUndated: H58 — the excerpt is cut at 60 CODE POINTS, not trimLine\'s 120 UTF-16 units (emoji at the cut)', () => {
  const name = 'Recently closed (context for next session)';
  const limit = SECTION_LINE_LIMITS[name];
  const line = bulletOfLength(H58_HEAD, limit + 100);
  const findings = checkClosedUndated(`## ${name}\n${line}\n`);
  assert.equal(findings.length, 1);
  assertH58Excerpt(findings[0].message, line);
});

test('checkClosedExpired: H58 — the excerpt is cut at 60 CODE POINTS, not trimLine\'s 120 UTF-16 units (emoji at the cut)', () => {
  const name = 'Recently closed (context for next session)';
  const limit = SECTION_LINE_LIMITS[name];
  const line = bulletOfLength(H58_HEAD, limit + 100) + ' (closed 2026-01-01)';
  const findings = checkClosedExpired(`## ${name}\n${line}\n`, '2026-02-01');
  assert.equal(findings.length, 1);
  assertH58Excerpt(findings[0].message, line);
});

test('checkThreadInactive: H58 — the excerpt is cut at 60 CODE POINTS, not trimLine\'s 120 UTF-16 units (emoji at the cut)', () => {
  const name = 'Active threads';
  const limit = SECTION_LINE_LIMITS[name];
  const line = bulletOfLength(H58_HEAD, limit + 100) + ' (as of 2026-01-01)';
  const findings = checkThreadInactive(`## ${name}\n${line}\n`, '2026-06-01', NOHOME);
  assert.equal(findings.length, 1);
  assertH58Excerpt(findings[0].message, line);
});

// =====================================================================
// C55 — the stamp keyword is per-section: an "(as of ...)" on a
// Recently-closed line, or a "(closed ...)" on an Active-threads line,
// never counts for the OTHER section's checks (only one of four mutants
// was previously pinned).
// =====================================================================

test('checkClosedExpired: C55 — an "(as of ...)" stamp on a Recently-closed bullet is never read by this check', () => {
  const text = '## Recently closed (context for next session)\n- **beta** (as of 2026-08-01) — shipped (closed 2026-09-30)\n';
  assert.deepEqual(checkClosedExpired(text, '2026-09-30'), []);
});

test('globalReferenceDate: C55 — an "(as of ...)" stamp on a Recently-closed bullet never feeds the reference date', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — old thread → memory a',
    '## Recently closed (context for next session)',
    '- gamma (as of 2026-12-31) finished, no closed stamp',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-01-01');
});

test('checkThreadInactive: C55 — a "(closed ...)" stamp on an Active-threads bullet is never read by this check', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-09-25) — reopened, was (closed 2026-07-01) → memory a\n';
  assert.deepEqual(checkThreadInactive(text, '2026-09-30', NOHOME), []);
});

// =====================================================================
// C56/H28 — an impossible date is filtered on the CLOSED side of
// globalReferenceDate and in BOTH age checks, with the impossible date
// chosen so Date.UTC's month/day rollover still lands BEFORE the
// reference — the existing 2026-13-45 fixtures roll forward PAST every
// reference date used, so the filter's absence can never change their
// (already-skipped) outcome.
// =====================================================================

test('checkClosedExpired: C56/H28 — an impossible (closed 2025-02-30) stamp is filtered, never rolled forward into a false WARN', () => {
  const text = '## Recently closed (context for next session)\n- gamma unique (closed 2025-02-30)\n';
  assert.deepEqual(checkClosedExpired(text, '2026-01-09'), []);
});

test('checkThreadInactive: C56/H28 — an impossible (as of 2026-02-30) stamp is filtered, never rolled forward into a false WARN', () => {
  const text = '## Active threads\n- **alpha** (as of 2026-02-30) — unique thread → memory a\n';
  assert.deepEqual(checkThreadInactive(text, '2026-06-01', NOHOME), []);
});

test('globalReferenceDate: C56/H28 — an impossible (closed ...) stamp never becomes the reference date', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-09-25) — real thread → memory a',
    '## Recently closed (context for next session)',
    '- gamma (closed 2026-19-01)',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-09-25');
});

// =====================================================================
// C29 — re-pin the four placeholder exemptions (checkLineOverLimit,
// globalReferenceDate, checkClosedExpired, checkThreadInactive) with a
// WILDCARD-SUBSTITUTED placeholder that WOULD be flagged if the exemption
// were not applied — the original removed tests used template text far
// too short/undated to ever reach the skip.
// =====================================================================

test('checkLineOverLimit: C29/P1 — the Backlog placeholder stays exempt even when its substituted owner pushes the WHOLE bullet over the limit', () => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const longOwner = 'x'.repeat(320);
  const bullet = `- (queued cross-project items, each owned: \`${longOwner} — action\` or an agent tag)`;
  assert.ok(bullet.length > limit, 'sanity: the substituted placeholder now exceeds the Backlog limit');
  assert.ok(isPlaceholderBullet(bullet), 'sanity: still recognized as a placeholder');
  assert.deepEqual(checkLineOverLimit(`## ${name}\n${bullet}\n`), []);
});

test('checkClosedExpired: C29/P2 — a Recently-closed bullet matching the PROJECT Next placeholder\'s wildcard, with an old stamp, stays exempt', () => {
  const bullet = '- beta (closed 2026-01-01) — (owned actions only; unowned items are not allowed here)';
  assert.ok(isPlaceholderBullet(bullet), 'sanity: matches the wildcard-substituted project placeholder');
  const text = `## Recently closed (context for next session)\n${bullet}\n`;
  assert.deepEqual(checkClosedExpired(text, '2026-09-01'), []);
});

test('checkThreadInactive: C29/P3 — an Active-threads bullet matching the PROJECT Next placeholder\'s wildcard, with an old stamp, stays exempt', () => {
  const bullet = '- gamma (as of 2026-01-01) — (owned actions only; unowned items are not allowed here)';
  assert.ok(isPlaceholderBullet(bullet), 'sanity: matches the wildcard-substituted project placeholder');
  const text = `## Active threads\n${bullet}\n`;
  assert.deepEqual(checkThreadInactive(text, '2026-09-01', NOHOME), []);
});

test('globalReferenceDate: C29/P4 — a Recently-closed bullet matching the placeholder wildcard, even carrying the NEWEST stamp, stays exempt', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — real thread → memory a',
    '## Recently closed (context for next session)',
    '- beta (closed 2026-06-01) — (owned actions only; unowned items are not allowed here)',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-01-01');
});

test('globalReferenceDate: C29/P5 — an Active-threads bullet matching the placeholder wildcard, even carrying the NEWEST stamp, stays exempt', () => {
  const text = [
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — real thread → memory a',
    '- delta (as of 2026-06-01) — (owned actions only; unowned items are not allowed here)',
  ].join('\n');
  assert.equal(globalReferenceDate(text), '2026-01-01');
});

// =====================================================================
// H36 — bulletIsThreadStale's malformed-stamp guard (thread-inactive
// suppression requires ALL of the bullet's stamps to be valid; it mirrors
// checkActiveThreads "exactly").
// =====================================================================

test('checkThreadInactive: H36 — a malformed stamp alongside a valid one is never treated as "all stamps valid" by the stale-suppression guard', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'p', 'STATE.md'), '2026-03-01');
  const text = '## Active threads\n- **alpha** (as of 2026-01-01) (as of 2026-02-30) → `~/projects/p/STATE.md`\n';
  const activeFindings = checkActiveThreads(text, home);
  assert.ok(activeFindings.some((f) => f.type === 'thread-stamp-malformed'), JSON.stringify(activeFindings));
  assert.ok(!activeFindings.some((f) => f.type === 'thread-stale'), 'sanity: a malformed stamp never also FAILs thread-stale');
  const inactive = checkThreadInactive(text, '2026-03-05', home);
  assert.ok(inactive.some((f) => f.type === 'thread-inactive'), `expected NOT suppressed: ${JSON.stringify(inactive)}`);
});

// =====================================================================
// H55 — the thread-stale suppression of thread-inactive must survive the
// COMPOSED pipeline, not just a direct call with `home` handed in by the
// test — `lintGlobalState` must thread `home` all the way through.
// =====================================================================

test('lintGlobalState: H55 — thread-inactive is suppressed by thread-stale through the composed pipeline (home threaded from lintGlobalState)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'p', 'STATE.md'), '2026-03-01');
  const text = [
    '# GLOBAL STATE — cross-project projection',
    '> Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- **alpha** (as of 2026-01-01) — stale thread → `~/projects/p/STATE.md`',
    '',
    '## Backlog (owned)',
    '- testagent — sweep the backlog',
    '',
    '## Watch',
    '- an assumption needing validation (validate-by: 2026-10-01)',
    '',
    '## Recently closed (context for next session)',
    '- gamma finished (closed 2026-03-04)',
    '',
  ].join('\n');
  const findings = lintGlobalState(text, { home });
  assert.ok(findings.some((f) => f.type === 'thread-stale'), `sanity: must FAIL thread-stale: ${JSON.stringify(findings)}`);
  assert.ok(!findings.some((f) => f.type === 'thread-inactive'), `must be suppressed: ${JSON.stringify(findings)}`);
});

test('checkThreadInactive: H55/S7 — the stale-suppression guard reads the OLDEST stamp, same as thread-stale (two stamps straddling the target as-of)', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'p', 'STATE.md'), '2026-02-01');
  const text =
    '## Active threads\n- **alpha** (as of 2026-01-01) reopened (as of 2026-03-01) → `~/projects/p/STATE.md`\n';
  const active = checkActiveThreads(text, home);
  assert.ok(
    active.some((f) => f.type === 'thread-stale'),
    `sanity: the OLDEST of the two stamps (2026-01-01) is stale against the target's 2026-02-01: ${JSON.stringify(active)}`,
  );
  assert.deepEqual(checkThreadInactive(text, '2026-03-04', home), []);
});

// =====================================================================
// H63 — repeated-flag rejection applies to EVERY value flag, not just
// --match. H66 — a value made only of whitespace is rejected, for --match
// AND --tag, not just an empty string.
// =====================================================================

test('parseStateArgs archive: H63 — a repeated --reason throws, not just --match', () => {
  assert.throws(
    () => parseStateArgs([
      'archive', '--global', '--match', 'x', '--reason', 'removed', '--reason', 'expired', '--tag', 'testagent',
    ]),
    /--reason may only be given once/,
  );
});

test('parseStateArgs archive: H63 — a repeated --tag throws, not just --match', () => {
  assert.throws(
    () => parseStateArgs([
      'archive', '--global', '--match', 'x', '--reason', 'expired', '--tag', 'alice', '--tag', 'bob',
    ]),
    /--tag may only be given once/,
  );
});

test('parseStateArgs archive: H66 — a whitespace-only --match throws (not just an empty string)', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', ' ', '--reason', 'removed', '--tag', 'testagent']),
    /--match requires a non-blank value/,
  );
});

test('parseStateArgs archive: H66 — a whitespace-only --tag throws (not just an empty string)', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'removed', '--tag', ' ']),
    /--tag requires a non-blank value/,
  );
});

// =====================================================================
// E8/K2 — `state archive --tag` reuses the SAME single-token validator as
// `banana log` (validateAgentTag), exported from lib/state.mjs.
// =====================================================================

test('validateAgentTag: a single-token tag passes', () => {
  assert.doesNotThrow(() => validateAgentTag('claude'));
});

test('validateAgentTag: a tag containing a space throws, naming the single-token rule', () => {
  assert.throws(() => validateAgentTag('Jane Doe'), /single token/);
});

test('validateAgentTag: a tag containing a tab throws too (any whitespace, not just a literal space)', () => {
  assert.throws(() => validateAgentTag('a\tb'), /single token/);
});

test('parseStateArgs archive: E8/K2 — a --tag containing internal whitespace throws, even though it is non-blank', () => {
  assert.throws(
    () => parseStateArgs([
      'archive', '--global', '--match', 'x', '--reason', 'removed', '--tag', 'claude — expired · Watch',
    ]),
    /single token/,
  );
});

// =====================================================================
// E10 — oldestValidStamp, the shared stamp-selection primitive exported
// for `lib/state-archive.mjs`'s D3 gate (same selection the age checks
// use: the oldest VALID stamp, never the newest, never an impossible one).
// =====================================================================

test('oldestValidStamp: the oldest of several valid stamps on one line, default keyword "as of"', () => {
  assert.equal(oldestValidStamp('- **x** (as of 2026-03-01) reopened (as of 2026-01-01) → p'), '2026-01-01');
});

test('oldestValidStamp: a custom keyword ("closed") is honored', () => {
  assert.equal(oldestValidStamp('- gamma (closed 2026-09-01) reopened, (closed 2026-09-29)', 'closed'), '2026-09-01');
});

test('oldestValidStamp: no valid stamp at all is null', () => {
  assert.equal(oldestValidStamp('- just prose, no stamp'), null);
});

test('oldestValidStamp: an impossible date is filtered out, even though it would sort "oldest" as text', () => {
  assert.equal(oldestValidStamp('- gamma (as of 2026-02-30) (as of 2026-03-01)'), '2026-03-01');
});

// =====================================================================
// E7 (critic K1) — see the dedicated formatStateLintLines tests above;
// this end-to-end pin confirms a WARN-only global page, read through
// `banana brief`'s own seam (collectStateLint + formatStateLintLines),
// collapses to the one-line summary rather than every #20 WARN verbatim.
// =====================================================================

test('collectStateLint + formatStateLintLines: E7 — a WARN-only global page collapses to one summary line through the real seam', (t) => {
  const name = 'Backlog (owned)';
  const limit = SECTION_LINE_LIMITS[name];
  const text = CLEAN_GLOBAL.replace(
    '- testagent — sweep the backlog',
    bulletOfLength('- testagent — sweep the backlog ', limit + 1),
  );
  const home = makeGlobalHome(t, text);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  const cwd = sandbox(t);
  const collected = collectStateLint({ cwd, home });
  assert.ok('verdict' in collected.global && collected.global.verdict.startsWith('WARN'), JSON.stringify(collected.global));
  const lines = formatStateLintLines(collected);
  assert.ok(lines.some((l) => l.startsWith('global state lint: WARN') && l.includes('line-over-limit')), lines.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('WARN [line-over-limit]')), 'the raw WARN line must not appear verbatim');
});
