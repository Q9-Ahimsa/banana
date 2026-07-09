import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
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

import { CANON_FILES, parseInitArgs, runInit } from '../lib/init.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Empty PATH so detection can never leak in from the real machine.
const NO_PATH = { PATH: '', PATHEXT: '' };

/** @returns {string} a fresh sandbox home, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Snapshot every file under root: relative path -> content bytes.
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
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

/**
 * @param {Map<string, Buffer>} a
 * @param {Map<string, Buffer>} b
 */
function assertTreesIdentical(a, b) {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'same file set');
  for (const [path, bytes] of a) {
    const other = b.get(path);
    assert.ok(other && other.equals(bytes), `${path} must be byte-identical`);
  }
}

/**
 * Scripted IO: canned prompt answers, captured output.
 * @param {string[]} [answers]
 */
function scriptedIo(answers = []) {
  const queue = [...answers];
  /** @type {string[]} */
  const lines = [];
  return {
    lines,
    prompts: () => answers.length - queue.length,
    io: {
      out: (line = '') => lines.push(line),
      prompt: async (/** @type {string} */ question) => {
        if (queue.length === 0) throw new Error(`unexpected prompt: ${question}`);
        return /** @type {string} */ (queue.shift());
      },
    },
  };
}

test('parseInitArgs: parses every documented flag', () => {
  const flags = parseInitArgs([
    '--owner', 'alice', '--tag', 'buddy', '--harnesses', 'claude-code, codex', '--yes', '--deliver',
  ]);
  assert.deepEqual(flags, {
    owner: 'alice',
    tag: 'buddy',
    harnesses: ['claude-code', 'codex'],
    yes: true,
    deliver: true,
  });
});

test('parseInitArgs: rejects unknown options and missing values', () => {
  assert.throws(() => parseInitArgs(['--bogus']), /unknown init option/);
  assert.throws(() => parseInitArgs(['--owner']), /requires a value/);
});

test('e2e: fresh init installs the canon dir and STATE.md plus wiring for detected harnesses', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  mkdirSync(join(home, '.codex'));
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.selected, ['claude-code', 'codex']);

  for (const name of CANON_FILES) {
    const target = join(home, '.agents', 'canon', name);
    assert.ok(existsSync(target), `canon/${name} installed`);
    assert.ok(
      readFileSync(target).equals(readFileSync(join(KIT_ROOT, 'canon', name))),
      `canon/${name} is the bundled canon byte-for-byte`,
    );
    assert.ok(
      readFileSync(target, 'utf8').includes('<!-- banana:canon rev '),
      `canon/${name} carries a version marker`,
    );
  }
  assert.ok(
    !existsSync(join(home, '.agents', 'CONTINUITY.md')),
    'legacy .agents/CONTINUITY.md is no longer written',
  );

  const state = readFileSync(join(home, '.agents', 'STATE.md'), 'utf8');
  assert.ok(state.includes('alice'), 'owner substituted into STATE.md');
  assert.ok(!state.includes('__OWNER__'), 'no placeholder residue in STATE.md');

  for (const target of [join('.claude', 'CLAUDE.md'), join('.codex', 'AGENTS.md')]) {
    const text = readFileSync(join(home, target), 'utf8');
    assert.ok(text.includes('<!-- banana:begin v2 -->'), `${target} carries the fence`);
    assert.ok(text.includes('<!-- banana:end -->'), `${target} fence closed`);
  }
  assert.ok(!existsSync(join(home, '.pi')), 'undetected pi is not wired');

  const output = lines.join('\n');
  assert.ok(output.includes('pi — re-run init after installing'), 'paste instructions name pi');
  assert.ok(output.includes('Other tools (no adapter)'), 'manual-only paste path printed');
});

test('e2e: a second init run exits 0 with a byte-identical tree', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  mkdirSync(join(home, '.pi'));
  const flags = parseInitArgs(['--owner', 'alice', '--yes']);
  const first = await runInit(flags, { home, env: NO_PATH, io: scriptedIo().io });
  assert.equal(first.code, 0);
  const before = snapshot(home);

  const second = await runInit(flags, { home, env: NO_PATH, io: scriptedIo().io });
  assert.equal(second.code, 0);
  assertTreesIdentical(before, snapshot(home));
});

test('e2e: init never overwrites an existing STATE.md or legacy CONTINUITY.md', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'STATE.md'), '# my living state\n');
  writeFileSync(join(home, '.agents', 'CONTINUITY.md'), '# my edited protocol\n');
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io: scriptedIo().io,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    result.created,
    CANON_FILES.map((name) => join(home, '.agents', 'canon', name)),
    'only the canon files are created; user surfaces untouched',
  );
  assert.equal(readFileSync(join(home, '.agents', 'STATE.md'), 'utf8'), '# my living state\n');
  assert.equal(readFileSync(join(home, '.agents', 'CONTINUITY.md'), 'utf8'), '# my edited protocol\n');
});

test('e2e: a stale canon file is refreshed to the bundled canon', async (t) => {
  const home = sandbox(t);
  const canonDir = join(home, '.agents', 'canon');
  mkdirSync(canonDir, { recursive: true });
  writeFileSync(join(canonDir, 'CONTINUITY.md'), '<!-- banana:canon rev 1.1 -->\nstale\n');
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io,
  });
  assert.equal(result.code, 0);
  assert.ok(
    readFileSync(join(canonDir, 'CONTINUITY.md'))
      .equals(readFileSync(join(KIT_ROOT, 'canon', 'CONTINUITY.md'))),
    'stale canon file refreshed byte-for-byte',
  );
  assert.ok(lines.join('\n').includes('refreshed '), 'refresh reported');
});

test('e2e: zero-flag non-TTY init succeeds with a git-config owner', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const { io, prompts, lines } = scriptedIo();
  const result = await runInit(parseInitArgs([]), {
    home,
    env: NO_PATH,
    io,
    gitUserName: () => 'Git Alice',
  });
  assert.equal(result.code, 0);
  assert.equal(prompts(), 0, 'no prompts off a TTY');
  assert.ok(lines.join('\n').includes('Git Alice (from git config user.name)'), 'inference reported');
  const state = readFileSync(join(home, '.agents', 'STATE.md'), 'utf8');
  assert.ok(state.includes('Git Alice'), 'git-config owner substituted into STATE.md');
});

test('e2e: --owner beats the git-config inference', async (t) => {
  const home = sandbox(t);
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io: scriptedIo().io,
    gitUserName: () => 'Git Alice',
  });
  assert.equal(result.code, 0);
  const state = readFileSync(join(home, '.agents', 'STATE.md'), 'utf8');
  assert.ok(state.includes('alice'), 'flag owner wins');
  assert.ok(!state.includes('Git Alice'), 'git-config owner not used');
});

test('e2e: non-TTY init with no inferable owner exits 1 naming --owner and --yes', async (t) => {
  const home = sandbox(t);
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs([]), { home, env: NO_PATH, io });
  assert.equal(result.code, 1);
  const output = lines.join('\n');
  assert.ok(output.includes('--owner'), 'failure names --owner');
  assert.ok(output.includes('--yes'), 'failure names --yes');
  assert.ok(output.includes('npx --yes github:Q9-Ahimsa/banana init'), 'exact non-interactive invocation printed');
  assert.ok(!existsSync(join(home, '.agents')), 'no global files written');
});

test('e2e: interactive fallback uses at most 3 prompts and wires the detected set', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const { io, prompts } = scriptedIo(['alice', '', 'y']);
  const result = await runInit(parseInitArgs([]), { home, env: NO_PATH, io, isTTY: true });
  assert.equal(result.code, 0);
  assert.equal(prompts(), 3, 'owner, harness confirm, write-plan confirm');
  assert.deepEqual(result.selected, ['claude-code']);
  const text = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.ok(text.includes('`alice`'), 'prompted owner substituted');
});

test('e2e: interactive init skips the owner prompt when git config knows the owner', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const { io, prompts } = scriptedIo(['', 'y']);
  const result = await runInit(parseInitArgs([]), {
    home,
    env: NO_PATH,
    io,
    isTTY: true,
    gitUserName: () => 'Git Alice',
  });
  assert.equal(result.code, 0);
  assert.equal(prompts(), 2, 'harness confirm + write-plan confirm only');
  const state = readFileSync(join(home, '.agents', 'STATE.md'), 'utf8');
  assert.ok(state.includes('Git Alice'), 'inferred owner substituted');
});

test('e2e: declining the write plan aborts without writing anything', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const before = snapshot(home);
  const { io } = scriptedIo(['alice', '', 'n']);
  const result = await runInit(parseInitArgs([]), { home, env: NO_PATH, io, isTTY: true });
  assert.equal(result.code, 1);
  assertTreesIdentical(before, snapshot(home));
});

test('e2e: --yes without --owner and no git owner fails without writing anything', async (t) => {
  const home = sandbox(t);
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs(['--yes']), { home, env: NO_PATH, io, isTTY: true });
  assert.equal(result.code, 1);
  assert.ok(lines.join('\n').includes('--owner'), 'failure names --owner');
  assert.ok(!existsSync(join(home, '.agents')), 'no global files written');
});

test('e2e: unknown harness id in --harnesses fails without writing anything', async (t) => {
  const home = sandbox(t);
  const result = await runInit(
    parseInitArgs(['--owner', 'alice', '--yes', '--harnesses', 'cursor']),
    { home, env: NO_PATH, io: scriptedIo().io },
  );
  assert.equal(result.code, 1);
  assert.ok(!existsSync(join(home, '.agents')), 'no global files written');
});

test('e2e: explicit --harnesses wires a harness even when undetected', async (t) => {
  const home = sandbox(t);
  const result = await runInit(
    parseInitArgs(['--owner', 'alice', '--yes', '--harnesses', 'codex']),
    { home, env: NO_PATH, io: scriptedIo().io },
  );
  assert.equal(result.code, 0);
  assert.ok(existsSync(join(home, '.codex', 'AGENTS.md')), 'explicitly requested wiring happens');
});

test('e2e: hermes selection prints the one-shot command and never touches its file tree', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.hermes'));
  writeFileSync(join(home, '.hermes', 'memory.db'), 'precious\n');
  const hermesBefore = snapshot(join(home, '.hermes'));
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io,
  });
  assert.equal(result.code, 0);
  assert.ok(result.hermes, 'hermes handled');
  assert.equal(result.hermes.delivered, false, 'no delivery without --deliver');
  assert.ok(result.hermes.command.startsWith('hermes -z '), 'one-shot command composed');
  assert.ok(lines.join('\n').includes('hermes -z '), 'command printed as paste instruction');
  assertTreesIdentical(hermesBefore, snapshot(join(home, '.hermes')));
});

test('e2e: --deliver runs the injected delivery command', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.hermes'));
  /** @type {string[]} */
  const ran = [];
  const result = await runInit(
    parseInitArgs(['--owner', 'alice', '--yes', '--deliver']),
    { home, env: NO_PATH, io: scriptedIo().io, run: (command) => ran.push(command) },
  );
  assert.equal(result.code, 0);
  assert.equal(result.hermes?.delivered, true);
  assert.deepEqual(ran, [result.hermes?.command], 'exactly the composed command ran');
});

test('e2e: a filesystem error mid-run fails gracefully instead of throwing', async (t) => {
  const home = sandbox(t);
  // Occupy .agents with a plain file so mkdirSync(canonDir, ...) throws ENOTDIR
  // instead of creating the directory — the audit's reproduction scenario.
  writeFileSync(join(home, '.agents'), 'not a directory');
  const { io, lines } = scriptedIo();
  const result = await runInit(parseInitArgs(['--owner', 'alice', '--yes']), {
    home,
    env: NO_PATH,
    io,
  });
  assert.equal(result.code, 1, 'returns a failure code instead of throwing');
  assert.ok(
    lines.some((line) => line.startsWith('banana init:')),
    'graceful "banana init: <message>" line printed, not a raw stack trace',
  );
});
