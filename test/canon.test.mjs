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

test('canon/ contains zero machine-specific references', () => {
  for (const f of readdirSync(canonDir)) {
    const text = readFileSync(join(canonDir, f), 'utf8');
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      assert.ok(!re.test(text), `canon/${f} contains forbidden reference: ${name}`);
    }
  }
});
