import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { DIRTY_MARKER_LINE, RETIRED_HEADER_RE } from '../lib/state.mjs';
import { ARCHIVE_HEADER_LINES, runStateArchive } from '../lib/state-archive.mjs';

const canonDir = fileURLToPath(new URL('../canon', import.meta.url));
const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
const docsDir = fileURLToPath(new URL('../docs', import.meta.url));

const REQUIRED_FILES = ['CONTINUITY.md', 'STANDARD.md', 'SESSION-LOG.md'];

// The six v1.1 architecture elements per docs/DESIGN.md.
const REQUIRED_STRINGS = [
  'Hot/cold surface tiering',
  'Closed allowlist entry ritual',
  'Headings-not-bodies',
  '48h ghost rule',
  'Snapshot session lifecycle (BEGIN/WORK/CLOSE)',
  'Changes from v1',
];

// v1.2 additions: agent bootstrap, upstream/sync model, topic-grain language.
const REQUIRED_V12_STRINGS = [
  'Agent bootstrap — landing in a bare workspace',
  'Upstream and sync — who owns which surface',
  'non-code topic dir',
  'git repository or a non-code',
];

// Machine-readable canon revision marker, first line of every canon file.
const VERSION_MARKER_RE = /<!-- banana:canon rev (\d+\.\d+) -->/;

// Per-file revisions — a file's marker bumps when its protocol text changes.
const EXPECTED_REVS = {
  'CONTINUITY.md': '1.7',
  'STANDARD.md': '1.3',
  'SESSION-LOG.md': '1.4',
};

// DIRTY_MARKER_LINE (ADR 0001, byte-exact) and RETIRED_HEADER_RE (the
// retired "rebuilt whole, never patched" rule — retired at both grains now:
// project via ADR 0001's rebuild-on-close, global via ADR 0005's per-thread
// edits) are single-sourced from lib/state.mjs (banana state lint, #9/#15)
// so the canon's own byte-exact assertions and the lint tool's detection can
// never drift apart.

// Machine-specific residue that must never ship in the canon.
const FORBIDDEN_PATTERNS = [
  { name: 'Ahimsa', re: /ahimsa/i },
  { name: 'VICTUS', re: /victus/i },
  { name: 'hermes.exe', re: /hermes\.exe/i },
  { name: 'absolute C:/ path', re: /\bC:[\\/]/ },
];

/** Collapse runs of whitespace so assertions survive source-line wrapping. */
function flatten(text) {
  return text.replace(/\s+/g, ' ');
}

test('canon/ ships all three protocol docs', () => {
  const files = readdirSync(canonDir);
  for (const f of REQUIRED_FILES) {
    assert.ok(files.includes(f), `canon/${f} is missing`);
  }
});

test('canon/CONTINUITY.md carries all six v1.1 architecture elements', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  for (const s of REQUIRED_STRINGS) {
    assert.ok(text.includes(s), `CONTINUITY.md missing required string: "${s}"`);
  }
});

test('canon/CONTINUITY.md carries the v1.2 sections and topic-grain language', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  for (const s of REQUIRED_V12_STRINGS) {
    assert.ok(text.includes(s), `CONTINUITY.md missing v1.2 string: "${s}"`);
  }
});

test('every canon file carries its expected version marker', () => {
  for (const [f, rev] of Object.entries(EXPECTED_REVS)) {
    const text = readFileSync(join(canonDir, f), 'utf8');
    const m = text.match(VERSION_MARKER_RE);
    assert.ok(m, `canon/${f} has no version marker`);
    assert.equal(m[1], rev, `canon/${f} marker is rev ${m?.[1]}, expected ${rev}`);
  }
});

test('STANDARD.md carries the v1.3 rebuild-on-close amendment (ADR 0001)', () => {
  const text = readFileSync(join(canonDir, 'STANDARD.md'), 'utf8');
  const flat = flatten(text);
  assert.ok(
    text.includes(DIRTY_MARKER_LINE),
    'STANDARD.md missing the canonical dirty-marker line'
  );
  assert.ok(
    flat.includes('Rebuild-on-close'),
    'STANDARD.md missing the rebuild-on-close discipline'
  );
  assert.ok(
    flat.includes('OR the dirty marker is standing'),
    'STANDARD.md missing the extended close-time trigger'
  );
  assert.ok(
    flat.includes('a standing marker obliges nothing at session open'),
    'STANDARD.md missing the lazy-repair rule'
  );
  assert.ok(
    !RETIRED_HEADER_RE.test(text),
    'STANDARD.md still carries the retired rebuild-whole rule'
  );
  assert.ok(
    !/rebuild-don.t-patch/i.test(text),
    'STANDARD.md still references rebuild-don\'t-patch'
  );
});

test('CONTINUITY.md project grain is amended; global grain moves to per-thread edits (v1.6)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const flat = flatten(text);
  assert.ok(
    flat.includes('Rebuilt from the logbook at session close'),
    'CONTINUITY.md project grain not amended to rebuild-on-close'
  );
  assert.ok(
    text.includes(DIRTY_MARKER_LINE),
    'CONTINUITY.md missing the canonical dirty-marker line'
  );
  assert.ok(
    !flat.includes('Rebuilt from the logbook, never patched'),
    'CONTINUITY.md still carries the retired project-STATE rule'
  );
  assert.ok(
    !text.includes('> One page, hard cap. Rebuilt whole, never patched.'),
    'CONTINUITY.md global template header still carries the retired rebuild-whole rule'
  );
  assert.ok(
    text.includes('> One page, hard cap. Edit only your own threads; never rewrite the page.'),
    'CONTINUITY.md global template header missing the new per-thread-edits line'
  );
});

test('CONTINUITY.md carries the v1.4 supersession-aware ghost amendment (ADR 0003)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  assert.ok(
    text.includes('retired from ghost surfaces'),
    'CONTINUITY.md missing the supersession-aware ghost retirement text'
  );
  // No title-version assertion here: the exact current title is pinned once,
  // by the newest amendment's own test (below) and by the generic
  // 'every canon file carries its expected version marker' test — coupling
  // it here too would break this v1.4-specific test on every later bump.
});

test('CONTINUITY.md carries the v1.5 Active-threads freshness-stamp amendment (ADR 0004 §Global grain)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  assert.ok(
    text.includes('Freshness stamp'),
    'CONTINUITY.md missing the Freshness stamp amendment'
  );
  assert.ok(
    text.includes('- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)'),
    'CONTINUITY.md Global-grain template missing the freshness-stamped Active-threads placeholder'
  );
  // No title-version assertion here: the exact current title is pinned once,
  // by the newest amendment's own test (below) and by the generic
  // 'every canon file carries its expected version marker' test — coupling
  // it here too would break this v1.5-specific test on every later bump.
});

test('CONTINUITY.md carries the v1.6 per-thread-edits amendment (ADR 0005)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  assert.ok(
    text.includes('Per-thread edits'),
    'CONTINUITY.md missing the Per-thread edits amendment'
  );
  assert.ok(
    text.includes('silently deletes a concurrent session\'s'),
    'CONTINUITY.md missing the Per-thread edits Counter-failure sentence'
  );
  // No title-version assertion here: the exact current title is pinned once,
  // by the newest amendment's own test (below) and by the generic
  // 'every canon file carries its expected version marker' test — coupling
  // it here too would break this v1.6-specific test on every later bump.
});

test('CONTINUITY.md carries the v1.7 limits/expiry/archive amendment (ADR 0006)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  assert.ok(
    text.includes('Line limits, closed stamp, inactivity, and the archive move'),
    'CONTINUITY.md missing the v1.7 limits/expiry/archive amendment'
  );
  assert.ok(
    text.includes('STATE-archive.md'),
    'CONTINUITY.md missing the archive-file pointer'
  );
  assert.ok(
    text.includes('it simply vanished'),
    'CONTINUITY.md missing the v1.7 Counter-failure sentence'
  );
  assert.ok(
    text.includes('— v1.7'),
    'CONTINUITY.md title not bumped to v1.7'
  );
});

test('canon Global-grain embedded template agrees with templates/global-STATE.md on the header', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const HEADER_LINE = '> One page, hard cap. Edit only your own threads; never rewrite the page.';
  assert.ok(
    continuity.includes(HEADER_LINE),
    'CONTINUITY.md Global-grain template missing the new header line'
  );
  assert.ok(
    template.includes(HEADER_LINE),
    'templates/global-STATE.md missing the new header line'
  );
});

test('canon Global-grain embedded template agrees with templates/global-STATE.md on the Active-threads placeholder', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const ACTIVE_THREADS_LINE =
    '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)';
  assert.ok(
    continuity.includes(ACTIVE_THREADS_LINE),
    'CONTINUITY.md Global-grain template missing the freshness-stamped Active-threads placeholder'
  );
  assert.ok(
    template.includes(ACTIVE_THREADS_LINE),
    'templates/global-STATE.md missing the freshness-stamped Active-threads placeholder'
  );
});

// #20b/#20c review (K4): the header's limits/expiry/archive block is exactly
// four blockquote lines, each <=100 chars, restating D1-D3's corrected
// wording plus #20c E6's secret exception — pinned here, byte-for-byte, in
// both the canon's embedded template and templates/global-STATE.md. The
// header DOES name the day thresholds (8+/31+) as quick numbers a reader can
// act on without opening the body; what it does NOT carry is the exact
// comparison direction ("more than N days before the reference date") or the
// reference-date definition itself — those stay in the Global-grain body,
// pinned by the next test. The old backwards-expiry wording ("expire after 7
// days", "idle 30+ days") is gone from the header entirely.
test('canon Global-grain embedded template agrees with templates/global-STATE.md on all four #20b/#20c header lines', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const HEADER_LINES = [
    '> One line per bullet: thread 400 · backlog 300 · watch 350 · closed 250 chars.',
    '> Closed lines carry `(closed YYYY-MM-DD)`. By the page\'s newest stamp, closed lines expire',
    '> at 8+ days and threads idle 31+ days move to Backlog. Never delete a line — except',
    '> a pasted secret, deleted outright. `banana state archive` moves the rest to STATE-archive.md.',
  ];
  for (const line of HEADER_LINES) {
    assert.ok(line.length <= 100, `header line exceeds 100 chars (${line.length}): "${line}"`);
    assert.ok(
      continuity.includes(line),
      `CONTINUITY.md Global-grain template missing header line: "${line}"`
    );
    assert.ok(template.includes(line), `templates/global-STATE.md missing header line: "${line}"`);
  }
  assert.ok(
    !continuity.includes('expire after 7 days') && !continuity.includes('idle 30+ days'),
    'CONTINUITY.md header still carries the #20b backwards expiry/inactivity wording'
  );
});

// #20b review (D3): the precise day thresholds and their corrected
// direction live in the Global-grain BODY prose, not the header — pinned
// here as the normative rule sentences themselves, distinct wording from
// the v1.7 changelog entry's own restatement, so deleting the body rule
// fails this test even though the changelog still "sounds similar".
test('CONTINUITY.md Global-grain body states the corrected closed-expiry and thread-inactivity direction (#20b, ADR 0006)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes('more than 7 days before the page\'s own reference date'),
    'CONTINUITY.md Global-grain body missing the corrected closed-expiry direction'
  );
  assert.ok(
    flat.includes('more than 30 days before that same reference date — 31 or more'),
    'CONTINUITY.md Global-grain body missing the corrected thread-inactivity direction'
  );
});

// #20b review (item 3): the kit-ownership promise in "Upstream and sync"
// gets a precise carve-out for `state archive` — the one kit command
// allowed to touch the global page's content, and only the one named line.
test('CONTINUITY.md Upstream-and-sync carve-out names state archive as the one content exception (#20b)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes('the kit never rewrites their content'),
    'CONTINUITY.md Upstream-and-sync bullet missing the amended kit-ownership promise'
  );
  assert.ok(
    flat.includes('the single kit command permitted to touch the global page\'s content'),
    'CONTINUITY.md Upstream-and-sync bullet missing the state-archive carve-out'
  );
});

test('canon Global-grain embedded template agrees with templates/global-STATE.md on the #20 Recently-closed placeholder', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const CLOSED_LINE =
    '- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)';
  assert.ok(
    continuity.includes(CLOSED_LINE),
    'CONTINUITY.md Global-grain template missing the #20 Recently-closed placeholder'
  );
  assert.ok(
    template.includes(CLOSED_LINE),
    'templates/global-STATE.md missing the #20 Recently-closed placeholder'
  );
});

// #20c review (H64): the Global-grain body's own secrets rule, reason
// definitions, clock-aware gate and by-hand archive format are pinned here
// directly, by text that lives ONLY in the body — not the changelog, which
// restates similar ideas in different words as historical record. Deleting
// the body sentence (leaving the changelog untouched) must still fail these.
test('CONTINUITY.md Global-grain body states the Secrets rule (#20c H64)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes('pasted onto the page is deleted outright, never archived'),
    'CONTINUITY.md Global-grain body missing the Secrets deletion rule'
  );
  assert.ok(
    flat.includes('it is the only edit the archive file ever takes'),
    'CONTINUITY.md Global-grain body missing the Secrets archive-edit sentence'
  );
});

test('CONTINUITY.md Global-grain body defines all five archive reasons (#20c H64, C37)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  const REASON_DEFINITIONS = [
    '`expired` (a closed line past its expiry)',
    '`inactive` (an idle thread becoming a one-line Backlog item)',
    '`trimmed` (the archive keeps a copy only — the live line is shortened in place by hand)',
    '`closed` (a finished Active thread: archive its line, add a Recently-closed line)',
    '`removed` (anything else the owner drops)',
  ];
  for (const def of REASON_DEFINITIONS) {
    assert.ok(
      flat.includes(def),
      `CONTINUITY.md Global-grain body missing reason definition: "${def}"`
    );
  }
});

test("CONTINUITY.md Global-grain body states the archive command's clock-aware gate (#20c H64)", () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      "For `--reason expired` it refuses unless the line's own `(closed …)` stamp is more than 7 days before today"
    ),
    'CONTINUITY.md Global-grain body missing the expired clock-gate rule'
  );
  assert.ok(
    flat.includes(
      'for `--reason inactive` it refuses unless the `(as of …)` stamp is more than 30 days before today'
    ),
    'CONTINUITY.md Global-grain body missing the inactive clock-gate rule'
  );
  assert.ok(
    flat.includes(
      'Before any of that, the gate scans EVERY Active-threads `(as of …)` and Recently-closed `(closed …)` stamp on the page'
    ),
    'CONTINUITY.md Global-grain body missing the page-wide future-stamp scan rule'
  );
});

test('CONTINUITY.md by-hand archive format matches literal expected text (#20c H64)', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8').replace(/\r\n/g, '\n');
  const EXPECTED_BY_HAND_BLOCK = [
    '  # GLOBAL STATE — archive',
    '  > Append-only — except a pasted secret: delete it here too, on sight. Lines moved off',
    '  > ~/.agents/STATE.md (or the long form of trimmed ones), verbatim, newest last. Never',
    '  > loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md',
    '',
    '  ## [YYYY-MM-DD] {agent} — {reason} · {section name}',
    '  {the matched line, byte-verbatim}',
  ].join('\n');
  assert.ok(
    continuity.includes(EXPECTED_BY_HAND_BLOCK),
    'CONTINUITY.md by-hand archive block does not match the literal expected text'
  );
});

// #20c H64: unlike the embedded STATE template (pinned above against
// templates/global-STATE.md), nothing previously checked that the by-hand
// archive header agrees with what `banana state archive` itself writes
// (lib/state-archive.mjs's ARCHIVE_HEADER_LINES) — so the two could drift
// and a harness without the kit would create archives shaped differently
// from the kit's own.
test("CONTINUITY.md by-hand archive header agrees with lib/state-archive.mjs's ARCHIVE_HEADER_LINES byte for byte (#20c H64)", () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const line of ARCHIVE_HEADER_LINES) {
    assert.ok(
      continuity.includes(`  ${line}`),
      `CONTINUITY.md by-hand archive header disagrees with lib/state-archive.mjs ARCHIVE_HEADER_LINES: "${line}"`
    );
  }
});

test('SESSION-LOG.md cites its companion standard without a version pin', () => {
  const text = readFileSync(join(canonDir, 'SESSION-LOG.md'), 'utf8');
  assert.ok(
    text.includes('companion to `STANDARD.md` (the Logbook Standard)'),
    'SESSION-LOG.md footer missing the version-agnostic companion citation'
  );
  assert.ok(
    !/Logbook Standard v\d/.test(text),
    'SESSION-LOG.md still pins a Logbook Standard version'
  );
});

test('SESSION-LOG.md carries the v2.3 continuation-shape amendment (ADR 0003)', () => {
  const text = readFileSync(join(canonDir, 'SESSION-LOG.md'), 'utf8');
  assert.ok(
    text.includes('A kit command that stamps entries writes exactly this shape.'),
    'SESSION-LOG.md missing the pinned continuation-entry shape text'
  );
  assert.ok(
    text.includes('# Session Log — v2.3'),
    'SESSION-LOG.md title not bumped to v2.3'
  );
});

test('canon §3 embedded template header matches templates/project-STATE.md', () => {
  const standard = readFileSync(join(canonDir, 'STANDARD.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'project-STATE.md'), 'utf8');
  const HEADER_LINES = [
    '> Projection of LOGBOOK.md as of (date) (through none). Logbook wins',
    '> on conflict. One page, hard cap. Rebuilt at session close; mid-arc',
    '> section patches are legal and must carry the dirty-marker line.',
  ];
  for (const line of HEADER_LINES) {
    assert.ok(standard.includes(line), `STANDARD.md §3 template missing header line: "${line}"`);
    assert.ok(template.includes(line), `templates/project-STATE.md missing header line: "${line}"`);
  }
});

test('canon/ contains zero machine-specific references', () => {
  for (const f of readdirSync(canonDir)) {
    const text = readFileSync(join(canonDir, f), 'utf8');
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      assert.ok(!re.test(text), `canon/${f} contains forbidden reference: ${name}`);
    }
  }
});

// =====================================================================
// #20d verification fixes (lane D2). The #20d spec's own findings file
// (keys recheck.<id> / fresh.F<n>) is each test's source; see
// .agents/specs/cli-20d-verify-fixes.md's Lane D2 paragraph.
// =====================================================================

test('CONTINUITY.md Session-lifecycle CLOSE step edits the global page per-thread, never rebuilds it (#20d F7)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      'global STATE.md: never rebuilt — edit only the threads and items this session owns or changed'
    ),
    'CONTINUITY.md CLOSE step missing the per-thread-edit rule for the global page'
  );
  assert.ok(
    !flat.includes('global STATE.md: rebuild when cross-project state changed'),
    'CONTINUITY.md CLOSE step still tells agents to rebuild the global page whole'
  );
});

test('CONTINUITY.md Global-grain body states E2: an indented line right after a bullet is always a continuation (#20d F8)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      'A line indented 2+ spaces or a tab, directly after the bullet, is always a continuation line'
    ),
    'CONTINUITY.md Global-grain body missing the E2 indented-line-is-always-continuation rule'
  );
  assert.ok(
    flat.includes('whatever it itself holds, even an indented heading, fence, or comment'),
    'CONTINUITY.md Global-grain body missing E2\'s "whatever it holds" clause'
  );
});

test('docs/DESIGN.md one-physical-line-per-bullet rule states E2 without a blank-line precondition (#20d F8)', () => {
  const flat = flatten(readFileSync(join(docsDir, 'DESIGN.md'), 'utf8'));
  assert.ok(
    flat.includes(
      'is ALWAYS a continuation line — whatever it itself holds (an indented heading'
    ),
    'docs/DESIGN.md one-physical-line-per-bullet rule missing the unconditional indented-line clause'
  );
  assert.ok(
    flat.includes('with no blank line required first'),
    'docs/DESIGN.md one-physical-line-per-bullet rule still requires a blank line before an indented continuation'
  );
});

test('docs/DESIGN.md brief/log-close collapse is decided by the GLOBAL verdict alone, never both sides (#20d F9)', () => {
  const flat = flatten(readFileSync(join(docsDir, 'DESIGN.md'), 'utf8'));
  assert.ok(
    flat.includes('Project findings always print in full, exactly as `state lint` prints them — never collapsed'),
    'docs/DESIGN.md State-lint section missing the "project findings never collapse" rule'
  );
  assert.ok(
    flat.includes('The GLOBAL side collapses on its own, independent of what the project side is doing'),
    'docs/DESIGN.md State-lint section missing the GLOBAL-only collapse condition'
  );
  assert.ok(
    !flat.includes("When BOTH sides' verdicts are"),
    'docs/DESIGN.md State-lint section still conditions the collapse on BOTH sides agreeing'
  );
});

test('CONTINUITY.md Global-grain body AND changelog item 17 state the ownership exception for a blocking future-dated stamp (#20d H17)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      "above: any session may archive an `expired` closed line, or correct an impossible future-dated stamp that is blocking someone else's move (below), on sight"
    ),
    'CONTINUITY.md Global-grain body missing the non-owner future-stamp-correction exception'
  );
  assert.ok(
    flat.includes(
      "threads\": any session may archive an `expired` closed line, or correct an impossible future-dated stamp that is blocking someone else's move, on sight"
    ),
    'CONTINUITY.md v1.7 changelog item 17 missing the non-owner future-stamp-correction exception'
  );
});

test('CONTINUITY.md Upstream-and-sync carve-out names the placeholder write-back (#20d H18)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes("only ever that one named line plus, when needed, its section's placeholder"),
    'CONTINUITY.md Upstream-and-sync bullet missing the placeholder write-back clause'
  );
});

test('CONTINUITY.md v1.7 changelog introduces the archive content exception, rather than merely extending it (#20d H22)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      "the same pass also introduces `state archive`'s one exception to the \"Upstream and sync\" carve-out above"
    ),
    'CONTINUITY.md v1.7 changelog intro still describes the archive exception as a mere extension'
  );
});

// #20d H46: the wording fix shipped in #20c (CONTINUITY.md:126-138, changelog
// item 17) was never pinned — a revert of either sentence passed every test.
test('CONTINUITY.md one-line rule is stated as "broken the moment", never "marker line plus" (#20d H46)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      'every top-level bullet is written as one physical line, nothing else following it. A bullet has already broken that rule the moment it carries even one continuation line'
    ),
    'CONTINUITY.md Global-grain body missing the corrected one-line rule statement'
  );
  assert.ok(
    flat.includes(
      'every top-level bullet must be written as one physical line — a bullet with even one continuation line'
    ),
    'CONTINUITY.md v1.7 changelog item 17 missing the corrected one-line rule statement'
  );
  assert.ok(
    !flat.includes('is one physical line: its own marker line'),
    'CONTINUITY.md still carries the retired "marker line plus" one-line-rule wording'
  );
});

// #20d H47: the "lint vs. archive clock" reconciling sentence (canon +
// DESIGN) was added in #20c but nothing failed when it was deleted.
test('CONTINUITY.md and docs/DESIGN.md state that the lint and archive clocks can disagree (#20d H47)', () => {
  const canonFlat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  const designFlat = flatten(readFileSync(join(docsDir, 'DESIGN.md'), 'utf8'));
  const SHARED_SENTENCE =
    "lint compares a stamp against the page's reference date, the gate compares the same stamp against today";
  assert.ok(canonFlat.includes(SHARED_SENTENCE), 'CONTINUITY.md missing the lint-vs-archive-clock disagreement sentence');
  assert.ok(designFlat.includes(SHARED_SENTENCE), 'docs/DESIGN.md missing the lint-vs-archive-clock disagreement sentence');
});

// #20d H52: the reference date and the D3 future-stamp scan only ever read
// Active-threads/Recently-closed stamps — Watch/Backlog never carry the
// convention — but the canon, its changelog, and the ADR all said "any
// stamp on the page" with no section scope.
test('CONTINUITY.md scopes the reference date to Active-threads/Recently-closed stamps, not "any stamp on the page" (#20d H52)', () => {
  const flat = flatten(readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'));
  assert.ok(
    flat.includes(
      "the newest valid Active-threads `(as of …)` or Recently-closed `(closed …)` stamp on the page (Watch and Backlog never carry this stamp convention"
    ),
    'CONTINUITY.md Global-grain body missing the section-scoped reference-date definition'
  );
  assert.ok(
    flat.includes('the newest valid Active-threads or Recently-closed stamp on the page, never the clock'),
    'CONTINUITY.md v1.7 changelog item 17 missing the section-scoped reference-date definition'
  );
});

test('docs/adr/0006 scopes the reference date and the D3 future-stamp scan the same way (#20d H52)', () => {
  const flat = flatten(readFileSync(join(docsDir, 'adr', '0006-global-page-limits-and-archive.md'), 'utf8'));
  assert.ok(
    flat.includes(
      'the newest real calendar date among the page\'s own non-placeholder Active-threads `(as of …)` and Recently-closed `(closed …)` stamps — Watch and Backlog never carry this stamp convention'
    ),
    'docs/adr/0006 clock-free-reference-date section missing the section-scoped definition'
  );
  assert.ok(
    flat.includes(
      'Before either check, the gate scans every non-placeholder Active-threads `(as of …)` and Recently-closed `(closed …)` stamp on the page'
    ),
    'docs/adr/0006 D3 section missing the section-scoped future-stamp-scan definition'
  );
});

// #20d H64 (fifth pin): the by-hand record heading `## [YYYY-MM-DD] {agent}
// — {reason} · {section name}` (canon/CONTINUITY.md) was pinned only as a
// literal string, never against what `banana state archive` itself writes
// (lib/state-archive.mjs builds its own heading inline, un-exported). This
// drives a real archive move through a sandboxed home, then checks that the
// canon's own placeholder template, with the SAME values substituted,
// equals the real record heading byte for byte — so the two can no longer
// drift apart with every other test still green.
test("CONTINUITY.md by-hand record heading matches what state archive actually writes, byte for byte (#20d H64 fifth pin)", async (t) => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const headingTemplateMatch = continuity.match(
    /## \[YYYY-MM-DD\] \{agent\} — \{reason\} · \{section name\}/
  );
  assert.ok(headingTemplateMatch, 'CONTINUITY.md missing the literal by-hand record-heading template');

  const dir = mkdtempSync(join(tmpdir(), 'banana-canon-h64-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.agents'), { recursive: true });
  const pageText = [
    '# GLOBAL STATE — cross-project projection',
    '> One page, hard cap. Edit only your own threads; never rewrite the page.',
    '> Chronology lives in project logbooks; this file only answers "what\'s live and',
    '> what\'s queued across everything." Owner: tester. Protocol:',
    '> `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)',
    '',
    '## Backlog (owned)',
    '- tester — a synthetic backlog item for the pin',
    '',
    '## Watch',
    '- (assumptions and deadlines needing attention, each with a validate-by date)',
    '',
    '## Recently closed (context for next session)',
    '- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)',
    '',
  ].join('\n');
  writeFileSync(join(dir, '.agents', 'STATE.md'), pageText, 'utf8');

  /** @type {string[]} */
  const outLines = [];
  /** @type {string[]} */
  const errLines = [];
  const io = {
    out: (/** @type {string} */ l = '') => outLines.push(l),
    err: (/** @type {string} */ l = '') => errLines.push(l),
  };
  /** @type {import('../lib/state.mjs').StateArchiveFlags} */
  const flags = {
    verb: 'archive',
    global: true,
    match: 'a synthetic backlog item for the pin',
    reason: 'removed',
    tag: 'claude',
    dryRun: false,
  };
  const now = new Date(2026, 9, 2, 12, 0, 0).getTime();
  const result = await runStateArchive(flags, { home: dir, now, io });
  assert.equal(result.code, 0, `archive call failed: ${errLines.join('\n')}`);

  const archiveText = readFileSync(join(dir, '.agents', 'STATE-archive.md'), 'utf8').replace(/\r\n|\r/g, '\n');
  const idx = archiveText.lastIndexOf('\n## [');
  assert.ok(idx !== -1, 'STATE-archive.md has no record heading at all');
  const recordBlock = archiveText.slice(idx + 1).replace(/\n+$/, '');
  const recordHeadingLine = recordBlock.split('\n')[0];

  const expectedHeading = headingTemplateMatch[0]
    .replace('YYYY-MM-DD', '2026-10-02')
    .replace('{agent}', 'claude')
    .replace('{reason}', 'removed')
    .replace('{section name}', 'Backlog (owned)');

  assert.equal(
    recordHeadingLine,
    expectedHeading,
    "the archive's real record heading disagrees with CONTINUITY.md's by-hand heading template"
  );
});
