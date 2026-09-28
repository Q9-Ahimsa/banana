// #9 (project mode) + #13 (global mode, `--global`) acceptance: `banana
// state lint` mechanically verdicts a STATE.md page — FAIL (a mechanical
// invariant is broken), WARN (ambiguous residue a model should look at),
// PASS (neither) — never grading content; every verdict is reproducible
// from file bytes alone. Exit codes: 0 PASS/WARN-only, 1 any FAIL, 2 usage
// error or a missing/unreadable target.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  checkActiveThreads,
  checkAsOfMalformed,
  checkAsOfMissing,
  checkDirtyMarker,
  checkMissingSections,
  checkOverCap,
  checkRetiredHeader,
  checkStaleVsLogbook,
  checkStaleVsSessionLog,
  checkUnownedBullets,
  classifyOwnerBullet,
  collectStateLint,
  DIRTY_MARKER_LINE,
  emitFindings,
  formatStateLintLines,
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
  STATE_CAP_CHARS,
  topLevelBullets,
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
  assert.throws(() => parseStateArgs([]), /missing verb \(expected lint\)/);
});

test('parseStateArgs: unknown verb names the vocabulary', () => {
  assert.throws(() => parseStateArgs(['frobnicate']), /unknown state verb 'frobnicate' \(expected lint\)/);
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

test('checkRetiredHeader: the pre-amendment phrase anywhere in the page warns, case-insensitively', () => {
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
  '> One page, hard cap. Rebuilt whole, never patched. Chronology lives in project',
  '> logbooks; this file only answers "what\'s live and what\'s queued across',
  '> everything." Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
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
  '- gamma finished — see alpha\'s logbook',
  '',
].join('\n');

const FRESH_GLOBAL = [
  '# GLOBAL STATE — cross-project projection',
  '> One page, hard cap. Rebuilt whole, never patched. Chronology lives in project',
  '> logbooks; this file only answers "what\'s live and what\'s queued across',
  '> everything." Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
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
// lintGlobalState — composition sanity + the never-flag-retired-header rule
// =====================================================================

test('lintGlobalState: the clean global fixture has zero findings', (t) => {
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  assert.deepEqual(lintGlobalState(CLEAN_GLOBAL, { home }), []);
});

test('lintGlobalState: never flags "Rebuilt whole, never patched." — correct at this grain', (t) => {
  // CLEAN_GLOBAL's own header carries this phrase verbatim (it's the correct,
  // required global-grain rule) — if retired-header were wired into global
  // mode this fixture would already fail, so this doubles as a regression
  // guard for the never-flag rule.
  assert.ok(CLEAN_GLOBAL.includes('Rebuilt whole, never patched.'));
  const home = sandbox(t);
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), '2026-09-01');
  assert.deepEqual(lintGlobalState(CLEAN_GLOBAL, { home }), []);
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
