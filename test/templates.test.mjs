import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { RETIRED_HEADER_RE } from '../lib/state.mjs';
import { fenceBegin } from '../lib/fence.mjs';
import { wiringTemplateVersion } from '../lib/wiring.mjs';

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
// Derived from the template itself (never hardcoded) so a future version
// bump doesn't silently desync this file from the real kit-bundled fence.
const CURRENT_WIRING_VERSION = wiringTemplateVersion('claude-code.md');
const FENCE_BEGIN = fenceBegin(CURRENT_WIRING_VERSION);
const FENCE_END = '<!-- banana:end -->';

// The stable pointer surface every wiring block must carry, current version.
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

test('every wiring template carries both current fence markers', () => {
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes(FENCE_BEGIN), `templates/${f} missing ${FENCE_BEGIN}`);
    assert.ok(text.includes(FENCE_END), `templates/${f} missing ${FENCE_END}`);
    assert.ok(!text.includes('banana:begin v1'), `templates/${f} still carries a v1 marker`);
  }
});

// #10: v2 -> v3 — the npx-always-fresh promise is retired; install-once +
// sync-to-update + skew-surfaced replaces it, and the command roster grows
// `log` and `state lint`.
test('every wiring template Kit bullet: v3 opener, install-once + sync-to-update text, npx-always-fresh promise gone', () => {
  assert.equal(CURRENT_WIRING_VERSION, 3, 'templates/wiring must be bumped to v3 (#10)');
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes('<!-- banana:begin v3 -->'), `templates/${f} missing the v3 fence opener`);
    assert.ok(
      text.includes('npm install -g github:Q9-Ahimsa/banana'),
      `templates/${f} missing the global install command`,
    );
    assert.ok(text.includes('banana sync'), `templates/${f} missing banana sync`);
    assert.ok(
      text.includes('sync · log · state lint'),
      `templates/${f} command roster missing log and state lint`,
    );
    assert.ok(
      !text.includes('npx always fetches the latest kit'),
      `templates/${f} still carries the retired npx-always-fresh promise`,
    );
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

// ADR 0001: the project-STATE header teaches rebuild-on-close, retired rule
// absent. ADR 0005 (#15): the global-STATE header moves from rebuild-whole to
// per-thread edits, retired rule absent there too — both grains now retire
// the same phrase, just to different migration targets.
test('project-STATE.md header teaches rebuild-on-close, retired rule absent', () => {
  const text = readFileSync(join(templatesDir, 'project-STATE.md'), 'utf8');
  assert.ok(
    text.includes('Rebuilt at session close; mid-arc'),
    'project-STATE.md header missing the rebuild-on-close rule'
  );
  assert.ok(
    text.includes('section patches are legal and must carry the dirty-marker line.'),
    'project-STATE.md header missing the dirty-marker requirement'
  );
  assert.ok(
    !RETIRED_HEADER_RE.test(text),
    'project-STATE.md still carries the retired rebuild-whole rule'
  );
});

test('global-STATE.md header moves to per-thread edits, retired rebuild-whole rule absent (ADR 0005)', () => {
  const text = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  assert.ok(
    !RETIRED_HEADER_RE.test(text),
    'global-STATE.md still carries the retired rebuild-whole rule'
  );
  assert.ok(
    text.includes('Edit only your own threads; never rewrite the page.'),
    'global-STATE.md header missing the per-thread-edits rule'
  );
});

// #20 (ADR 0006): line limits, the closed-stamp/expiry convention, and the
// archive pointer all land in the global template's header; the
// Recently-closed placeholder's wording changes to name the new convention.
test('global-STATE.md header teaches the #20 line limits and archive pointer', () => {
  const text = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  assert.ok(
    text.includes('Line limits: thread 400 · backlog 300 · watch 350 · closed 250 chars.'),
    'global-STATE.md header missing the #20 line-limits line'
  );
  assert.ok(
    text.includes('(closed YYYY-MM-DD)') && text.includes('expire after 7 days'),
    'global-STATE.md header missing the closed-stamp expiry rule'
  );
  assert.ok(
    text.includes('a thread idle 30+ days becomes a Backlog line'),
    'global-STATE.md header missing the thread-inactivity rule'
  );
  assert.ok(
    text.includes('banana state archive') && text.includes('STATE-archive.md'),
    'global-STATE.md header missing the archive-move pointer'
  );
});

test('global-STATE.md Recently-closed placeholder names the (closed YYYY-MM-DD) convention (#20)', () => {
  const text = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  assert.ok(
    text.includes('- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)'),
    'global-STATE.md Recently-closed placeholder not updated to the #20 (closed YYYY-MM-DD) wording'
  );
  assert.ok(
    !text.includes('- (last few finished threads, one line each, with pointers)'),
    'global-STATE.md still ships the pre-#20 Recently-closed placeholder text'
  );
});
