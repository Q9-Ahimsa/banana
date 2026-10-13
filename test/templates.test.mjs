import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { COMMANDS } from '../lib/commands.mjs';
import { RETIRED_HEADER_RE, STATE_VERBS } from '../lib/state.mjs';
import { extractIdentity, fenceBegin, findFence, toLf } from '../lib/fence.mjs';
import { renderWiringTemplate, wiringTemplateVersion } from '../lib/wiring.mjs';

const flat = (text) => text.replace(/\s+/g, ' ');

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
    const openers = text.match(/<!-- banana:begin v\d+ -->/g) ?? [];
    assert.deepEqual(openers, [FENCE_BEGIN], `templates/${f} must carry exactly the current opener`);
  }
});

// #24, #25: v3 -> v4 — the roster spells out `state archive`, and each block
// names the command that refreshes it.
test('every wiring template Kit bullet: v4 opener, install-once + sync-to-update text, npx-always-fresh promise gone', () => {
  assert.equal(CURRENT_WIRING_VERSION, 4, 'templates/wiring must be bumped to v4 (#24, #25)');
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    assert.ok(text.includes('<!-- banana:begin v4 -->'), `templates/${f} missing the v4 fence opener`);
    assert.ok(
      text.includes('npm install -g github:Q9-Ahimsa/banana'),
      `templates/${f} missing the global install command`,
    );
    assert.ok(
      flat(text).includes('then `banana sync` updates the kit'),
      `templates/${f} missing the sync-to-update text`,
    );
    assert.ok(
      !text.includes('npx always fetches the latest kit'),
      `templates/${f} still carries the retired npx-always-fresh promise`,
    );
  }
});

test('every wiring template roster lists every CLI command, state spelled out per verb (#24)', () => {
  const expected = COMMANDS.flatMap((c) => (c === 'state' ? STATE_VERBS.map((v) => `state ${v}`) : [c]));
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    const roster = /\(commands: ([^)]*)\)/.exec(flat(text))?.[1];
    assert.ok(roster !== undefined, `templates/${f} has no command roster`);
    assert.deepEqual(roster.split(' · '), expected, `templates/${f} roster`);
  }
});

test('each wiring template names the command that refreshes its block (#25)', () => {
  const read = (f) => flat(readFileSync(join(templatesDir, 'wiring', f), 'utf8'));
  const agents = read('agents-md.md');
  const claude = read('claude-code.md');
  const portable = read('portable-directive.md');
  assert.ok(
    agents.includes(
      'then `banana sync` updates the kit and refreshes the blocks in home instruction files, and `banana project`, run in a workspace, refreshes its AGENTS.md block.',
    ),
  );
  assert.ok(claude.includes('then `banana sync` updates the kit and refreshes this block.'));
  assert.ok(
    portable.includes(
      'then `banana sync` updates the kit. To refresh this block, re-run `banana init` and use the copy it prints.',
    ),
  );
  assert.ok(!agents.includes('refreshes this block'), 'agents-md.md is installed in many places');
  assert.ok(!portable.includes('refreshes this block'), 'portable-directive.md is only printed');
});

test('every wiring template line is 78 characters or fewer', () => {
  for (const f of WIRING_FILES) {
    const text = readFileSync(join(templatesDir, f), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      assert.ok([...line].length <= 78, `templates/${f} line over 78 chars: ${line}`);
    }
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

// #20b/#20c review (K4): the header's limits/expiry/archive block names the
// one-line rule, the four per-section limits, the closed stamp +
// reference-date framing, the never-delete archive pointer, and #20c E6's
// secret exception. The header DOES carry the day thresholds (8+/31+) as
// quick numbers; what it does NOT carry is the exact comparison direction
// or the reference-date definition — those stay in the canon's Global-grain
// body (see test/canon.test.mjs). The old backwards-expiry wording ("expire
// after 7 days", "idle 30+ days") must be gone.
//
// v1.8 (ADR 0007): the block is five lines, each <=100 chars — the waiting-form
// cap, the 8+/15+/22+ thresholds and the watch date, the secret exception, and
// the duty to archive flagged lines before adding one.
test('global-STATE.md header teaches the v1.8 limits, thresholds, watch date, secret exception, and archive duty', () => {
  const text = readFileSync(join(templatesDir, 'global-STATE.md'), 'utf8');
  const HEADER_LINES = [
    '> One line per bullet: thread 400 (waiting form 160) · backlog 300 · watch 350 · closed 250 chars.',
    '> Against the newest (as of)/(closed) stamp: closed lines expire at 8+ days, threads idle 15+ days',
    '> and backlog lines (queued …) 22+ days leave; a due watch (validate-by: …) is re-dated, not moved.',
    '> Never delete a line — except a pasted secret, deleted outright. Before adding a line, any session',
    '> archives the lines lint flags to leave (`banana state archive`), keeping them in STATE-archive.md.',
  ];
  for (const line of HEADER_LINES) {
    assert.ok(line.length <= 100, `header line exceeds 100 chars (${line.length}): "${line}"`);
    assert.ok(text.includes(line), `global-STATE.md header missing line: "${line}"`);
  }
  assert.ok(
    !text.includes('expire after 7 days') &&
      !text.includes('idle 30+ days') &&
      !text.includes('31+ days') &&
      !text.includes('move to Backlog'),
    'global-STATE.md header still carries the v1.7 or #20b expiry/inactivity wording'
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

test("the repo's own AGENTS.md block is exactly what banana project renders today (C10)", () => {
  const text = toLf(readFileSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url)), 'utf8'));
  const fence = findFence(text);
  assert.ok(fence, 'AGENTS.md carries a banana fence');
  const block = text.slice(fence.start, fence.end);
  const { owner, tag } = extractIdentity(block);
  assert.ok(owner && tag, 'the block carries a readable identity');
  // findFence's end offset stops right after the end marker; the render has no trailing newline.
  assert.equal(block, renderWiringTemplate('agents-md.md', { owner, tag }));
});

test('docs/DESIGN.md states the current wiring fence version', () => {
  const design = readFileSync(fileURLToPath(new URL('../docs/DESIGN.md', import.meta.url)), 'utf8');
  assert.ok(
    flat(design).includes(`is currently fenced at \`v${CURRENT_WIRING_VERSION}\``),
    `docs/DESIGN.md must say the wiring templates are fenced at v${CURRENT_WIRING_VERSION}`,
  );
});

test('docs/DESIGN.md intro says sync propagates home wiring changes (#26)', () => {
  const design = readFileSync(fileURLToPath(new URL('../docs/DESIGN.md', import.meta.url)), 'utf8');
  assert.ok(
    flat(design).includes('`sync` (propagates upstream canon and home wiring changes)'),
    'the DESIGN intro names home wiring, not wiring in general',
  );
});
