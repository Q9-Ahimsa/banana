// #9 (project mode) acceptance: `banana state lint` mechanically verdicts a
// project STATE.md page — FAIL (a mechanical invariant is broken), WARN
// (ambiguous residue a model should look at), PASS (neither) — never grading
// content; every verdict is reproducible from file bytes alone. Exit codes:
// 0 PASS/WARN-only, 1 any FAIL, 2 usage error or a missing/unreadable target.
// Global mode (#13, `--global`) is out of scope here; parseStateArgs must
// reject `--global` until #13 lands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkAsOfMissing,
  checkDirtyMarker,
  checkMissingSections,
  checkOverCap,
  checkRetiredHeader,
  checkStaleVsLogbook,
  checkStaleVsSessionLog,
  checkUnownedBullets,
  classifyOwnerBullet,
  DIRTY_MARKER_LINE,
  emitFindings,
  hasSection,
  lintProjectState,
  parseStateArgs,
  REQUIRED_PROJECT_SECTIONS,
  RETIRED_HEADER_RE,
  runStateLint,
  STATE_CAP_CHARS,
  topLevelBullets,
} from '../lib/state.mjs';
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
  const result = await runStateLint({ verb: 'lint' }, { cwd, io, home: cwd });
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

test('parseStateArgs: bare `lint` parses to { verb: "lint" }', () => {
  assert.deepEqual(parseStateArgs(['lint']), { verb: 'lint' });
});

test('parseStateArgs: --global is not yet accepted (phase 1) — unknown option', () => {
  assert.throws(() => parseStateArgs(['lint', '--global']), /unknown option '--global'/);
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

test('classifyOwnerBullet: content starting with "(" after stripping emphasis is a placeholder', () => {
  assert.equal(classifyOwnerBullet('- (owned actions only; unowned items are not allowed here)'), 'placeholder');
  assert.equal(classifyOwnerBullet('- **(bold-wrapped placeholder)**'), 'placeholder');
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
