import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const canonDir = fileURLToPath(new URL('../canon', import.meta.url));

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

// Machine-specific residue that must never ship in the canon.
const FORBIDDEN_PATTERNS = [
  { name: 'Ahimsa', re: /ahimsa/i },
  { name: 'VICTUS', re: /victus/i },
  { name: 'hermes.exe', re: /hermes\.exe/i },
  { name: 'absolute C:/ path', re: /\bC:[\\/]/ },
];

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

test('every canon file carries a rev 1.2 version marker', () => {
  for (const f of REQUIRED_FILES) {
    const text = readFileSync(join(canonDir, f), 'utf8');
    const m = text.match(VERSION_MARKER_RE);
    assert.ok(m, `canon/${f} has no version marker`);
    assert.equal(m[1], '1.2', `canon/${f} marker is rev ${m?.[1]}, expected 1.2`);
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
