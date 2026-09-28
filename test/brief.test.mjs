import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBriefArgs, slugListing, compileBrief, runBrief } from '../lib/brief.mjs';
import { parseSessionLog } from '../lib/sessionlog.mjs';

/** @type {string[]} */
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Fixed clock for ghost math: 2026-07-04 noon UTC. Entries dated 2026-07-01
// are >48h old; entries dated 2026-07-04 are ~12h old.
const NOW = Date.parse('2026-07-04T12:00:00Z');

// Shared fixture home for the state-lint global side (#14): no
// ~/.agents/STATE.md, so every test below gets a deterministic
// `global: none (no ~/.agents/STATE.md)` unless a test writes its own home.
// Read-only — brief never writes to home — so one shared dir is safe.
const HOME = mkdtempSync(join(tmpdir(), 'banana-brief-home-'));
tempDirs.push(HOME);

// A lint-clean project page (#14): all six required sections present, an
// empty `## Next` (no bullets to own-check), and an as-of date at/after
// every session-log fixture's latest entry (2026-07-04) so
// stale-vs-session-log never fires. Kept lint-clean so the state-lint
// section on the golden/characterization fixtures below reads as a plain
// PASS — dedicated state-lint tests below mutate a COPY to exercise FAIL.
const STATE_MD = `# STATE — fixture project
> Projection of LOGBOOK.md as of 2026-07-04. STATE_VERBATIM_MARKER

## Now
- shipping the auth rework

## Truths
- (none yet)

## Next

## Blocked
- (none)

## Watch
- (none)

## Dead ends
- (none)
`;

// Target feature: auth (3 entries, one ghost). Other features: 6 entries, so
// the headings-only window (last 5) must drop the oldest (billing.1).
const SESSION_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-06-30] codex billing.1 | build — invoice PDF export
APPROACH: Render invoices server-side OTHER_MARK_B1.
STATUS: complete
NEXT: codex — ship the export button

## [2026-07-01] claude auth.1 | build — JWT refresh flow
APPROACH: Rotate refresh tokens on use TARGET_MARK_A1.
FILES: src/auth/refresh.ts
STATUS: complete
NEXT: claude — wire refresh into login flow

## [2026-07-01] human auth.2 | debug — token clock skew
APPROACH: Investigate skew between issuer and gateway TARGET_MARK_A2.
STATUS: in-progress

## [2026-07-01] codex billing.2 | build — tax rules
APPROACH: Table-driven tax rates OTHER_MARK_B2.
STATUS: complete
NEXT: claude — review the tax table

## [2026-07-02] codex billing.3 | build — currency rounding
APPROACH: Bankers rounding everywhere OTHER_MARK_B3.
STATUS: complete
NEXT: decide rounding policy

## [2026-07-02] human docs.1 | build — quickstart draft
APPROACH: One-screen quickstart OTHER_MARK_D1.
STATUS: complete
NEXT: human — screenshot pass

## [2026-07-03] human docs.2 | review — quickstart edit
APPROACH: Tighten prose OTHER_MARK_D2.
STATUS: complete
NEXT: human — publish

## [2026-07-03] codex infra.1 | ops — CI cache warmup
APPROACH: Prime the build cache OTHER_MARK_I1.
STATUS: complete
NEXT: codex — watch first nightly

## [2026-07-04] claude auth.3 | build — rotation edge cases
APPROACH: Cover replay-after-rotate TARGET_MARK_A3.
STATUS: in-progress
`;

/**
 * Build a fixture project dir with STATE.md and .agents/session.log.
 * @param {{ state?: string | null, log?: string | null }} [opts]
 * @returns {string}
 */
function makeProject(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-brief-'));
  tempDirs.push(dir);
  const { state = STATE_MD, log = SESSION_LOG } = opts;
  if (state !== null) writeFileSync(join(dir, 'STATE.md'), state);
  if (log !== null) {
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'session.log'), log);
  }
  return dir;
}

/** @returns {string} */
function fixtureBrief() {
  return compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: makeProject(), now: NOW, home: HOME });
}

// --- arg parsing ---

test('parseBriefArgs: feature positional plus --tag', () => {
  assert.deepEqual(parseBriefArgs(['auth', '--tag', 'claude']), {
    feature: 'auth',
    tag: 'claude',
  });
  assert.deepEqual(parseBriefArgs(['--tag', 'codex', 'billing']), {
    feature: 'billing',
    tag: 'codex',
  });
});

test('parseBriefArgs: no feature arg enters discovery mode (tag optional)', () => {
  assert.deepEqual(parseBriefArgs([]), { feature: null, tag: null });
  assert.deepEqual(parseBriefArgs(['--tag', 'claude']), { feature: null, tag: 'claude' });
});

test('parseBriefArgs: rejects missing tag with a feature, unknown options', () => {
  assert.throws(() => parseBriefArgs(['auth']), /--tag/);
  assert.throws(() => parseBriefArgs(['auth', '--tag']), /--tag requires a value/);
  assert.throws(() => parseBriefArgs(['auth', '--tag', 'claude', '--nope']), /unknown/);
  assert.throws(() => parseBriefArgs(['auth', 'extra', '--tag', 'claude']), /unexpected/);
});

// Session-log grammar tests (parseSessionLog, nextOwner, isGhost) live in
// test/sessionlog.test.mjs with the module — this file pins brief behavior.

// --- include/exclude contract ---

test('brief: target-feature APPROACH text present, other-feature APPROACH text absent', () => {
  const brief = fixtureBrief();
  assert.match(brief, /TARGET_MARK_A1/);
  assert.match(brief, /TARGET_MARK_A2/);
  assert.match(brief, /TARGET_MARK_A3/);
  for (const mark of [
    'OTHER_MARK_B1',
    'OTHER_MARK_B2',
    'OTHER_MARK_B3',
    'OTHER_MARK_D1',
    'OTHER_MARK_D2',
    'OTHER_MARK_I1',
  ]) {
    assert.ok(!brief.includes(mark), `${mark} must not leak into the brief`);
  }
});

test('brief: headings only for the last 5 other-feature entries', () => {
  const brief = fixtureBrief();
  // Last 5 other-feature entries: billing.2, billing.3, docs.1, docs.2, infra.1.
  for (const id of ['billing.2', 'billing.3', 'docs.1', 'docs.2', 'infra.1']) {
    assert.ok(brief.includes(id), `heading for ${id} expected`);
  }
  // billing.1 is the 6th-oldest and its NEXT is codex-owned: nowhere in the brief.
  assert.ok(!brief.includes('billing.1'), 'billing.1 falls outside the 5-heading window');
});

test('brief: NEXT lines owned by --tag or unowned included; other owners excluded', () => {
  const brief = fixtureBrief();
  assert.match(brief, /wire refresh into login flow/); // auth.1, owned by claude
  assert.match(brief, /review the tax table/); // billing.2, owned by claude
  assert.match(brief, /decide rounding policy/); // billing.3, unowned
  assert.ok(!brief.includes('ship the export button'), 'codex-owned NEXT excluded');
  assert.ok(!brief.includes('watch first nightly'), 'codex-owned NEXT excluded');
  assert.ok(!brief.includes('screenshot pass'), 'human-owned NEXT excluded');
});

test('brief: project STATE.md included verbatim', () => {
  const brief = fixtureBrief();
  assert.match(brief, /STATE_VERBATIM_MARKER/);
  assert.match(brief, /shipping the auth rework/);
});

test('brief: ghost entry flagged, fresh in-progress entry not flagged', () => {
  const brief = fixtureBrief();
  const ghostLines = brief.split('\n').filter((line) => line.includes('GHOST'));
  assert.ok(
    ghostLines.some((line) => line.includes('auth.2')),
    'auth.2 flagged as ghost'
  );
  assert.ok(
    !ghostLines.some((line) => line.includes('auth.3')),
    'auth.3 is fresh, not a ghost'
  );
  assert.match(brief, /abandoned/); // closure instruction rides with the flag
});

// Supersession-aware ghosts (canon §7 amendment): a continuation/abandon
// supersede retires the entry it points at, so brief's two ghost surfaces
// (the inline [GHOST] flag in feature history, and the Ghosts section) must
// both stop flagging it. A non-superseded ghost in the same feature is the
// regression pair — it must keep flagging at both surfaces.
const SUPERSEDE_GHOST_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude auth.2 | debug — token clock skew
APPROACH: Investigate skew between issuer and gateway SUPERSEDED_MARK.
STATUS: in-progress

## [2026-07-01] claude auth.5 | debug — a second stale investigation
APPROACH: Investigate a different skew NOT_SUPERSEDED_MARK.
STATUS: in-progress

## [2026-07-04] testagent auth.6 | debug — clock skew continuation
SUPERSEDES: auth.2 (continuation — closes the entry left open above)
STATUS: complete
NEXT: testagent — done
`;

test('brief: superseded ghost stops flagging at both ghost surfaces; non-superseded ghost still flags (regression)', () => {
  const dir = makeProject({ log: SUPERSEDE_GHOST_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');

  // Surface 1: inline [GHOST] flag in feature history.
  const auth2At = lines.findIndex((l) => l.includes('auth.2'));
  const auth5At = lines.findIndex((l) => l.includes('auth.5'));
  assert.ok(auth2At !== -1 && auth5At !== -1, 'both entries present in feature history');
  assert.ok(!lines[auth2At + 1].includes('GHOST'), 'superseded auth.2 not flagged inline');
  assert.ok(lines[auth5At + 1].includes('GHOST'), 'non-superseded auth.5 still flagged inline (regression)');

  // Surface 2: the Ghosts section.
  const ghostsSection = lines.slice(lines.indexOf('## Ghosts — in-progress older than 48h'));
  assert.ok(
    !ghostsSection.some((l) => l.includes('[GHOST] auth.2')),
    'superseded auth.2 absent from Ghosts section'
  );
  assert.ok(
    ghostsSection.some((l) => l.includes('[GHOST] auth.5')),
    'non-superseded auth.5 present in Ghosts section (regression)'
  );

  // Sanity: both entries' bodies still render (supersession hides the ghost
  // flag, not the entry itself).
  assert.match(brief, /SUPERSEDED_MARK/);
  assert.match(brief, /NOT_SUPERSEDED_MARK/);
});

test('brief: every section header carries a ref line naming its source file', () => {
  const brief = fixtureBrief();
  const lines = brief.split('\n');
  const sections = [
    { header: '## Project state', ref: 'STATE.md' },
    { header: '## Feature history — auth (full bodies)', ref: '.agents/session.log' },
    { header: '## Other work in flight — headings only (last 5)', ref: '.agents/session.log' },
    { header: '## Handoffs — NEXT for claude or unowned', ref: '.agents/session.log' },
    { header: '## Ghosts — in-progress older than 48h', ref: '.agents/session.log' },
  ];
  for (const { header, ref } of sections) {
    const at = lines.indexOf(header);
    assert.ok(at !== -1, `section '${header}' present`);
    assert.ok(
      lines[at + 1].startsWith('ref: ') && lines[at + 1].includes(ref),
      `'${header}' followed by a ref line naming ${ref}`
    );
  }
});

// --- degraded inputs and runBrief ---

test('brief: missing STATE.md noted, compile still succeeds', () => {
  const dir = makeProject({ state: null });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /## Project state/);
  assert.match(brief, /no STATE\.md/);
});

test('runBrief: prints the brief and exits 0', async () => {
  const dir = makeProject();
  /** @type {string[]} */
  const outLines = [];
  const io = {
    out: (/** @type {string} */ line = '') => outLines.push(line),
    err: () => {},
  };
  const result = await runBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 0);
  const printed = outLines.join('\n');
  assert.match(printed, /TARGET_MARK_A1/);
  assert.match(printed, /STATE_VERBATIM_MARKER/);
});

// --- slug discovery (v2: no-arg listing, unknown-slug listing) ---

test('slugListing: one line per slug with its latest entry date, newest first', () => {
  const listing = slugListing(parseSessionLog(SESSION_LOG));
  const lines = listing.split('\n');
  // Latest entry per slug: auth 07-04, docs 07-03, infra 07-03, billing 07-02.
  // Ordered by date desc, then slug asc on ties.
  const auth = lines.findIndex((l) => l.includes('auth'));
  const docs = lines.findIndex((l) => l.includes('docs'));
  const infra = lines.findIndex((l) => l.includes('infra'));
  const billing = lines.findIndex((l) => l.includes('billing'));
  for (const [slug, at] of [['auth', auth], ['docs', docs], ['infra', infra], ['billing', billing]]) {
    assert.ok(at !== -1, `slug ${slug} listed`);
  }
  assert.ok(auth < docs && docs < infra && infra < billing, 'date desc, slug asc on ties');
  assert.match(lines[auth], /auth.*2026-07-04/);
  assert.match(lines[docs], /docs.*2026-07-03/);
  assert.match(lines[infra], /infra.*2026-07-03/);
  assert.match(lines[billing], /billing.*2026-07-02/);
});

test('slugListing: empty log yields a none-yet note, not an empty string', () => {
  assert.match(slugListing([]), /none yet/);
});

test('runBrief: no feature arg prints the slug listing to stdout and exits 0', async () => {
  const dir = makeProject();
  /** @type {string[]} */
  const outLines = [];
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: (/** @type {string} */ line = '') => outLines.push(line),
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
  const result = await runBrief({ feature: null, tag: null }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 0);
  const printed = outLines.join('\n');
  for (const [slug, date] of [
    ['auth', '2026-07-04'],
    ['billing', '2026-07-02'],
    ['docs', '2026-07-03'],
    ['infra', '2026-07-03'],
  ]) {
    assert.ok(printed.includes(slug) && printed.includes(date), `${slug} + ${date} listed`);
  }
  assert.ok(!printed.includes('TARGET_MARK_A1'), 'listing carries no entry bodies');
  assert.equal(errLines.length, 0);
});

test('runBrief: unknown slug exits 1 with the listing on stderr', async () => {
  const dir = makeProject();
  /** @type {string[]} */
  const outLines = [];
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: (/** @type {string} */ line = '') => outLines.push(line),
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
  const result = await runBrief({ feature: 'nope', tag: 'claude' }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 1);
  const errText = errLines.join('\n');
  assert.match(errText, /nope/);
  for (const slug of ['auth', 'billing', 'docs', 'infra']) {
    assert.ok(errText.includes(slug), `listing on stderr names ${slug}`);
  }
  assert.equal(outLines.length, 0, 'nothing on stdout for an unknown slug');
});

test('runBrief: no feature arg with missing session.log still exits 1', async () => {
  const dir = makeProject({ log: null });
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: () => {},
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
  const result = await runBrief({ feature: null, tag: null }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 1);
  assert.match(errLines.join('\n'), /session\.log/);
});

// --- characterization: full output pinned byte-for-byte ---

// Captured from the pre-extraction implementation (ticket #4), updated for
// the `## State lint` section (#14) — any diff here is a behavior change and
// must be a conscious act (brief v2 will be one).
const GOLDEN_BRIEF = `# brief — auth (agent: claude)
> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;
> your own open log entry is the cohesion anchor. Refs point into the record.

## State lint
project: PASS · global: none (no ~/.agents/STATE.md)

## Project state
ref: STATE.md
# STATE — fixture project
> Projection of LOGBOOK.md as of 2026-07-04. STATE_VERBATIM_MARKER

## Now
- shipping the auth rework

## Truths
- (none yet)

## Next

## Blocked
- (none)

## Watch
- (none)

## Dead ends
- (none)

## Feature history — auth (full bodies)
ref: .agents/session.log
## [2026-07-01] claude auth.1 | build — JWT refresh flow
APPROACH: Rotate refresh tokens on use TARGET_MARK_A1.
FILES: src/auth/refresh.ts
STATUS: complete
NEXT: claude — wire refresh into login flow

## [2026-07-01] human auth.2 | debug — token clock skew
[GHOST — in-progress since 2026-07-01, older than 48h; close as abandoned via a SUPERSEDES entry]
APPROACH: Investigate skew between issuer and gateway TARGET_MARK_A2.
STATUS: in-progress

## [2026-07-04] claude auth.3 | build — rotation edge cases
APPROACH: Cover replay-after-rotate TARGET_MARK_A3.
STATUS: in-progress

## Other work in flight — headings only (last 5)
ref: .agents/session.log
- [2026-07-01] codex billing.2 | build — tax rules
- [2026-07-02] codex billing.3 | build — currency rounding
- [2026-07-02] human docs.1 | build — quickstart draft
- [2026-07-03] human docs.2 | review — quickstart edit
- [2026-07-03] codex infra.1 | ops — CI cache warmup

## Handoffs — NEXT for claude or unowned
ref: .agents/session.log
- auth.1: NEXT: claude — wire refresh into login flow
- billing.2: NEXT: claude — review the tax table
- billing.3: NEXT: decide rounding policy

## Ghosts — in-progress older than 48h
ref: .agents/session.log
- [GHOST] auth.2 (2026-07-01) — token clock skew — next session in this project closes it as abandoned via SUPERSEDES
`;

test('brief: characterization — fixture output is byte-identical to the pinned golden', () => {
  assert.equal(fixtureBrief(), GOLDEN_BRIEF);
});

test('slugListing: characterization — fixture listing is byte-identical to the pinned golden', () => {
  assert.equal(
    slugListing(parseSessionLog(SESSION_LOG)),
    `active features — slug + last entry (.agents/session.log):
- auth — 2026-07-04
- docs — 2026-07-03
- infra — 2026-07-03
- billing — 2026-07-02

usage: banana brief <feature> --tag <agent>`
  );
});

test('runBrief: missing session.log exits non-zero with a pointer to banana project', async () => {
  const dir = makeProject({ log: null });
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: () => {},
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
  const result = await runBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 1);
  assert.match(errLines.join('\n'), /session\.log/);
});

// =====================================================================
// state lint wiring (#14) — brief carries the `## State lint` guarantee
// =====================================================================

test('brief: `## State lint` section sits immediately after the header block, before `## Project state`', () => {
  const brief = fixtureBrief();
  const lines = brief.split('\n');
  assert.deepEqual(lines.slice(0, 6), [
    '# brief — auth (agent: claude)',
    '> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;',
    '> your own open log entry is the cohesion anchor. Refs point into the record.',
    '',
    '## State lint',
    'project: PASS · global: none (no ~/.agents/STATE.md)',
  ]);
  assert.equal(lines[6], '');
  assert.equal(lines[7], '## Project state');
});

test('brief: all-PASS project and global prints a bare summary line — no findings, no fix-it line', () => {
  const brief = fixtureBrief();
  assert.match(brief, /## State lint\nproject: PASS · global: none \(no ~\/\.agents\/STATE\.md\)\n\n## Project state/);
  assert.ok(!brief.includes('Fix these before relying on the page'));
});

test('brief: a FAIL project page prints its finding lines and the fix-it closing line; the rest of the brief still compiles', () => {
  const brokenState = STATE_MD.replace('## Blocked\n- (none)\n\n', '').replace('## Watch\n- (none)\n\n', '');
  const dir = makeProject({ state: brokenState });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /FAIL \[missing-section\] STATE\.md: missing required section "## Blocked"/);
  assert.match(brief, /FAIL \[missing-section\] STATE\.md: missing required section "## Watch"/);
  assert.match(brief, /project: FAIL \(2 fail, 0 warn\) · global: none \(no ~\/\.agents\/STATE\.md\)/);
  assert.match(brief, /Fix these before relying on the page: a FAIL means STATE no longer projects its sources\./);
  assert.match(brief, /## Project state/);
  assert.match(brief, /TARGET_MARK_A1/);
});

test('runBrief: exit code is unaffected by a FAIL verdict — still 0', async () => {
  const brokenState = STATE_MD.replace('## Blocked\n- (none)\n\n', '');
  const dir = makeProject({ state: brokenState });
  /** @type {string[]} */
  const outLines = [];
  const io = { out: (/** @type {string} */ l = '') => outLines.push(l), err: () => {} };
  const result = await runBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 0);
  assert.match(outLines.join('\n'), /FAIL \[missing-section\]/);
});

test('brief: no STATE.md in cwd reports `project: none (no STATE.md here)`', () => {
  const dir = makeProject({ state: null });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /project: none \(no STATE\.md here\) · global: none \(no ~\/\.agents\/STATE\.md\)/);
});

test('brief: an unreadable STATE.md (a directory, not a file) reports `project: unreadable (...)`', () => {
  const dir = makeProject({ state: null });
  mkdirSync(join(dir, 'STATE.md'));
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /project: unreadable \([^)]*STATE\.md is missing or unreadable\)/);
});

test('brief: an unreadable global page (a directory, not a file) reports `global: unreadable (...)`', () => {
  const dir = makeProject();
  const home = mkdtempSync(join(tmpdir(), 'banana-brief-home-unreadable-'));
  tempDirs.push(home);
  mkdirSync(join(home, '.agents', 'STATE.md'), { recursive: true });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home });
  assert.match(brief, /global: unreadable \([^)]*STATE\.md is missing or unreadable\)/);
});

// Synthetic global fixture (public-repo hygiene: invented project name
// `gamma`) with one stale Active-threads bullet, to prove global findings
// print too (after project findings) and drive the fix-it line.
const STALE_GLOBAL = [
  '# GLOBAL STATE — cross-project projection',
  '> One page, hard cap. Rebuilt whole, never patched.',
  '',
  '## Active threads',
  '- **gamma** (as of 2026-07-01) — building the thing → `~/projects/gamma/STATE.md`',
  '',
  '## Backlog (owned)',
  '- testagent — sweep the backlog',
  '',
  '## Watch',
  '- an assumption needing validation (validate-by: 2026-08-01)',
  '',
  '## Recently closed (context for next session)',
  '- nothing yet',
  '',
].join('\n');

test('brief: a stale global Active-threads bullet FAILs thread-stale, printed after project findings', () => {
  const home = mkdtempSync(join(tmpdir(), 'banana-brief-home-stale-'));
  tempDirs.push(home);
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'STATE.md'), STALE_GLOBAL, 'utf8');
  mkdirSync(join(home, 'projects', 'gamma'), { recursive: true });
  writeFileSync(
    join(home, 'projects', 'gamma', 'STATE.md'),
    '# STATE — gamma\n> Projection of LOGBOOK.md as of 2026-07-05 (through none).\n',
    'utf8',
  );
  const dir = makeProject();
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home });
  assert.match(brief, /project: PASS · global: FAIL \(1 fail, 0 warn\)/);
  assert.match(brief, /FAIL \[thread-stale\] ~\/\.agents\/STATE\.md: /);
  assert.match(brief, /Fix these before relying on the page/);
});

test('runBrief: discovery mode also carries the `## State lint` section, before the slug listing', async () => {
  const dir = makeProject();
  /** @type {string[]} */
  const outLines = [];
  const io = { out: (/** @type {string} */ l = '') => outLines.push(l), err: () => {} };
  const result = await runBrief({ feature: null, tag: null }, { cwd: dir, io, home: HOME, now: NOW });
  assert.equal(result.code, 0);
  const printed = outLines.join('\n');
  const lines = printed.split('\n');
  assert.equal(lines[0], '## State lint');
  assert.equal(lines[1], 'project: PASS · global: none (no ~/.agents/STATE.md)');
  assert.equal(lines[2], '');
  assert.ok(printed.includes('active features — slug + last entry'));
});
