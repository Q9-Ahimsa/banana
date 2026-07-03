import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));

const REQUIRED_FILES = [
  'global-STATE.md',
  'project-STATE.md',
  'LOGBOOK-header.md',
  'session-log-seed.md',
  join('wiring', 'claude-code.md'),
  join('wiring', 'agents-md.md'),
  join('wiring', 'portable-directive.md'),
];

const WIRING_FILES = REQUIRED_FILES.filter((f) => f.startsWith('wiring'));

// Fence markers per docs/DESIGN.md — idempotent insert-or-replace anchors.
const FENCE_BEGIN = '<!-- banana:begin v1 -->';
const FENCE_END = '<!-- banana:end -->';

// The only documented placeholder tokens.
const ALLOWED_TOKENS = new Set(['__OWNER__', '__AGENT_TAG__']);

/** @returns {string[]} every file under templates/, as paths relative to it */
function walk(dir, prefix = '') {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

test('templates/ ships all seven template files', () => {
  const files = new Set(walk(templatesDir));
  for (const f of REQUIRED_FILES) {
    assert.ok(files.has(f), `templates/${f} is missing`);
  }
});

test('every wiring template carries both fence markers', () => {
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes(FENCE_BEGIN), `templates/${f} missing ${FENCE_BEGIN}`);
    assert.ok(text.includes(FENCE_END), `templates/${f} missing ${FENCE_END}`);
  }
});

test('only the two documented placeholder tokens appear in templates/', () => {
  for (const f of walk(templatesDir)) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    for (const m of text.match(/__[A-Z][A-Z_]*__/g) ?? []) {
      assert.ok(
        ALLOWED_TOKENS.has(m),
        `templates/${f} contains undocumented placeholder token: ${m}`
      );
    }
  }
});

test('templates/ contains zero double-brace residue', () => {
  for (const f of walk(templatesDir)) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(!text.includes('{{'), `templates/${f} contains '{{' residue`);
    assert.ok(!text.includes('}}'), `templates/${f} contains '}}' residue`);
  }
});

test('templates/ contains zero machine-specific references', () => {
  const forbidden = [
    { name: 'Ahimsa', re: /ahimsa/i },
    { name: 'VICTUS', re: /victus/i },
    { name: 'hermes.exe', re: /hermes\.exe/i },
    { name: 'absolute C:/ path', re: /\bC:[\\/]/ },
  ];
  for (const f of walk(templatesDir)) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    for (const { name, re } of forbidden) {
      assert.ok(!re.test(text), `templates/${f} contains forbidden reference: ${name}`);
    }
  }
});
