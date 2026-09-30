import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBriefArgs, slugListing, compileBrief, runBrief } from '../lib/brief.mjs';
import { parseSessionLog } from '../lib/sessionlog.mjs';
import { readKitVersion } from '../lib/version.mjs';
import { DIRTY_MARKER_LINE } from '../lib/state.mjs';

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

/**
 * The `## Handoffs` section's own text (heading through the line before
 * `## Ghosts`), so a substring check can't be satisfied by the SAME marker
 * text appearing elsewhere in the brief (e.g. a target-feature entry's NEXT
 * line, printed verbatim in its Feature history body regardless of whether
 * Handoffs also surfaces it) — the F1/F2 review both flagged assertions
 * that passed vacuously for exactly this reason.
 * @param {string} brief
 * @returns {string}
 */
function handoffsSection(brief) {
  const lines = brief.split('\n');
  const start = lines.indexOf('## Handoffs — NEXT for claude or unowned');
  const end = lines.indexOf('## Ghosts — in-progress older than 48h');
  return lines.slice(start, end).join('\n');
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

// Updated for the adversarial-review fix F1: Handoffs uses TWO different
// eligibility rules. For OTHER (non-target) features, only the stream's
// LATEST entry (by log position) contributes its NEXT lines — billing's
// latest is billing.3 (unowned NEXT); billing.2's claude-owned NEXT, not
// being latest, is excluded. docs' latest (docs.2) and infra's only entry
// are owned by human/codex — excluded either way. For the TARGET feature
// ('auth' here), eligibility instead follows Feature history's own
// full-body rendering (F1): auth.1 IS shown in full there (it's auth's
// "last close" — auth.2/auth.3 are open), so its NEXT counts even though
// auth.3, not auth.1, is auth's positional-latest entry with no NEXT yet.
// The prior version of this test asserted auth.1's NEXT absent, which
// directly contradicted auth.1's own NEXT text being printed in Feature
// history's body a few lines above — F1 fixes that contradiction.
test('brief: Handoffs — the target feature follows Feature history\'s full-body eligibility; OTHER features are judged only on their latest entry', () => {
  const brief = fixtureBrief();
  const lines = brief.split('\n');
  const start = lines.indexOf('## Handoffs — NEXT for claude or unowned');
  const end = lines.indexOf('## Ghosts — in-progress older than 48h');
  const handoffSection = lines.slice(start, end).join('\n');
  // auth.1's full body (unrelated to Handoffs) is present elsewhere in the
  // brief, in Feature history — so these must check the Handoffs SECTION
  // specifically, not the whole brief, or the substring would still match.
  assert.match(handoffSection, /auth\.1: NEXT: claude — wire refresh into login flow/); // F1: target feature, shown in full
  assert.match(handoffSection, /decide rounding policy/); // billing.3, billing's latest entry, unowned
  assert.ok(!handoffSection.includes('review the tax table'), 'billing.2 is not billing\'s latest entry (billing.3 is)');
  assert.ok(!handoffSection.includes('ship the export button'), 'codex-owned NEXT excluded');
  assert.ok(!handoffSection.includes('watch first nightly'), 'codex-owned NEXT excluded');
  assert.ok(!handoffSection.includes('screenshot pass'), 'human-owned NEXT excluded');
});

test('brief: project STATE.md included verbatim', () => {
  const brief = fixtureBrief();
  assert.match(brief, /STATE_VERBATIM_MARKER/);
  assert.match(brief, /shipping the auth rework/);
});

// #8 Step 1 characterization: which sections appear/order, every ref: line,
// discovery mode, and ghost flagging are already pinned above and below by
// name — 'brief: characterization — fixture output is byte-identical to the
// pinned golden', 'brief: every section header carries a ref line...',
// 'runBrief: no feature arg prints the slug listing...'/'runBrief: discovery
// mode also carries the `## State lint` section...', and 'brief: ghost entry
// flagged...' respectively. The one exclusion the ticket names that no
// existing test pins on its own: global STATE (machine grain) never appears
// verbatim in the brief, only its lint verdict/findings do.
test('brief: global STATE.md body content never leaks into the brief — only its state-lint verdict does (characterization, #8)', () => {
  const home = mkdtempSync(join(tmpdir(), 'banana-brief-home-global-excl-'));
  tempDirs.push(home);
  mkdirSync(join(home, '.agents'), { recursive: true });
  // Lint-clean (PASS) global page so no finding line ever echoes bullet
  // text — GLOBAL_ONLY_MARKER sits only in the raw file, never in a finding.
  writeFileSync(
    join(home, '.agents', 'STATE.md'),
    [
      '# GLOBAL STATE — cross-project projection',
      '> One page, hard cap. Edit only your own threads; never rewrite the page.',
      '',
      '## Active threads',
      '',
      '## Backlog (owned)',
      '- ahimsa — sweep GLOBAL_ONLY_MARKER backlog item',
      '',
      '## Watch',
      '',
      '## Recently closed (context for next session)',
      '- nothing yet',
      '',
    ].join('\n'),
    'utf8',
  );
  const dir = makeProject();
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home });
  assert.match(brief, /global: PASS/);
  assert.ok(!brief.includes('GLOBAL_ONLY_MARKER'), 'global STATE.md body content must not appear in the brief');
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
// regression pair — it must keep flagging at both surfaces. Markers renamed
// (adversarial review F2): the old `SUPERSEDED_MARK`/`NOT_SUPERSEDED_MARK`
// pair had one as a literal substring of the other, so a `match(/SUPERSEDED_
// MARK/)` on the whole brief passed even when only auth.5's body rendered —
// masking the real #8-follow-up-2 behavior (auth.2's body no longer renders
// at all, since it's retired). Neither new name is a substring of the other.
const SUPERSEDE_GHOST_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude auth.2 | debug — token clock skew
APPROACH: Investigate skew between issuer and gateway MARK_SUPERSEDED.
STATUS: in-progress

## [2026-07-01] claude auth.5 | debug — a second stale investigation
APPROACH: Investigate a different skew MARK_LIVE.
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

  // Surface 1: inline [GHOST] flag in feature history. Re-anchored (F2) on
  // each entry's own rendered SPAN (its heading up to the next `## ` line),
  // not `headingIndex + 1` — auth.2 is now heading-only (#8 follow-up 2), so
  // `lines[auth2At + 1]` would just be auth.5's heading and the check would
  // pass vacuously regardless of ghost-suppression actually working. Anchor
  // on the exact entry heading line (starts with `## [`), not a bare
  // `includes('auth.2')`, which would also match auth.6's own SUPERSEDES
  // body line (`SUPERSEDES: auth.2 ...`).
  const auth2At = lines.findIndex((l) => l.startsWith('## [') && l.includes(' auth.2 '));
  const auth5At = lines.findIndex((l) => l.startsWith('## [') && l.includes(' auth.5 '));
  assert.ok(auth2At !== -1 && auth5At !== -1, 'both entries present in feature history');
  const auth2End = lines.findIndex((l, i) => i > auth2At && l.startsWith('## '));
  const auth5End = lines.findIndex((l, i) => i > auth5At && l.startsWith('## '));
  const auth2Span = lines.slice(auth2At, auth2End);
  const auth5Span = lines.slice(auth5At, auth5End);
  assert.ok(!auth2Span.some((l) => l.includes('GHOST')), 'superseded auth.2 not flagged anywhere in its own span');
  assert.ok(auth5Span.some((l) => l.includes('GHOST')), 'non-superseded auth.5 still flagged inline (regression)');

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

  // Sanity, corrected (F2): auth.2 is retired SAME-STREAM (auth.6 is also
  // feature 'auth'), so per #8 follow-up 2 its body must NOT render at all —
  // the previous assertion here was backwards. auth.5 is not superseded, so
  // its body still renders.
  assert.ok(!brief.includes('MARK_SUPERSEDED'), 'superseded auth.2 body must not render (#8 follow-up 2)');
  assert.match(brief, /MARK_LIVE/);
});

test('brief: every section header carries a ref line naming its source file', () => {
  const brief = fixtureBrief();
  const lines = brief.split('\n');
  const sections = [
    { header: '## Project state', ref: 'STATE.md' },
    { header: '## Feature history — auth (last close + open entries in full)', ref: '.agents/session.log' },
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
// the `## State lint` section (#14), again for the kit-version/dirty-status
// header lines and the "(last close + open entries in full)" heading (#8),
// again for live-only Handoffs (#8 follow-up 3), and again for F1 (target
// feature Handoffs follows full-body eligibility) — any diff here is a
// behavior change and must be a conscious act. auth's only closed entry
// (auth.1) is also its most-recent closed entry (auth.2/auth.3 are open),
// so #8's grain-trimming has nothing to trim in this particular fixture —
// see the dedicated GRAIN_LOG fixture below for that behavior. Handoffs
// shows auth.1 (the TARGET feature's own entry, shown in full in Feature
// history — F1's eligibility, not "is it auth's latest entry") and
// billing.3 (billing's LATEST entry, unowned NEXT, since billing is an
// OTHER feature); billing.2's claude-owned NEXT is excluded — not billing's
// latest entry.
const GOLDEN_BRIEF = `# brief — auth (agent: claude)
> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;
> your own open log entry is the cohesion anchor. Refs point into the record.
kit: v${readKitVersion()}
STATE: clean

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

## Feature history — auth (last close + open entries in full)
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

// Positions shifted by two lines (#8): the kit-version and dirty-status
// lines now sit under the title blockquote, before the blank line and
// `## State lint` — this test is deliberately updated for that change.
test('brief: `## State lint` section sits immediately after the header block (title + kit/dirty-status lines), before `## Project state`', () => {
  const brief = fixtureBrief();
  const lines = brief.split('\n');
  assert.deepEqual(lines.slice(0, 8), [
    '# brief — auth (agent: claude)',
    '> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;',
    '> your own open log entry is the cohesion anchor. Refs point into the record.',
    `kit: v${readKitVersion()}`,
    'STATE: clean',
    '',
    '## State lint',
    'project: PASS · global: none (no ~/.agents/STATE.md)',
  ]);
  assert.equal(lines[8], '');
  assert.equal(lines[9], '## Project state');
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
  '> One page, hard cap. Edit only your own threads; never rewrite the page.',
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

// =====================================================================
// #8: target-feature grain, kit-version line, dirty-status line
// =====================================================================

// Target feature 'grain': an OLDER closed entry, the MOST RECENT closed
// entry, and an open entry — in that log order. Distinguishes "most recent
// closed" from "last entry in the array" (grain.3 is open and comes last).
const GRAIN_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude grain.1 | build — oldest closed entry
APPROACH: OLD_CLOSED_BODY_MARK.
STATUS: complete

## [2026-07-02] claude grain.2 | build — most recent closed entry
APPROACH: RECENT_CLOSED_BODY_MARK.
STATUS: complete

## [2026-07-04] claude grain.3 | build — open entry, always shown in full
APPROACH: OPEN_BODY_MARK.
STATUS: in-progress
`;

test('brief (#8): only the most recent closed entry and every open entry show full bodies; older closed entries are heading-only, log order kept', () => {
  const dir = makeProject({ log: GRAIN_LOG });
  const brief = compileBrief({ feature: 'grain', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  assert.ok(!brief.includes('OLD_CLOSED_BODY_MARK'), 'grain.1 (older closed) shows heading only, no body');
  assert.match(brief, /RECENT_CLOSED_BODY_MARK/); // grain.2: most recent closed, shown in full
  assert.match(brief, /OPEN_BODY_MARK/); // grain.3: open, always shown in full
  const at1 = lines.findIndex((l) => l.includes('grain.1'));
  const at2 = lines.findIndex((l) => l.includes('grain.2'));
  const at3 = lines.findIndex((l) => l.includes('grain.3'));
  assert.ok(at1 !== -1 && at2 !== -1 && at3 !== -1, 'all three headings present');
  assert.ok(at1 < at2 && at2 < at3, 'log order preserved');
});

test('brief (#8): kit-version line reads from the injected kitRoot\'s package.json, right after the title blockquote', () => {
  const kitRoot = mkdtempSync(join(tmpdir(), 'banana-brief-kit-'));
  tempDirs.push(kitRoot);
  writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '9.9.9' }));
  const dir = makeProject();
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME, kitRoot });
  const lines = brief.split('\n');
  assert.equal(lines[3], 'kit: v9.9.9');
});

test('brief (#8): kit-version line reads "kit: unknown" when readKitVersion returns null', () => {
  const kitRoot = mkdtempSync(join(tmpdir(), 'banana-brief-kit-none-'));
  tempDirs.push(kitRoot);
  // No package.json written at kitRoot — readKitVersion returns null.
  const dir = makeProject();
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME, kitRoot });
  const lines = brief.split('\n');
  assert.equal(lines[3], 'kit: unknown');
});

test('brief (#8): dirty-status line reports "STATE: dirty ..." when the standing dirty marker is present', () => {
  const dirtyState = `${STATE_MD}${DIRTY_MARKER_LINE}\n`;
  const dir = makeProject({ state: dirtyState });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  assert.equal(lines[4], 'STATE: dirty (patched since last rebuild; the log is authority)');
});

test('brief (#8): dirty-status line reports "STATE: clean" when STATE.md exists without the marker', () => {
  const dir = makeProject(); // STATE_MD (fixture) carries no dirty marker
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  assert.equal(lines[4], 'STATE: clean');
});

test('brief (#8): dirty-status line reports "STATE: none" when there is no project STATE.md', () => {
  const dir = makeProject({ state: null });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  assert.equal(lines[4], 'STATE: none');
});

test('brief (#8): dirty-status line reports "STATE: unreadable" when STATE.md exists but cannot be read (matches the State lint section\'s own verdict, follow-up 4)', () => {
  const dir = makeProject({ state: null });
  mkdirSync(join(dir, 'STATE.md'));
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  assert.equal(lines[4], 'STATE: unreadable');
});

// =====================================================================
// #8 follow-ups (found rendering the brief on the real repo's own log)
// =====================================================================

// Follow-up 2: a SUPERSEDES-retired entry is never "open work" — its own
// status is irrelevant. Feature 'retire': retire.1 is in-progress (open by
// STATUS alone) but retired by retire.2's continuation.
const SUPERSEDE_GRAIN_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude retire.1 | build — open entry that will be retired
APPROACH: RETIRED_OPEN_BODY_MARK.
STATUS: in-progress

## [2026-07-04] claude retire.2 | build — continuation, closes retire.1
SUPERSEDES: retire.1 (continuation — closes the entry left open above)
APPROACH: CONTINUATION_BODY_MARK.
STATUS: complete
`;

test('brief (#8 follow-up 2): a superseded entry shows heading only even though its own STATUS is open — the continuation shows in full', () => {
  const dir = makeProject({ log: SUPERSEDE_GRAIN_LOG });
  const brief = compileBrief({ feature: 'retire', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.ok(!brief.includes('RETIRED_OPEN_BODY_MARK'), 'retire.1 (superseded, open) shows heading only, no body');
  assert.match(brief, /CONTINUATION_BODY_MARK/); // retire.2: the continuation, shown in full
});

// Follow-up 3: Handoffs is live-only — for each feature stream, drop
// SUPERSEDES-retired entries, take the LATEST remaining entry by log
// position, and surface only ITS NEXT lines (if owned by --tag or unowned).

// Test: an older entry's tag-owned NEXT is superseded (in ownership, not via
// a SUPERSEDES line — just a later entry of the same stream) by a later
// entry owned by someone else. A naive "loop every NEXT" would wrongly
// surface the older, stale claude-owned NEXT.
const HANDOFF_STALE_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude handoffA.1 | build — older entry, NEXT owned by claude (must not surface)
STATUS: complete
NEXT: claude — stale claude-owned next

## [2026-07-03] codex handoffA.2 | build — later entry, same stream, NEXT owned by codex
STATUS: complete
NEXT: codex — current codex-owned next
`;

test('brief (#8 follow-up 3): an older tag-owned NEXT is dropped once a later entry of the same stream is owned by someone else — nothing shows for that stream', () => {
  const dir = makeProject({ log: HANDOFF_STALE_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.ok(!brief.includes('stale claude-owned next'), 'the older claude-owned NEXT must not surface');
  assert.ok(!brief.includes('current codex-owned next'), 'the later codex-owned NEXT is not for claude either');
});

// Test: the stream's latest entry is itself superseded — its superseder's
// NEXT is what counts, and the retired entry's own (claude-owned) NEXT must
// not leak through.
const HANDOFF_SUPERSEDED_LATEST_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude handoffB.1 | build — retired entry with a claude NEXT (must not surface)
STATUS: in-progress
NEXT: claude — stale next, must not surface

## [2026-07-04] claude handoffB.2 | build — continuation supersedes handoffB.1
SUPERSEDES: handoffB.1 (continuation — closes the entry left open above)
STATUS: complete
NEXT: claude — pick up here
`;

test('brief (#8 follow-up 3): a superseded latest entry contributes nothing — its superseder\'s NEXT counts instead', () => {
  const dir = makeProject({ log: HANDOFF_SUPERSEDED_LATEST_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.ok(!brief.includes('stale next, must not surface'), 'the retired entry\'s own NEXT must not surface');
  assert.match(brief, /pick up here/); // handoffB.2: the continuation, is the stream's latest remaining entry
});

// Test: two independent streams, each judged on its own latest entry —
// isolation, not a global "any owned NEXT anywhere" scan. streamQ carries
// an OLDER claude-owned NEXT that a naive "loop every NEXT" would wrongly
// surface even though streamQ's own latest entry is codex-owned.
const HANDOFF_TWO_STREAMS_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude streamP.1 | build — positive stream, latest entry's NEXT is unowned
STATUS: complete
NEXT: sweep the streamP docs

## [2026-06-30] claude streamQ.1 | build — negative stream, OLDER entry, NEXT owned by claude (must not surface)
STATUS: complete
NEXT: claude — stale streamQ next, must not surface

## [2026-07-01] codex streamQ.2 | build — negative stream, latest entry, NEXT owned by codex
STATUS: complete
NEXT: codex — ship the streamQ thing
`;

test('brief (#8 follow-up 3): each feature stream is judged on its own latest entry, independent of other streams', () => {
  const dir = makeProject({ log: HANDOFF_TWO_STREAMS_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /sweep the streamP docs/);
  assert.ok(!brief.includes('stale streamQ next, must not surface'), 'streamQ\'s older claude-owned NEXT excluded');
  assert.ok(!brief.includes('ship the streamQ thing'), 'codex-owned latest NEXT on a different stream excluded');
});

// Test: an unowned NEXT on a latest entry still shows — the canon wants
// unowned handoffs surfaced, not just tag-owned ones.
const HANDOFF_UNOWNED_LATEST_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude handoffD.1 | build — latest (only) entry has an unowned NEXT
STATUS: complete
NEXT: sweep the handoffD docs
`;

test('brief (#8 follow-up 3): an unowned NEXT on a stream\'s latest entry still shows', () => {
  const dir = makeProject({ log: HANDOFF_UNOWNED_LATEST_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /sweep the handoffD docs/);
});

// =====================================================================
// Adversarial review of #8 (F1-F6, F9) — found rendering the brief on the
// real repo's own log after the prior follow-ups landed.
// =====================================================================

// F1 (blocker): Handoffs must not hide the TARGET feature's own live NEXT.
// The target feature's own entries are eligible for Handoffs whenever
// Feature history rendered them in full — NOT only when they're the
// stream's positional-latest entry (that rule is for OTHER features only).
// f1a: the target's "last close" carries an owned NEXT; the newest entry is
// open with no NEXT yet (so latest-only would wrongly hide the close's NEXT).
const F1_OWNED_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude f1a.1 | build — last close, owned NEXT
STATUS: complete
NEXT: claude — pick up the F1 thing

## [2026-07-04] claude f1a.2 | build — newest entry, open, no NEXT yet
STATUS: in-progress
`;

test('brief (F1): a target stream\'s last-close NEXT (owned by --tag) shows even though the newest entry (open, no NEXT) is positionally latest', () => {
  const dir = makeProject({ log: F1_OWNED_LOG });
  const brief = compileBrief({ feature: 'f1a', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  // f1a.1's own NEXT text also renders verbatim in Feature history (it's
  // shown in full there) — check the Handoffs SECTION specifically, or a
  // whole-brief match would pass even with the pre-F1 bug still present.
  assert.match(handoffsSection(brief), /pick up the F1 thing/);
});

// f1b: same shape, but the last-close's NEXT is unowned.
const F1_UNOWNED_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude f1b.1 | build — last close, unowned NEXT
STATUS: complete
NEXT: sweep the f1b thing

## [2026-07-04] claude f1b.2 | build — newest entry, open, no NEXT yet
STATUS: in-progress
`;

test('brief (F1): a target stream\'s last-close NEXT (unowned) shows even though the newest entry (open, no NEXT) is positionally latest', () => {
  const dir = makeProject({ log: F1_UNOWNED_LOG });
  const brief = compileBrief({ feature: 'f1b', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(handoffsSection(brief), /sweep the f1b thing/);
});

// F3: "retired -> heading only" applies only when the superseder is in the
// SAME feature stream. A cross-stream supersede (a rename/move) keeps the
// full body — otherwise briefing the renamed-away feature would carry no
// content at all. This also exercises F9: ghost suppression stays
// stream-agnostic (the FULL id set), so the cross-stream-retired entry's
// body shows in full but its ghost flag (it's open AND >48h old) is still
// suppressed, on both ghost surfaces.
const CROSS_STREAM_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude renamed-old.1 | build — original stream, later renamed away
APPROACH: CROSS_STREAM_BODY_MARK.
STATUS: in-progress

## [2026-07-04] claude renamed-new.1 | build — cross-stream rename/move
SUPERSEDES: renamed-old.1 (stream slug only, renamed project)
STATUS: complete
`;

test('brief (F3/F9): a cross-stream supersede keeps the body in full but still suppresses the ghost flag on both surfaces', () => {
  const dir = makeProject({ log: CROSS_STREAM_LOG });
  const brief = compileBrief({ feature: 'renamed-old', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /CROSS_STREAM_BODY_MARK/); // cross-stream retirement keeps the full body
  const lines = brief.split('\n');
  const headingAt = lines.findIndex((l) => l.startsWith('## [') && l.includes(' renamed-old.1 '));
  assert.ok(headingAt !== -1, 'renamed-old.1 heading present');
  assert.ok(
    !lines[headingAt + 1].includes('GHOST'),
    'ghost flag suppressed despite the full body (F9: ghost suppression uses the full, stream-agnostic id set)'
  );
  const ghostsSection = lines.slice(lines.indexOf('## Ghosts — in-progress older than 48h'));
  assert.ok(
    !ghostsSection.some((l) => l.includes('renamed-old.1')),
    'the Ghosts section also excludes it (already stream-agnostic, unaffected by F3)'
  );
});

// F3's "a same-stream one hides it" case is already pinned by name:
// 'brief (#8 follow-up 2): a superseded entry shows heading only even
// though its own STATUS is open — the continuation shows in full' (its
// SUPERSEDES is written by retire.2, feature 'retire' — same stream as
// retire.1). Not duplicated here.

// F4: an entry whose STATUS is missing, or off-vocabulary, must not lose
// its body silently — closedness is the test, not `isOpen`'s exact
// 'in-progress' match. Both cases show in full.
const F4_NO_STATUS_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude f4a.1 | build — no STATUS line at all
APPROACH: NO_STATUS_BODY_MARK.
`;

test('brief (F4): an entry with no STATUS line at all still shows in full', () => {
  const dir = makeProject({ log: F4_NO_STATUS_LOG });
  const brief = compileBrief({ feature: 'f4a', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /NO_STATUS_BODY_MARK/);
});

const F4_OFF_VOCAB_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude f4b.1 | build — off-vocabulary STATUS
APPROACH: OFF_VOCAB_BODY_MARK.
STATUS: in progress
`;

test('brief (F4): an entry with an off-vocabulary STATUS ("in progress", not "in-progress") still shows in full', () => {
  const dir = makeProject({ log: F4_OFF_VOCAB_LOG });
  const brief = compileBrief({ feature: 'f4b', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /OFF_VOCAB_BODY_MARK/);
});

// F5: Handoffs must build the latest-by-position map over ALL entries
// first, THEN skip a retired winner — filtering retirement before picking
// "latest" (the follow-up-3 approach) lets an OLDER NEXT resurface when the
// stream's true latest entry is itself retired. f.1 (older, owned NEXT) and
// f.2 (latest, owned NEXT) both belong to stream 'f'; other.1 cross-stream
// retires f.2. Neither NEXT should show — the stream contributes nothing.
const F5_LATEST_RETIRED_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude f.1 | build — older entry in stream f, has its own NEXT (must not resurface)
STATUS: complete
NEXT: claude — f1 stale next, must not resurface

## [2026-07-02] claude f.2 | build — latest entry in stream f, owned NEXT (must not show once retired)
STATUS: complete
NEXT: claude — f2 next, must not show once retired

## [2026-07-04] codex other.1 | ops — cross-stream retirement of f.2
SUPERSEDES: f.2 (renamed/moved out of stream f)
STATUS: complete
`;

test('brief (F5): a stream\'s LATEST entry retired cross-stream contributes nothing — no resurfacing an older NEXT', () => {
  const dir = makeProject({ log: F5_LATEST_RETIRED_LOG });
  const brief = compileBrief({ feature: 'auth', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.ok(!brief.includes('f1 stale next, must not resurface'), 'f.1 must not resurface once f.2 (the latest) is retired');
  assert.ok(!brief.includes('f2 next, must not show once retired'), 'f.2 is retired, so its own NEXT must not show either');
});

// =====================================================================
// Coverage gaps named by the adversarial review
// =====================================================================

// A retired CLOSED entry must be skipped for "last close" candidacy in
// favor of an OLDER close, not just excluded from being shown itself.
// grain3.2 (closed, same-stream retired) would otherwise be the "most
// recent closed" by position; excluding it must fall back to grain3.1 (an
// even older close), not forward to grain3.3 (open, unrelated to
// candidacy).
const RETIRED_CLOSE_FALLBACK_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude grain3.1 | build — older closed entry (the correct "last close" fallback)
STATUS: complete
APPROACH: OLDER_CLOSE_MARK.

## [2026-07-02] claude grain3.2 | build — newer closed entry, gets retired same-stream
STATUS: complete
APPROACH: RETIRED_CLOSE_MARK.

## [2026-07-04] claude grain3.3 | build — same-stream supersede of grain3.2, itself still open
SUPERSEDES: grain3.2 (continuation — closes the entry left open above)
STATUS: in-progress
APPROACH: OPEN_CONTINUATION_MARK.
`;

test('coverage gap: a retired CLOSED entry is skipped for "last close" in favor of an older close', () => {
  const dir = makeProject({ log: RETIRED_CLOSE_FALLBACK_LOG });
  const brief = compileBrief({ feature: 'grain3', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  assert.match(brief, /OLDER_CLOSE_MARK/); // grain3.1: falls back to this, the older close
  assert.ok(!brief.includes('RETIRED_CLOSE_MARK'), 'grain3.2 is retired same-stream — heading only, never "last close"');
  assert.match(brief, /OPEN_CONTINUATION_MARK/); // grain3.3: open, always shown in full
});

// Exactly one trailing blank line when the target feature's LAST entry (by
// log position) is heading-only. Relies on a duplicate id (canon §7/#18,
// F6): grain5.9 supersedes 'grain5.1', which retires BOTH physical entries
// sharing that id — including the second one, which is also the stream's
// positionally-last entry. Before the generalized trailing-blank fix, the
// loop only guaranteed a trailing blank when the LAST entry was shown in
// full; a heading-only last entry is only reachable via this kind of
// duplicate-id collision.
const DUPLICATE_ID_LAST_ENTRY_LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude grain5.1 | build — first instance of a duplicated id
STATUS: complete

## [2026-07-02] claude grain5.9 | build — corrects grain5.1
SUPERSEDES: grain5.1 (ghost, corrected)
STATUS: complete

## [2026-07-04] claude grain5.1 | build — a second, later entry reusing id "grain5.1" (hand-mangled)
STATUS: complete
`;

test('coverage gap: exactly one trailing blank line when the target feature\'s last entry is heading-only (duplicate-id retirement, F6)', () => {
  const dir = makeProject({ log: DUPLICATE_ID_LAST_ENTRY_LOG });
  const brief = compileBrief({ feature: 'grain5', tag: 'claude' }, { cwd: dir, now: NOW, home: HOME });
  const lines = brief.split('\n');
  const otherWorkAt = lines.indexOf('## Other work in flight — headings only (last 5)');
  assert.ok(otherWorkAt > 1, '## Other work in flight heading present');
  assert.equal(lines[otherWorkAt - 1], '', 'exactly one blank line directly before the next section');
  assert.notEqual(lines[otherWorkAt - 2], '', 'not two consecutive blank lines');
});
