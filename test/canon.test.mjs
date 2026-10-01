import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { DIRTY_MARKER_LINE, RETIRED_HEADER_RE } from '../lib/state.mjs';

const canonDir = fileURLToPath(new URL('../canon', import.meta.url));
const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));

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

// #20b review: the header's limits/expiry/archive block is exactly three
// blockquote lines, each <=100 chars, restating D1-D3's corrected wording —
// pinned here, byte-for-byte, in both the canon's embedded template and
// templates/global-STATE.md. The old backwards-expiry wording ("expire
// after 7 days", "idle 30+ days") is gone from the header entirely; the
// precise day thresholds live in the Global-grain body instead (next test).
test('canon Global-grain embedded template agrees with templates/global-STATE.md on all three #20b header lines', () => {
  const continuity = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  const template = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const HEADER_LINES = [
    '> One line per bullet: thread 400 · backlog 300 · watch 350 · closed 250 chars.',
    '> Closed lines carry `(closed YYYY-MM-DD)`; dates measured against the page\'s newest stamp.',
    '> Never delete a line: `banana state archive` moves it to STATE-archive.md.',
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
