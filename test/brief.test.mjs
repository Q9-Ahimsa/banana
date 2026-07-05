import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseBriefArgs,
  parseSessionLog,
  nextOwner,
  isGhost,
  slugListing,
  compileBrief,
  runBrief,
  GHOST_THRESHOLD_HOURS,
} from '../lib/brief.mjs';

/** @type {string[]} */
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Fixed clock for ghost math: 2026-07-04 noon UTC. Entries dated 2026-07-01
// are >48h old; entries dated 2026-07-04 are ~12h old.
const NOW = Date.parse('2026-07-04T12:00:00Z');

const STATE_MD = `# STATE — fixture project
> Projection of LOGBOOK.md as of 2026-07-03. STATE_VERBATIM_MARKER

## Now
- shipping the auth rework
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
  return compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: makeProject(), now: NOW });
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

// --- session-log parsing ---

test('parseSessionLog: envelope fields, bodies, status, NEXT lines', () => {
  const entries = parseSessionLog(SESSION_LOG);
  assert.equal(entries.length, 9);
  const a1 = entries.find((e) => e.feature === 'auth' && e.n === 1);
  assert.ok(a1);
  assert.equal(a1.date, '2026-07-01');
  assert.equal(a1.agent, 'claude');
  assert.equal(a1.phase, 'build');
  assert.equal(a1.title, 'JWT refresh flow');
  assert.equal(a1.status, 'complete');
  assert.deepEqual(a1.nextLines, ['NEXT: claude — wire refresh into login flow']);
  assert.ok(a1.body.some((line) => line.includes('TARGET_MARK_A1')));
});

test('parseSessionLog: tolerates CRLF line endings', () => {
  const entries = parseSessionLog(SESSION_LOG.replaceAll('\n', '\r\n'));
  assert.equal(entries.length, 9);
  assert.equal(entries[0].status, 'complete');
});

test('nextOwner: owned vs unowned NEXT lines', () => {
  assert.equal(nextOwner('NEXT: claude — wire refresh into login flow'), 'claude');
  assert.equal(nextOwner('NEXT: decide rounding policy'), null);
});

test('isGhost: in-progress older than 48h only', () => {
  assert.equal(GHOST_THRESHOLD_HOURS, 48);
  const entries = parseSessionLog(SESSION_LOG);
  const ghost = entries.find((e) => e.feature === 'auth' && e.n === 2);
  const fresh = entries.find((e) => e.feature === 'auth' && e.n === 3);
  const complete = entries.find((e) => e.feature === 'billing' && e.n === 1);
  assert.ok(ghost && fresh && complete);
  assert.equal(isGhost(ghost, NOW), true);
  assert.equal(isGhost(fresh, NOW), false);
  assert.equal(isGhost(complete, NOW), false);
});

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
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW });
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
  const result = await runBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, io, now: NOW });
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
  const result = await runBrief({ feature: null, tag: null }, { cwd: dir, io, now: NOW });
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
  const result = await runBrief({ feature: 'nope', tag: 'claude' }, { cwd: dir, io, now: NOW });
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
  const result = await runBrief({ feature: null, tag: null }, { cwd: dir, io, now: NOW });
  assert.equal(result.code, 1);
  assert.match(errLines.join('\n'), /session\.log/);
});

test('runBrief: missing session.log exits non-zero with a pointer to banana project', async () => {
  const dir = makeProject({ log: null });
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: () => {},
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
  const result = await runBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, io, now: NOW });
  assert.equal(result.code, 1);
  assert.match(errLines.join('\n'), /session\.log/);
});
