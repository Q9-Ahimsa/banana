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
// v2 blocks are thin bootstrap pointers: protocol rules live in the canon.
const FENCE_BEGIN = '<!-- banana:begin v2 -->';
const FENCE_END = '<!-- banana:end -->';

// The stable pointer surface every v2 wiring block must carry.
const CANON_DIR_POINTER = '~/.agents/canon/';
const NPX_INVOCATION = 'npx --yes github:Q9-Ahimsa/banana';
const SELF_SETUP_RE = /self-setup/i;
const SESSION_RITUAL_RE = /session ritual/i;

// Ceiling on the block body (lines strictly between the fence markers) —
// bootstrap pointers stay thin; protocol growth belongs in the canon.
const MAX_BLOCK_BODY_LINES = 30;

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

test('every wiring template carries both v2 fence markers', () => {
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes(FENCE_BEGIN), `templates/${f} missing ${FENCE_BEGIN}`);
    assert.ok(text.includes(FENCE_END), `templates/${f} missing ${FENCE_END}`);
    assert.ok(!text.includes('banana:begin v1'), `templates/${f} still carries a v1 marker`);
  }
});

test('every wiring template is a bootstrap pointer: canon dir, npx invocation, self-setup, ritual', () => {
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes(CANON_DIR_POINTER), `templates/${f} missing canon dir pointer ${CANON_DIR_POINTER}`);
    assert.ok(text.includes(NPX_INVOCATION), `templates/${f} missing npx invocation ${NPX_INVOCATION}`);
    assert.match(text, SELF_SETUP_RE, `templates/${f} missing a self-setup instruction`);
    assert.match(text, SESSION_RITUAL_RE, `templates/${f} missing the session ritual one-liner`);
    assert.ok(text.includes('__AGENT_TAG__'), `templates/${f} missing the identity tag token`);
    assert.ok(text.includes('__OWNER__'), `templates/${f} missing the owner token`);
  }
});

test(`every wiring block body is ${MAX_BLOCK_BODY_LINES} lines or fewer`, () => {
  for (const f of WIRING_FILES) {
    const lines = readFileSync(join(templatesDir, f), 'utf8').split('\n');
    const begin = lines.findIndex((l) => l.includes(FENCE_BEGIN));
    const end = lines.findIndex((l) => l.includes(FENCE_END));
    assert.ok(begin !== -1 && end > begin, `templates/${f} fence markers not found in order`);
    const bodyLines = end - begin - 1;
    assert.ok(
      bodyLines <= MAX_BLOCK_BODY_LINES,
      `templates/${f} block body is ${bodyLines} lines (max ${MAX_BLOCK_BODY_LINES})`
    );
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
  // The public repo slug is the kit's distribution coordinate — the one
  // sanctioned occurrence of the owner's username. Everything else that
  // identifies a person or machine stays forbidden.
  const REPO_SLUG = 'Q9-Ahimsa/banana';
  const forbidden = [
    { name: 'Ahimsa', re: /ahimsa/i },
    { name: 'VICTUS', re: /victus/i },
    { name: 'hermes.exe', re: /hermes\.exe/i },
    { name: 'absolute C:/ path', re: /\bC:[\\/]/ },
  ];
  for (const f of walk(templatesDir)) {
    const text = readFileSync(join(templatesDir, f), 'utf8').replaceAll(REPO_SLUG, '');
    for (const { name, re } of forbidden) {
      assert.ok(!re.test(text), `templates/${f} contains forbidden reference: ${name}`);
    }
  }
});
