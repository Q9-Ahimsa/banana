import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractIdentity, parseSyncArgs, runSync } from '../lib/sync.mjs';
import { CANON_FILES } from '../lib/init.mjs';
import { findFence } from '../lib/fence.mjs';
import { renderWiringTemplate } from '../lib/wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {string} a fresh sandbox home, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function snapshot(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return files;
}

function assertTreesIdentical(a, b) {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'same file set');
  for (const [path, bytes] of a) {
    const other = b.get(path);
    assert.ok(other && other.equals(bytes), `${path} must be byte-identical`);
  }
}

function collectedIo() {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const errLines = [];
  return {
    lines,
    errLines,
    io: {
      out: (/** @type {string} */ line = '') => lines.push(line),
      err: (/** @type {string} */ line = '') => errLines.push(line),
    },
  };
}

// A v1 wiring block as the v1 kit rendered it (abridged body, real identity
// line format) — the upgrade fixture sync must carry to v2.
const V1_BLOCK = `<!-- banana:begin v1 -->
## Continuity protocol (banana)

- **Your agent tag:** \`pi-agent\`. Owner: \`bob smith\`. Write your tag in
  every entry you author — no exceptions.
- **Authority:** \`~/.agents/CONTINUITY.md\` governs all shared surfaces; the
  files are the source of truth, never any agent's private memory.
<!-- banana:end -->`;

const STATE_SENTINEL = '# GLOBAL STATE\n> user-owned; the kit must never rewrite this.\n';

/** Wire the standard upgrade fixture: stale canon + v1-fenced CLAUDE.md + STATE.md. */
function staleFixture(home) {
  const canonDir = join(home, '.agents', 'canon');
  mkdirSync(canonDir, { recursive: true });
  // Stale canon: one outdated file, one missing entirely (STANDARD.md).
  writeFileSync(join(canonDir, 'CONTINUITY.md'), '<!-- banana:canon rev 1.1 -->\nstale\n');
  writeFileSync(
    join(canonDir, 'SESSION-LOG.md'),
    readFileSync(join(KIT_ROOT, 'canon', 'SESSION-LOG.md')),
  );
  writeFileSync(join(home, '.agents', 'STATE.md'), STATE_SENTINEL);
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  writeFileSync(claudeMd, `# My instructions\n\nuser prose above\n\n${V1_BLOCK}\nuser prose below\n`);
  return { canonDir, claudeMd };
}

test('parseSyncArgs accepts no options and rejects any argument', () => {
  assert.deepEqual(parseSyncArgs([]), {});
  assert.throws(() => parseSyncArgs(['--force']), /unknown sync option '--force'/);
});

test('extractIdentity recovers owner and tag from a v1 block', () => {
  assert.deepEqual(extractIdentity(V1_BLOCK), { owner: 'bob smith', tag: 'pi-agent' });
});

test('extractIdentity round-trips the rendered v2 templates', () => {
  for (const template of ['claude-code.md', 'agents-md.md', 'portable-directive.md']) {
    const block = renderWiringTemplate(template, { owner: 'alice', tag: 'claude' });
    assert.deepEqual(
      extractIdentity(block),
      { owner: 'alice', tag: 'claude' },
      `${template} identity must survive a render/extract round-trip`,
    );
  }
});

test('e2e: sync refreshes a stale canon byte-for-byte and upgrades a v1 fence to v2', async (t) => {
  const home = sandbox(t);
  const { canonDir, claudeMd } = staleFixture(home);
  const { io, lines } = collectedIo();

  const result = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(result.code, 0);

  // Canon dir byte-equal to the kit's bundled canon (incl. the missing file).
  assert.deepEqual(readdirSync(canonDir).sort(), [...CANON_FILES].sort());
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(canonDir, name)).equals(readFileSync(join(KIT_ROOT, 'canon', name))),
      `${name} must be byte-equal to the bundled canon`,
    );
  }

  // Fence upgraded in place: v2 block, identity preserved, user content untouched.
  const before = `# My instructions\n\nuser prose above\n\n${V1_BLOCK}\nuser prose below\n`;
  const beforeFence = findFence(before);
  const after = readFileSync(claudeMd, 'utf8');
  const afterFence = findFence(after);
  assert.ok(afterFence !== null && afterFence.version === 2, 'block must read v2 after sync');
  assert.equal(
    after.slice(0, afterFence.start),
    before.slice(0, beforeFence.start),
    'user content above the fence must be byte-identical',
  );
  assert.equal(
    after.slice(afterFence.end),
    before.slice(beforeFence.end),
    'user content below the fence must be byte-identical',
  );
  const block = after.slice(afterFence.start, afterFence.end);
  assert.ok(block.includes('`bob smith`'), 'owner recovered from the v1 block');
  assert.ok(block.includes('`pi-agent`'), 'tag recovered from the v1 block');

  // STATE.md is user-owned: untouched.
  assert.equal(readFileSync(join(home, '.agents', 'STATE.md'), 'utf8'), STATE_SENTINEL);

  // Each change reported.
  const report = lines.join('\n');
  assert.ok(report.includes('CONTINUITY.md'), 'canon refresh reported');
  assert.ok(report.includes('STANDARD.md'), 'canon install reported');
  assert.ok(/v1 -> v2/.test(report), 'fence upgrade reported');
});

test('e2e: a second sync run reports no changes and leaves the tree byte-identical', async (t) => {
  const home = sandbox(t);
  staleFixture(home);
  const first = await runSync(parseSyncArgs([]), { home, io: collectedIo().io });
  assert.equal(first.code, 0);
  const before = snapshot(home);

  const { io, lines } = collectedIo();
  const second = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(second.code, 0);
  assert.ok(lines.join('\n').includes('no changes'), 'second run must report no changes');
  assertTreesIdentical(before, snapshot(home));
});

test('e2e: sync never creates wiring for unwired harnesses', async (t) => {
  const home = sandbox(t);
  // No harness files at all — sync must only install the canon.
  const result = await runSync(parseSyncArgs([]), { home, io: collectedIo().io });
  assert.equal(result.code, 0);
  assert.deepEqual(
    [...snapshot(home).keys()].sort(),
    CANON_FILES.map((name) => join('.agents', 'canon', name)).sort(),
    'only the canon dir may be created',
  );
});

test('e2e: a wired file whose block identity is unrecoverable is skipped, not broken', async (t) => {
  const home = sandbox(t);
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  const content = '<!-- banana:begin v1 -->\nno identity line here\n<!-- banana:end -->\n';
  writeFileSync(claudeMd, content);
  const { io, errLines } = collectedIo();

  const result = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(result.code, 0, 'a skip is not a failure');
  assert.equal(readFileSync(claudeMd, 'utf8'), content, 'unrecoverable file left untouched');
  assert.ok(errLines.join('\n').includes('skipped'), 'skip reported');
});

test('e2e: a corrupt fence (dangling begin marker, no matching end) is skipped, not thrown', async (t) => {
  const home = sandbox(t);
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  const content = '<!-- banana:begin v2 -->\nno end marker here\n';
  writeFileSync(claudeMd, content);
  const { io, errLines } = collectedIo();

  const result = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(result.code, 0, 'a corrupt fence is a skip, not a failure');
  assert.equal(readFileSync(claudeMd, 'utf8'), content, 'corrupt file left byte-identical');
  assert.ok(errLines.join('\n').includes('skipped'), 'skip reported');
});

test('e2e: a file without a banana fence is not touched', async (t) => {
  const home = sandbox(t);
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  writeFileSync(claudeMd, '# Purely user-owned instructions\n');

  const result = await runSync(parseSyncArgs([]), { home, io: collectedIo().io });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(claudeMd, 'utf8'), '# Purely user-owned instructions\n');
});
