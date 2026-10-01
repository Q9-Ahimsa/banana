import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
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
import { CANON_FILES, FILE_ADAPTERS } from '../lib/init.mjs';
import { findFence, fenceBegin } from '../lib/fence.mjs';
import { renderWiringTemplate, wiringTemplateVersion } from '../lib/wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fence version the current claude-code wiring template declares. */
const CURRENT_FENCE = wiringTemplateVersion('claude-code.md');

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
// line format) — the upgrade fixture sync must carry to the current version.
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

test('extractIdentity round-trips the rendered wiring templates', () => {
  for (const template of ['claude-code.md', 'agents-md.md', 'portable-directive.md']) {
    const block = renderWiringTemplate(template, { owner: 'alice', tag: 'claude' });
    assert.deepEqual(
      extractIdentity(block),
      { owner: 'alice', tag: 'claude' },
      `${template} identity must survive a render/extract round-trip`,
    );
  }
});

test('e2e: sync refreshes a stale canon byte-for-byte and upgrades a v1 fence to v3', async (t) => {
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

  // Fence upgraded in place: current-version block, identity preserved, user content untouched.
  const before = `# My instructions\n\nuser prose above\n\n${V1_BLOCK}\nuser prose below\n`;
  const beforeFence = findFence(before);
  const after = readFileSync(claudeMd, 'utf8');
  const afterFence = findFence(after);
  assert.ok(
    afterFence !== null && afterFence.version === CURRENT_FENCE,
    `block must read v${CURRENT_FENCE} after sync`,
  );
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
  assert.ok(report.includes(`v1 -> v${CURRENT_FENCE}`), 'fence upgrade reported');
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

// #10: a real v2-rendered block, as the v2 kit actually produced it (before
// this ticket's Kit-bullet rewrite), for a non-default owner/tag pair — the
// literal upgrade path a machine wired before #10 lands must survive.
const V2_CLAUDE_CODE_BLOCK = `<!-- banana:begin v2 -->
## Continuity bootstrap (banana)

- **Identity:** you are \`alpha\`; owner: \`owner-x\`. Sign every entry
  you author with your tag.
- **Protocol authority:** \`~/.agents/canon/\` — CONTINUITY.md (protocol),
  STANDARD.md (logbook), SESSION-LOG.md (task journal). Every continuity rule
  lives behind this pointer, not in this block; read CONTINUITY.md before your
  first entry on this machine. On conflict, the canon wins.
- **Kit:** \`npx --yes github:Q9-Ahimsa/banana <command>\` — commands: init ·
  project · brief · doctor · sync. npx always fetches the latest kit.
- **Self-setup:** landing in a workspace (git repo or non-code topic dir) with
  no continuity files, initialize it yourself per the canon's agent bootstrap
  section: run \`npx --yes github:Q9-Ahimsa/banana project\` from the workspace
  root.
- **Session ritual:** read \`~/.agents/STATE.md\` first (machine grain — the
  brief does not carry it), then your brief
  (\`npx --yes github:Q9-Ahimsa/banana brief <feature> --tag alpha\`);
  end by closing your log entry with an owned \`NEXT:\`.
<!-- banana:end -->`;

test('e2e (#10): sync upgrades a real v2 block to v3, preserving a non-default owner/tag pair; bytes outside the fence untouched', async (t) => {
  const home = sandbox(t);
  const canonDir = join(home, '.agents', 'canon');
  mkdirSync(canonDir, { recursive: true });
  for (const name of CANON_FILES) {
    writeFileSync(join(canonDir, name), readFileSync(join(KIT_ROOT, 'canon', name)));
  }
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  const before = `# My instructions\n\nuser prose above\n\n${V2_CLAUDE_CODE_BLOCK}\nuser prose below\n`;
  writeFileSync(claudeMd, before);

  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(result.code, 0);

  const beforeFence = findFence(before);
  const after = readFileSync(claudeMd, 'utf8');
  const afterFence = findFence(after);
  assert.ok(
    afterFence !== null && afterFence.version === CURRENT_FENCE,
    `block must read v${CURRENT_FENCE} after sync`,
  );
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
  assert.ok(block.includes('`owner-x`'), 'owner recovered from the v2 block');
  assert.ok(block.includes('`alpha`'), 'tag recovered from the v2 block');
  assert.ok(lines.join('\n').includes(`v2 -> v${CURRENT_FENCE}`), 'fence upgrade reported');

  // A second run is byte-identical and reports no changes (idempotency).
  const snapshotAfterFirst = snapshot(home);
  const { io: io2, lines: lines2 } = collectedIo();
  const second = await runSync(parseSyncArgs([]), { home, io: io2 });
  assert.equal(second.code, 0);
  assert.ok(lines2.join('\n').includes('no changes'), 'second run must report no changes');
  assertTreesIdentical(snapshotAfterFirst, snapshot(home));
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

// -----------------------------------------------------------------------
// #6 A: the kit-update step (fake exec only, never the network) and the
// fresh-read guarantee it exists for.
// -----------------------------------------------------------------------

/** A sandbox kit tree: a copy of the real kit's canon/ + templates/, plus a
 * controlled package.json — a fake exec's "install" mutates THIS tree, never
 * the real repo, so sync's fresh-read behavior can be proven safely. */
function sandboxKitRoot(t, version) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-kitroot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(KIT_ROOT, 'canon'), join(dir, 'canon'), { recursive: true });
  cpSync(join(KIT_ROOT, 'templates'), join(dir, 'templates'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-kit', version }));
  return dir;
}

/** The `name` field a sandbox kitRoot's package.json declares. */
function kitOwnName(kitRoot) {
  return JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')).name;
}

/** A fake `npm root -g` responder: the lookup itself fails (non-zero exit)
 * — the degrade-quietly-to-kitRoot default for tests that aren't
 * exercising S1 themselves. */
function rootLookupFails() {
  return { code: 1, stdout: '', stderr: '' };
}

test('#6 A: deps.exec absent skips the kit-update step silently (today\'s behavior preserved)', async (t) => {
  const home = sandbox(t);
  staleFixture(home);
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io });
  assert.equal(result.code, 0);
  const report = lines.join('\n');
  assert.ok(!report.includes('kit updated'), 'no kit-update line without deps.exec');
  assert.ok(!report.includes('kit current'), 'no kit-update line without deps.exec');
});

test('#6 A: a succeeding exec with a version bump prints "kit updated: vX -> vY"', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const calls = [];
  const exec = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'root') return rootLookupFails();
    writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '1.0.1' }));
    return { code: 0, stdout: '', stderr: '' };
  };
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.deepEqual(calls, [
    { command: 'npm', args: ['root', '-g'] },
    { command: 'npm', args: ['install', '-g', 'github:Q9-Ahimsa/banana'] },
  ]);
  assert.ok(lines.join('\n').includes('kit updated: v1.0.0 -> v1.0.1'));
});

test('#6 A: a succeeding exec with no version change prints "kit current: vX"', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async (command, args) => {
    if (args[0] === 'root') return rootLookupFails();
    return { code: 0, stdout: '', stderr: '' };
  };
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(lines.join('\n').includes('kit current: v1.0.0'));
});

test('#6 A: a failing exec (non-zero exit, no stderr) degrades to a warning naming the exit code; sync still succeeds', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async () => ({ code: 1, stdout: '', stderr: '' });
  const { io, lines, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0, 'a kit-update failure must not fail sync');
  assert.ok(errLines.join('\n').includes('kit update skipped (exit 1) — refreshing from the launched copy'));
  assert.ok(!lines.join('\n').includes('kit updated'), 'no success line on failure');
});

test('#6 A: a failing exec with stderr text names the first non-empty stderr line as the reason', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async () => ({ code: 1, stdout: '', stderr: '\n  npm ERR! network timeout\nmore detail\n' });
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(errLines.join('\n').includes('kit update skipped (npm ERR! network timeout) — refreshing from the launched copy'));
});

test('#6 A: a spawn failure (error field set) names the error message as the reason', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async () => ({ code: null, stdout: '', stderr: '', error: 'ENOENT: npm not found' });
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(errLines.join('\n').includes('kit update skipped (ENOENT: npm not found) — refreshing from the launched copy'));
});

test('#6 A: a failing kit-update still refreshes canon/fences from whatever is already on disk', async (t) => {
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const exec = async () => ({ code: 1, stdout: '', stderr: 'offline\n' });
  const { io } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec });
  assert.equal(result.code, 0);
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(canonDir, name)).equals(readFileSync(join(KIT_ROOT, 'canon', name))),
      `${name} must still refresh to the bundled canon despite the failed kit-update`,
    );
  }
});

test('#6 A (load-bearing): canon and wiring-template reads happen AFTER the update step, proving they are not cached at module load', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');

  // A machine already wired at the CURRENT real template's version, before this run.
  const currentVersion = wiringTemplateVersion('claude-code.md');
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(claudeMd), { recursive: true });
  writeFileSync(claudeMd, renderWiringTemplate('claude-code.md', { owner: 'alice', tag: 'claude' }) + '\n');

  const REWRITTEN_CANON = 'REWRITTEN-CANON-CONTENT\n';
  let installCalls = 0;
  const exec = async (command, args) => {
    if (args[0] === 'root') return rootLookupFails();
    installCalls += 1;
    assert.equal(command, 'npm');
    assert.deepEqual(args, ['install', '-g', 'github:Q9-Ahimsa/banana']);
    // Simulate what a real `npm install -g` would do: overwrite the kit's
    // own on-disk canon + template files with a newer release's content —
    // under the SANDBOX kitRoot, never the real repo.
    writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '1.0.1' }));
    writeFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), REWRITTEN_CANON);
    const templatePath = join(kitRoot, 'templates', 'wiring', 'claude-code.md');
    const bumped = readFileSync(templatePath, 'utf8').replace(
      fenceBegin(currentVersion),
      fenceBegin(currentVersion + 1),
    );
    writeFileSync(templatePath, bumped);
    return { code: 0, stdout: '', stderr: '' };
  };

  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });

  assert.equal(result.code, 0);
  assert.equal(installCalls, 1, 'the install step must run exactly once');

  // Canon: the file installed under home must be the REWRITTEN content, not
  // the pre-update snapshot sandboxKitRoot started with — proves the canon
  // read happened after the update, not at module load or before step 2.
  assert.equal(
    readFileSync(join(home, '.agents', 'canon', 'CONTINUITY.md'), 'utf8'),
    REWRITTEN_CANON,
    'canon read must reflect post-update content',
  );

  // Fence: the wired file must be upgraded to the BUMPED version — proves
  // the wiring-template version read happened after the update too. Moving
  // either read back before the exec call makes this assertion fail: the
  // canon would install the original bundled content instead of
  // REWRITTEN_CANON, and the fence would stay at currentVersion because
  // fence.version >= (unbumped) current would short-circuit the re-fence.
  const after = readFileSync(claudeMd, 'utf8');
  const afterFence = findFence(after);
  assert.ok(
    afterFence !== null && afterFence.version === currentVersion + 1,
    `fence must read v${currentVersion + 1} after sync, got v${afterFence?.version}`,
  );

  const report = lines.join('\n');
  assert.ok(
    report.includes(`v${currentVersion} -> v${currentVersion + 1}`),
    'fence upgrade reported with the freshly-read version',
  );
  assert.ok(report.includes('kit updated: v1.0.0 -> v1.0.1'), 'kit-update step reported');
});

// -----------------------------------------------------------------------
// Review S1: sync must resolve the tree `npm install -g` actually WRITES
// to (the npm global prefix), not blindly assume it's kitRoot (the
// launched tree) — false on the npx cold-bootstrap path, where kitRoot is
// npx's own cache copy, never the global prefix.
// -----------------------------------------------------------------------

// Review F4 (orchestrator ruling): between a kit-shaped install tree and
// the launched tree, the NEWER version wins — a downgrade must never be
// silent. This is the fixture that used to lock in the downgrade: an
// install tree landing at v0.9.9 while the launched tree (kitRoot) is
// already at v1.0.0 must now keep the launched tree's canon, and the
// version line must name both versions as "older".
test('#6 S1 / F4: an install tree OLDER than kitRoot — the launched tree\'s canon wins, and the line names both versions', async (t) => {
  const home = sandbox(t);
  // The LAUNCHED tree (e.g. npx's cache) — the fake exec below never
  // touches this at all, and its canon is deliberately DIFFERENT from the
  // resolved global tree's below, so a regression that reads from the
  // install tree instead of the launched one is guaranteed to fail this
  // assertion, not silently pass because both trees happened to carry the
  // same bytes.
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);
  const LAUNCHED_TREE_CANON = 'LAUNCHED-TREE-CANON (must land in home)\n';
  writeFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), LAUNCHED_TREE_CANON);

  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  const installedDir = join(globalPrefix, own);
  const INSTALLED_TREE_CANON = 'INSTALLED-TREE-CANON (must never land in home)\n';

  let installCalls = 0;
  const exec = async (command, args) => {
    // Review F6: the `\r\n` proves `.trim()` on the `npm root -g` output is
    // load-bearing — dropping it would leave a trailing CRLF baked into
    // every joined path below, and nothing would resolve.
    if (args[0] === 'root') return { code: 0, stdout: `${globalPrefix}\r\n`, stderr: '' };
    installCalls += 1;
    // A real release lands at globalPrefix/<own> — never at kitRoot — but
    // this one is OLDER than the launched tree.
    cpSync(join(KIT_ROOT, 'canon'), join(installedDir, 'canon'), { recursive: true });
    cpSync(join(KIT_ROOT, 'templates'), join(installedDir, 'templates'), { recursive: true });
    writeFileSync(join(installedDir, 'canon', 'CONTINUITY.md'), INSTALLED_TREE_CANON);
    writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '0.9.9' }));
    return { code: 0, stdout: '', stderr: '' };
  };

  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });

  assert.equal(result.code, 0, 'an older install tree is not a failure');
  assert.equal(installCalls, 1);
  assert.ok(
    lines.join('\n').includes("kit: the installed copy is v0.9.9, older than this run's v1.0.0 — refreshing from v1.0.0"),
    `the line must name both versions, got: ${lines.join('\n')}`,
  );

  assert.equal(
    readFileSync(join(home, '.agents', 'canon', 'CONTINUITY.md'), 'utf8'),
    LAUNCHED_TREE_CANON,
    'canon must come from the launched (newer) tree, never the older install tree',
  );
  // kitRoot's own canon/package.json were never touched by the fake exec.
  assert.equal(readFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), 'utf8'), LAUNCHED_TREE_CANON);
  assert.equal(
    JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')).version,
    '1.0.0',
    'the launched tree (npx cache) must be untouched by a global install elsewhere',
  );
});

// Review F4: the mirror case — a REAL, distinct install tree (proving S1's
// tree-resolution concern still holds) that is NEWER than the launched
// tree, with nothing installed there before this run. Both "install canon
// wins" and "kit installed" fire from the same fixture: before is null
// (nothing at installRoot yet), after is newer than the launched tree.
test('#6 S1 / F4: a first-ever install landing NEWER than kitRoot — install canon wins, and the line says "kit installed"', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);
  const LAUNCHED_TREE_CANON = 'LAUNCHED-TREE-CANON (must never land in home)\n';
  writeFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), LAUNCHED_TREE_CANON);

  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  const installedDir = join(globalPrefix, own);
  const INSTALLED_TREE_CANON = 'INSTALLED-TREE-CANON (must land in home)\n';
  // Nothing installed globally yet — this is a genuine first-ever install.

  let installCalls = 0;
  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix, stderr: '' };
    installCalls += 1;
    cpSync(join(KIT_ROOT, 'canon'), join(installedDir, 'canon'), { recursive: true });
    cpSync(join(KIT_ROOT, 'templates'), join(installedDir, 'templates'), { recursive: true });
    writeFileSync(join(installedDir, 'canon', 'CONTINUITY.md'), INSTALLED_TREE_CANON);
    writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '1.5.0' }));
    return { code: 0, stdout: '', stderr: '' };
  };

  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });

  assert.equal(result.code, 0);
  assert.equal(installCalls, 1);
  assert.ok(lines.join('\n').includes('kit installed: v1.5.0'), `expected "kit installed: v1.5.0", got: ${lines.join('\n')}`);

  assert.equal(
    readFileSync(join(home, '.agents', 'canon', 'CONTINUITY.md'), 'utf8'),
    INSTALLED_TREE_CANON,
    'canon must come from the resolved GLOBAL install tree, not the launched kitRoot',
  );
  for (const name of CANON_FILES) {
    if (name === 'CONTINUITY.md') continue;
    assert.ok(
      readFileSync(join(home, '.agents', 'canon', name)).equals(readFileSync(join(installedDir, 'canon', name))),
      `${name} must come from the resolved GLOBAL install tree too`,
    );
  }
  assert.equal(readFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), 'utf8'), LAUNCHED_TREE_CANON);
});

// Review F4: an install tree that is genuinely newer than a PRIOR install
// (not a first-ever install) still wins, and reports "kit updated".
test('#6 F4: an install tree newer than both its own prior version and kitRoot wins, reporting "kit updated"', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);

  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  const installedDir = join(globalPrefix, own);
  // A previous install already sits here, older than both kitRoot and the
  // version this run's `npm install -g` will bump it to.
  cpSync(join(KIT_ROOT, 'canon'), join(installedDir, 'canon'), { recursive: true });
  cpSync(join(KIT_ROOT, 'templates'), join(installedDir, 'templates'), { recursive: true });
  writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '0.9.0' }));
  const UPDATED_TREE_CANON = 'UPDATED-TREE-CANON (must land in home)\n';

  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix, stderr: '' };
    writeFileSync(join(installedDir, 'canon', 'CONTINUITY.md'), UPDATED_TREE_CANON);
    writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '2.0.0' }));
    return { code: 0, stdout: '', stderr: '' };
  };

  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });

  assert.equal(result.code, 0);
  assert.ok(lines.join('\n').includes('kit updated: v0.9.0 -> v2.0.0'), `got: ${lines.join('\n')}`);
  assert.equal(readFileSync(join(home, '.agents', 'canon', 'CONTINUITY.md'), 'utf8'), UPDATED_TREE_CANON);
});

// Review F4: a resolved install path that exists but is NOT kit-shaped
// (e.g. a partial/corrupt install, or something unrelated occupying that
// path) must fall back to the launched tree, exit 0, and say so — never
// an exit-1 ENOENT crash reading a missing canon/templates dir.
test('#6 F4: a non-kit-shaped install tree falls back to the launched tree, exit 0, one-line notice', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);

  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  const installedDir = join(globalPrefix, own);

  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix, stderr: '' };
    // A broken/partial install: package.json present (and a HIGH version,
    // so a version-only comparison would wrongly prefer it), but no
    // canon/ or templates/wiring/ — not kit-shaped.
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '9.9.9' }));
    return { code: 0, stdout: '', stderr: '' };
  };

  const { io, lines, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });

  assert.equal(result.code, 0, 'a non-kit-shaped install tree must not fail the exit code');
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(home, '.agents', 'canon', name)).equals(readFileSync(join(kitRoot, 'canon', name))),
      `${name} must fall back to the launched tree`,
    );
  }
  assert.ok(
    [...lines, ...errLines].join('\n').includes('not kit-shaped'),
    'the fallback must be reported in one line',
  );
});

test('#6 S1: the root lookup failing degrades quietly to kitRoot — no crash, today\'s behavior', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 1, stdout: '', stderr: 'npm ERR! no global prefix\n' };
    writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '1.0.1' }));
    return { code: 0, stdout: '', stderr: '' };
  };
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(lines.join('\n').includes('kit updated: v1.0.0 -> v1.0.1'), 'falls back to kitRoot cleanly');
});

// -----------------------------------------------------------------------
// Review S2 (sync side): a TIMED-OUT update skips the refresh only when the
// tree it would refresh from is the SAME tree the interrupted update was
// writing into (it may be half-written) — any other failure, including a
// timeout on a DIFFERENT tree, still refreshes as the ticket requires.
// -----------------------------------------------------------------------

test('#6 S2: a timed-out update on the global path (resolved root === kitRoot) skips the refresh, warns half-installed, exits 0', async (t) => {
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const exec = async (command, args) => {
    if (args[0] === 'root') return rootLookupFails();
    return { code: null, stdout: '', stderr: '', error: 'timed out after 120000ms' };
  };
  const { io, lines, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec });
  assert.equal(result.code, 0);
  assert.ok(
    errLines.join('\n').includes('kit update timed out — the kit may be half-installed; re-run banana sync'),
  );
  assert.ok(!lines.join('\n').includes('sync:'), 'the refresh must be skipped entirely, no change-count summary');
  assert.equal(
    readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'),
    '<!-- banana:canon rev 1.1 -->\nstale\n',
    'canon must be left exactly as the stale fixture — never read from a possibly half-written tree',
  );
});

test('#6 S2: a timed-out update on the npx path (resolved root differs from kitRoot) still refreshes safely', async (t) => {
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);
  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  const installedDir = join(globalPrefix, own);
  // A PREVIOUS successful install already sits at installedDir, distinct
  // from kitRoot — so the timeout below lands on a tree we are NOT about
  // to refresh from.
  cpSync(join(KIT_ROOT, 'canon'), join(installedDir, 'canon'), { recursive: true });
  cpSync(join(KIT_ROOT, 'templates'), join(installedDir, 'templates'), { recursive: true });
  writeFileSync(join(installedDir, 'package.json'), JSON.stringify({ name: own, version: '0.9.0' }));

  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix, stderr: '' };
    return { code: null, stdout: '', stderr: '', error: 'timed out after 120000ms' };
  };
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(
    !errLines.join('\n').includes('half-installed'),
    'a timeout on a DIFFERENT tree than the refresh source must not trigger the half-installed warning',
  );
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(canonDir, name)).equals(readFileSync(join(KIT_ROOT, 'canon', name))),
      `${name} must still refresh from kitRoot (untouched by the timeout elsewhere)`,
    );
  }
});

test('#6 S2: every OTHER failure (non-timeout) still refreshes, even when resolved root === kitRoot (regression guard)', async (t) => {
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const exec = async (command, args) => {
    if (args[0] === 'root') return rootLookupFails();
    return { code: 1, stdout: '', stderr: 'offline\n' };
  };
  const { io } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec });
  assert.equal(result.code, 0);
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(canonDir, name)).equals(readFileSync(join(KIT_ROOT, 'canon', name))),
      `${name} must still refresh — a plain non-zero exit is not a timeout`,
    );
  }
});

// -----------------------------------------------------------------------
// Review F1 + F7: the timeout guard keys on the install TARGET, with path
// identity normalized — "the resolved root fell back to kitRoot" is NOT
// the same thing as "the resolved root IS the global path". On the npx
// cold-bootstrap path (nothing installed yet), a timeout must still
// refresh safely from kitRoot, never skip the whole run.
// -----------------------------------------------------------------------

test('#6 F1: npx cold-bootstrap (installRoot resolves, nothing installed yet) timing out still refreshes from kitRoot', async (t) => {
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));
  // installRoot resolves to a REAL, DIFFERENT path than kitRoot — but
  // nothing is installed there yet (no package.json), same as the npx
  // cold-bootstrap case. The old bug: `readKitVersion(installRoot)` being
  // null there made the resolved root fall back to kitRoot, which then
  // got mistaken for "the global path" and skipped the whole refresh.
  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix, stderr: '' };
    return { code: null, stdout: '', stderr: '', error: 'timed out after 120000ms' };
  };
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(
    !errLines.join('\n').includes('half-installed'),
    'installRoot resolved to a DIFFERENT path than kitRoot — the timeout there must not block refreshing the stable, untouched kitRoot',
  );
  for (const name of CANON_FILES) {
    assert.ok(
      readFileSync(join(canonDir, name)).equals(readFileSync(join(kitRoot, 'canon', name))),
      `${name} must refresh from kitRoot despite the timeout`,
    );
  }
});

test('#6 F1: the install root spelled with a different drive-letter case still counts as kitRoot — a timeout there warns half-installed', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('drive-letter case-folding is a win32-only concern');
    return;
  }
  const home = sandbox(t);
  const { canonDir } = staleFixture(home);
  const globalPrefix = mkdtempSync(join(tmpdir(), 'banana-globalprefix-'));
  const own = 'fixture-kit';
  const kitRoot = join(globalPrefix, own);
  mkdirSync(kitRoot, { recursive: true });
  cpSync(join(KIT_ROOT, 'canon'), join(kitRoot, 'canon'), { recursive: true });
  cpSync(join(KIT_ROOT, 'templates'), join(kitRoot, 'templates'), { recursive: true });
  writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: own, version: '1.0.0' }));
  t.after(() => rmSync(globalPrefix, { recursive: true, force: true }));

  // Same physical location as kitRoot's parent, spelled with every letter's
  // case flipped — win32 filesystems are case-insensitive, so this must
  // still resolve to the SAME install target as kitRoot.
  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: globalPrefix.toUpperCase(), stderr: '' };
    return { code: null, stdout: '', stderr: '', error: 'timed out after 120000ms' };
  };
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(
    errLines.join('\n').includes('kit update timed out — the kit may be half-installed; re-run banana sync'),
    'a different-case spelling of the SAME path must still count as the global path',
  );
  assert.equal(
    readFileSync(join(canonDir, 'CONTINUITY.md'), 'utf8'),
    '<!-- banana:canon rev 1.1 -->\nstale\n',
    'the refresh must be skipped — canon left exactly as the stale fixture',
  );
});

// -----------------------------------------------------------------------
// Review F2: only an ABSOLUTE `npm root -g` output is ever trusted. Empty
// stdout joined with `own` is a RELATIVE path, resolved against cwd by
// every fs read that follows — a kit-shaped directory that happens to sit
// in the working directory must never be picked up as the install root.
// -----------------------------------------------------------------------

test('#6 F2: npm root -g succeeding with EMPTY stdout is never trusted — a kit-shaped dir planted in cwd is not used', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const own = kitOwnName(kitRoot);

  // A kit-shaped directory named exactly `own`, planted in a throwaway
  // cwd — `join('', own)` would resolve to this RELATIVE path if empty
  // stdout were ever trusted (the F2 bug).
  const fakeCwd = mkdtempSync(join(tmpdir(), 'banana-cwd-'));
  const plantedDir = join(fakeCwd, own);
  cpSync(join(KIT_ROOT, 'canon'), join(plantedDir, 'canon'), { recursive: true });
  cpSync(join(KIT_ROOT, 'templates'), join(plantedDir, 'templates'), { recursive: true });
  writeFileSync(join(plantedDir, 'canon', 'CONTINUITY.md'), 'PLANTED-CWD-CANON (must never land in home)\n');
  writeFileSync(join(plantedDir, 'package.json'), JSON.stringify({ name: own, version: '9.9.9' }));

  const previousCwd = process.cwd();
  process.chdir(fakeCwd);
  // Restore cwd BEFORE removing it — Windows refuses to delete a directory
  // that is still any process's current working directory (EPERM), so
  // these two must run in this order, in the SAME hook.
  t.after(() => {
    process.chdir(previousCwd);
    rmSync(fakeCwd, { recursive: true, force: true });
  });

  const exec = async (command, args) => {
    if (args[0] === 'root') return { code: 0, stdout: '', stderr: '' };
    writeFileSync(join(kitRoot, 'package.json'), JSON.stringify({ name: own, version: '1.0.1' }));
    return { code: 0, stdout: '', stderr: '' };
  };
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  assert.ok(
    lines.join('\n').includes('kit updated: v1.0.0 -> v1.0.1'),
    'empty stdout must fall back to kitRoot, never a relative path resolved against cwd',
  );
  assert.equal(
    readFileSync(join(home, '.agents', 'canon', 'CONTINUITY.md'), 'utf8'),
    readFileSync(join(kitRoot, 'canon', 'CONTINUITY.md'), 'utf8'),
    'canon must come from kitRoot, never the planted cwd dir',
  );
});

// -----------------------------------------------------------------------
// Review N12 / N13: formatting and defensive-guard edge cases.
// -----------------------------------------------------------------------

test('#6 N12: a null before/after version prints "unknown", never the literal "vnull"', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  // Malformed package.json at kitRoot: readKitName and readKitVersion both
  // return null for it, so before/after both resolve to null too.
  writeFileSync(join(kitRoot, 'package.json'), '{ not valid json');
  const exec = async () => ({ code: 0, stdout: '', stderr: '' });
  const { io, lines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0);
  const report = lines.join('\n');
  assert.ok(!report.includes('vnull'), 'must never print the literal "vnull"');
  assert.ok(report.includes('kit current: unknown'), `must print "unknown", got: ${report}`);
});

test('#6 N13: an injected exec resolving stdout/stderr as undefined must not crash sync', async (t) => {
  const home = sandbox(t);
  const kitRoot = sandboxKitRoot(t, '1.0.0');
  const exec = async () => ({ code: 1, stdout: undefined, stderr: undefined });
  const { io, errLines } = collectedIo();
  const result = await runSync(parseSyncArgs([]), { home, io, exec, kitRoot });
  assert.equal(result.code, 0, 'an exec result with undefined stdout/stderr must not crash/fail sync');
  assert.ok(errLines.join('\n').includes('kit update skipped (exit 1)'));
});

// -----------------------------------------------------------------------
// #6 C (review N9): invariant — sync never touches anything outside its
// known write set (the canon files it owns, plus the 3 wired adapter
// targets), with a succeeding exec, a failing exec, or no exec at all.
// Reuses this file's own snapshot()/assertTreesIdentical helpers (not a
// hand-picked sentinel list) so any unexpected write anywhere in the home
// tree fails the test, not just at paths we thought to name.
// -----------------------------------------------------------------------

const KNOWN_WRITE_SET = new Set([
  ...CANON_FILES.map((name) => join('.agents', 'canon', name)),
  ...FILE_ADAPTERS.map((adapter) => adapter.describe().target),
]);

/** @param {Map<string, Buffer>} snapshotMap @returns {Map<string, Buffer>} */
function omitKnownWriteSet(snapshotMap) {
  const filtered = new Map();
  for (const [path, bytes] of snapshotMap) {
    if (!KNOWN_WRITE_SET.has(path)) filtered.set(path, bytes);
  }
  return filtered;
}

/** Stale canon only (no wiring) — wireAllAdaptersStale below covers all 3
 * adapter targets, including claude-code, separately. */
function staleCanonOnly(home) {
  const canonDir = join(home, '.agents', 'canon');
  mkdirSync(canonDir, { recursive: true });
  writeFileSync(join(canonDir, 'CONTINUITY.md'), '<!-- banana:canon rev 1.1 -->\nstale\n');
  writeFileSync(join(canonDir, 'SESSION-LOG.md'), readFileSync(join(KIT_ROOT, 'canon', 'SESSION-LOG.md')));
  return canonDir;
}

/** Wire all 3 file adapters at a stale (current - 1) version, with real,
 * recoverable identity, so sync's fence-refresh loop has real work to do
 * on each of the three known-write-set targets. */
function wireAllAdaptersStale(home) {
  for (const adapter of FILE_ADAPTERS) {
    const spec = adapter.describe();
    const current = wiringTemplateVersion(spec.template);
    const rendered = renderWiringTemplate(spec.template, { owner: 'alice', tag: `agent-${adapter.id}` });
    const stale = rendered.replace(fenceBegin(current), fenceBegin(current - 1));
    const target = join(home, spec.target);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `# ${adapter.id} instructions\n\nuser prose above\n\n${stale}\nuser prose below\n`);
  }
}

const SENTINEL_MARK = 'user-owned; must never be touched by sync\n';

/** Plant sentinels genuinely adjacent to what sync writes: siblings inside
 * each of the 3 wired adapter dirs (including the explicitly-named
 * .claude/session.log), plus the home-root/.agents siblings of the canon
 * dir sync also writes into. No project-dir sentinels — sync never even
 * looks outside home, so a path there can never fail (review N9). */
function plantUserOwnedSentinels(home) {
  const paths = [
    join(home, 'STATE.md'),
    join(home, 'LOGBOOK.md'),
    join(home, '.agents', 'session.log'),
    join(home, '.agents', 'STATE.md'),
    join(home, '.claude', 'session.log'),
    join(home, '.claude', 'settings.json'),
    join(home, '.pi', 'notes.md'),
    join(home, '.codex', 'config.json'),
  ];
  for (const p of paths) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${SENTINEL_MARK}${p}\n`);
  }
  return paths;
}

/** @type {{ label: string, exec?: (command: string, args?: string[]) => Promise<import('../lib/proc.mjs').ExecResult> }[]} */
const SECTION_C_CASES = [
  { label: 'a succeeding exec', exec: async () => ({ code: 0, stdout: '', stderr: '' }) },
  { label: 'a failing exec', exec: async () => ({ code: 1, stdout: '', stderr: 'offline\n' }) },
  { label: 'no exec at all' },
];

for (const { label, exec } of SECTION_C_CASES) {
  test(`#6 C: everything outside the known write set stays byte-identical through sync, with ${label}`, async (t) => {
    const home = sandbox(t);
    staleCanonOnly(home);
    wireAllAdaptersStale(home);
    plantUserOwnedSentinels(home);
    const before = snapshot(home);

    const { io } = collectedIo();
    const deps = exec === undefined ? { home, io } : { home, io, exec };
    const result = await runSync(parseSyncArgs([]), deps);

    assert.equal(result.code, 0);
    assertTreesIdentical(omitKnownWriteSet(before), omitKnownWriteSet(snapshot(home)));
  });
}
