// US-005 acceptance: the project command initializes a workspace for
// continuity — LOGBOOK.md (header block + TYPE vocabulary), STATE.md (all six
// sections), .agents/session.log seed, and the fenced AGENTS.md wiring block.
// Topic-grain: a non-git dir proceeds with a not-version-controlled note (no
// --force); owner resolution shares init's inference order (flag, git config,
// TTY prompt) and its non-TTY fail-fast. Temp-dir e2e: files created with
// required sections, re-run idempotent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { parseProjectArgs, runProject } from '../lib/project.mjs';
import { fenceBegin, FENCE_END } from '../lib/fence.mjs';

/** @returns {string} a fresh temp dir, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-project-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @returns {string} a temp dir that looks like a git repo */
function repoSandbox(t) {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.git'));
  return dir;
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
    io: {
      out: (line = '') => lines.push(line),
      prompt: async (/** @type {string} */ question) => {
        if (queue.length === 0) throw new Error(`unexpected prompt: ${question}`);
        return queue.shift() ?? '';
      },
    },
  };
}

/**
 * Snapshot every file under root: relative path -> content bytes.
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
function snapshot(root) {
  const files = new Map();
  const walk = (/** @type {string} */ dir) => {
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

const NOTE = 'not version controlled';
const FLAGS = { owner: 'Test Owner', tag: 'test-agent', yes: true };

test('parseProjectArgs: parses all flags', () => {
  const flags = parseProjectArgs(['--owner', 'Ada', '--tag', 'claude', '--yes']);
  assert.deepEqual(flags, { owner: 'Ada', tag: 'claude', yes: true });
});

test('parseProjectArgs: rejects unknown options and missing values', () => {
  assert.throws(() => parseProjectArgs(['--bogus']), /unknown project option/);
  assert.throws(() => parseProjectArgs(['--owner']), /--owner requires a value/);
});

test('parseProjectArgs: --force is gone', () => {
  assert.throws(() => parseProjectArgs(['--force']), /unknown project option '--force'/);
});

test('e2e: fresh run in a git repo creates all continuity files, no note', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(FLAGS, { cwd: repo, io: scripted.io });
  assert.equal(result.code, 0);

  const logbook = readFileSync(join(repo, 'LOGBOOK.md'), 'utf8');
  assert.match(logbook, /^# LOGBOOK/, 'LOGBOOK.md header block');
  assert.match(logbook, /TYPE vocabulary/, 'declared TYPE vocabulary');
  assert.match(logbook, /SESSION · DECISION · MILESTONE/, 'TYPE vocabulary entries');
  assert.match(logbook, /\{actor\} \{stream\}\.\{n\}/, 'envelope spec');

  const state = readFileSync(join(repo, 'STATE.md'), 'utf8');
  for (const section of ['## Now', '## Truths', '## Next', '## Blocked', '## Watch', '## Dead ends']) {
    assert.ok(state.includes(section), `STATE.md must contain '${section}'`);
  }
  assert.ok(state.includes('Test Owner'), 'STATE.md carries the owner');
  assert.ok(!state.includes('__OWNER__'), 'no placeholder residue');

  const seed = readFileSync(join(repo, '.agents', 'session.log'), 'utf8');
  assert.match(seed, /Session Log v2/, 'session.log seed header');
  assert.match(seed, /APPROACH:/, 'seed documents the entry protocol');

  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(fenceBegin(2)), 'AGENTS.md carries the begin marker');
  assert.ok(agents.includes(FENCE_END), 'AGENTS.md carries the end marker');
  assert.ok(agents.includes('test-agent'), 'wiring block carries the agent tag');
  assert.ok(!agents.includes('__AGENT_TAG__'), 'no placeholder residue');

  assert.equal(result.created.length, 3, 'LOGBOOK.md, STATE.md, session.log reported created');
  assert.equal(result.wired?.created, true);
  assert.ok(!scripted.lines.join('\n').includes(NOTE), 'no note inside a git repo');
});

test('e2e: a non-git dir proceeds with a not-version-controlled note', async (t) => {
  const dir = sandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(FLAGS, { cwd: dir, io: scripted.io });
  assert.equal(result.code, 0);
  for (const file of ['LOGBOOK.md', 'STATE.md', 'AGENTS.md', join('.agents', 'session.log')]) {
    assert.ok(snapshot(dir).has(file), `${file} created in a non-git dir`);
  }
  assert.ok(scripted.lines.join('\n').includes(NOTE), 'note present in output');
});

test('e2e: a second run exits 0 with a byte-identical tree', async (t) => {
  const repo = repoSandbox(t);
  const first = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(first.code, 0);

  const before = snapshot(repo);
  const second = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(second.code, 0);
  assert.deepEqual(second.created, [], 'nothing newly created on re-run');
  assert.equal(second.wired?.changed, false, 'fence already current');
  assertTreesIdentical(before, snapshot(repo));
});

test('e2e: re-run in a non-git dir is idempotent too', async (t) => {
  const dir = sandbox(t);
  const first = await runProject(FLAGS, { cwd: dir, io: scriptedIo().io });
  assert.equal(first.code, 0);

  const before = snapshot(dir);
  const second = await runProject(FLAGS, { cwd: dir, io: scriptedIo().io });
  assert.equal(second.code, 0);
  assert.deepEqual(second.created, [], 'nothing newly created on re-run');
  assertTreesIdentical(before, snapshot(dir));
});

test('e2e: existing files are never overwritten; AGENTS.md content outside the fence survives', async (t) => {
  const repo = repoSandbox(t);
  writeFileSync(join(repo, 'LOGBOOK.md'), '# my existing logbook\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Repo instructions\n\nHand-written content.\n');

  const result = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(join(repo, 'LOGBOOK.md'), 'utf8'), '# my existing logbook\n');

  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Repo instructions\n\nHand-written content.\n'), 'user content preserved');
  assert.ok(agents.includes(fenceBegin(2)) && agents.includes(FENCE_END), 'fence appended');
});

test('owner inference: git config user.name fills in when --owner is absent', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scripted.io, gitUserName: () => 'Git Alice' },
  );
  assert.equal(result.code, 0);
  assert.ok(scripted.lines.join('\n').includes('Git Alice (from git config user.name)'), 'inference reported');
  assert.ok(readFileSync(join(repo, 'STATE.md'), 'utf8').includes('Git Alice'));
});

test('interactive: owner comes from the TTY prompt when nothing is inferable', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo(['Prompted Owner']);
  const result = await runProject(
    { owner: null, tag: null, yes: false },
    { cwd: repo, io: scripted.io, isTTY: true },
  );
  assert.equal(result.code, 0);
  assert.ok(readFileSync(join(repo, 'STATE.md'), 'utf8').includes('Prompted Owner'));
});

test('non-TTY: no inferable owner exits non-zero naming --owner and --yes, writes nothing', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(
    { owner: null, tag: null, yes: false },
    { cwd: repo, io: scripted.io },
  );
  assert.notEqual(result.code, 0);
  const output = scripted.lines.join('\n');
  assert.ok(output.includes('--owner'), 'failure names --owner');
  assert.ok(output.includes('--yes'), 'failure names --yes');
  assert.deepEqual([...snapshot(repo).keys()], [], 'no files written');
});
