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
  'CONTINUITY.md': '1.4',
  'STANDARD.md': '1.3',
  'SESSION-LOG.md': '1.4',
};

// DIRTY_MARKER_LINE (ADR 0001, byte-exact) and RETIRED_HEADER_RE (the
// retired project-STATE rule — global grain keeps rebuild-whole by design)
// are single-sourced from lib/state.mjs (banana state lint, #9) so the
// canon's own byte-exact assertions and the lint tool's detection can never
// drift apart.

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

test('CONTINUITY.md project grain is amended; global grain keeps rebuild-whole', () => {
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
    text.includes('> One page, hard cap. Rebuilt whole, never patched. Chronology lives in project'),
    'CONTINUITY.md global template header must keep rebuild-whole (out of amendment scope)'
  );
});

test('CONTINUITY.md carries the v1.4 supersession-aware ghost amendment (ADR 0003)', () => {
  const text = readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8');
  assert.ok(
    text.includes('retired from ghost surfaces'),
    'CONTINUITY.md missing the supersession-aware ghost retirement text'
  );
  assert.ok(
    text.includes('— v1.4'),
    'CONTINUITY.md title not bumped to v1.4'
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
