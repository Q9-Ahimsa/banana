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

import { parseInitArgs, runInit } from '../lib/init.mjs';

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

test('e2e: fresh init creates both global files plus wiring for detected harnesses', async (t) => {
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

  const continuity = join(home, '.agents', 'CONTINUITY.md');
  assert.ok(existsSync(continuity), 'CONTINUITY.md created');
  assert.ok(
    readFileSync(continuity).equals(readFileSync(join(KIT_ROOT, 'canon', 'CONTINUITY.md'))),
    'CONTINUITY.md is the canon file byte-for-byte',
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

test('e2e: init never overwrites an existing STATE.md or CONTINUITY.md', async (t) => {
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
  assert.deepEqual(result.created, [], 'nothing recreated');
  assert.equal(readFileSync(join(home, '.agents', 'STATE.md'), 'utf8'), '# my living state\n');
  assert.equal(readFileSync(join(home, '.agents', 'CONTINUITY.md'), 'utf8'), '# my edited protocol\n');
});

test('e2e: interactive fallback uses at most 3 prompts and wires the detected set', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const { io, prompts } = scriptedIo(['alice', '', 'y']);
  const result = await runInit(parseInitArgs([]), { home, env: NO_PATH, io });
  assert.equal(result.code, 0);
  assert.equal(prompts(), 3, 'owner, harness confirm, write-plan confirm');
  assert.deepEqual(result.selected, ['claude-code']);
  const text = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.ok(text.includes('`alice`'), 'prompted owner substituted');
});

test('e2e: declining the write plan aborts without writing anything', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.claude'));
  const before = snapshot(home);
  const { io } = scriptedIo(['alice', '', 'n']);
  const result = await runInit(parseInitArgs([]), { home, env: NO_PATH, io });
  assert.equal(result.code, 1);
  assertTreesIdentical(before, snapshot(home));
});

test('e2e: --yes without --owner fails without writing anything', async (t) => {
  const home = sandbox(t);
  const result = await runInit(parseInitArgs(['--yes']), { home, env: NO_PATH, io: scriptedIo().io });
  assert.equal(result.code, 1);
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
