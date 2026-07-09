// bin e2e: subprocess-level coverage of bin/banana.mjs's own dispatch logic
// (flag-free `version`, per-subcommand --help/-h, top-level help/no-arg, and
// a real `project` run through the compiled binary) — behavior the unit
// tests for lib/*.mjs can't see because it lives in the dispatcher itself.
// npx shadows --version/-v/--help/-h globally, so `version` (a bare word) is
// the only reliable version probe under npx; per-subcommand --help/-h used to
// fall through to each parser's 'unknown option' error before this slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../bin/banana.mjs', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync'];

/**
 * Run the bin as a subprocess, never throwing on a non-zero exit.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(args, opts = {}) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {import('node:test').TestContext} t
 * @param {string} prefix
 * @returns {string} a fresh temp dir, cleaned up when the test ends
 */
function sandbox(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bin: bare `version` subcommand prints the package version and exits 0', () => {
  const { status, stdout } = run(['version']);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('bin: --version and -v still print the package version and exit 0 (regression)', () => {
  for (const flag of ['--version', '-v']) {
    const { status, stdout } = run([flag]);
    assert.equal(status, 0, `${flag} exits 0`);
    assert.equal(stdout.trim(), pkg.version, `${flag} prints the version`);
  }
});

test('bin: every subcommand accepts --help and -h with a usage string, not an option error', () => {
  for (const cmd of COMMANDS) {
    for (const flag of ['--help', '-h']) {
      const { status, stdout, stderr } = run([cmd, flag]);
      assert.equal(status, 0, `${cmd} ${flag} exits 0`);
      assert.ok(stdout.startsWith(`Usage: banana ${cmd}`), `${cmd} ${flag} prints usage: ${stdout}`);
      assert.equal(stderr, '', `${cmd} ${flag} writes nothing to stderr`);
      assert.ok(!stdout.includes('unknown'), `${cmd} ${flag} is not the unknown-option error`);
    }
  }
});

test('bin: top-level --help and -h exit 0 and list all five commands', () => {
  for (const flag of ['--help', '-h']) {
    const { status, stdout } = run([flag]);
    assert.equal(status, 0, `${flag} exits 0`);
    for (const cmd of COMMANDS) {
      assert.ok(stdout.includes(cmd), `${flag} output names ${cmd}`);
    }
  }
});

test('bin: no-arg invocation exits 1', () => {
  const { status } = run([]);
  assert.equal(status, 1);
});

test('bin: unknown command exits non-zero', () => {
  const { status, stderr } = run(['peel']);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes("unknown command 'peel'"));
});

test('bin: `project --owner X --yes` in a fresh sandbox cwd creates all continuity files', (t) => {
  const home = sandbox(t, 'banana-bin-home-');
  const cwd = sandbox(t, 'banana-bin-project-');
  const { status } = run(['project', '--owner', 'Bin Test Owner', '--yes'], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(status, 0);
  assert.ok(existsSync(join(cwd, 'LOGBOOK.md')), 'LOGBOOK.md created');
  assert.ok(existsSync(join(cwd, 'STATE.md')), 'STATE.md created');
  assert.ok(existsSync(join(cwd, '.agents', 'session.log')), '.agents/session.log created');
  assert.ok(existsSync(join(cwd, 'AGENTS.md')), 'AGENTS.md created');
  assert.ok(
    readFileSync(join(cwd, 'STATE.md'), 'utf8').includes('Bin Test Owner'),
    'owner substituted into STATE.md',
  );
});
