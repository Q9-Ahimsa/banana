// US-008 acceptance: the project command initializes a repo for continuity —
// LOGBOOK.md (header block + TYPE vocabulary), STATE.md (all six sections),
// .agents/session.log seed, and the fenced AGENTS.md wiring block. Temp-repo
// e2e: files created with required sections, re-run idempotent, and a non-repo
// dir without --force exits non-zero.
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

const FLAGS = { owner: 'Test Owner', tag: 'test-agent', force: false, yes: true };

test('parseProjectArgs: parses all flags', () => {
  const flags = parseProjectArgs(['--owner', 'Ada', '--tag', 'claude', '--force', '--yes']);
  assert.deepEqual(flags, { owner: 'Ada', tag: 'claude', force: true, yes: true });
});

test('parseProjectArgs: rejects unknown options and missing values', () => {
  assert.throws(() => parseProjectArgs(['--bogus']), /unknown project option/);
  assert.throws(() => parseProjectArgs(['--owner']), /--owner requires a value/);
});

test('e2e: fresh run creates all continuity files with required sections', async (t) => {
  const repo = repoSandbox(t);
  const result = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
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

test('e2e: a non-repo dir without --force exits non-zero and writes nothing', async (t) => {
  const dir = sandbox(t);
  const result = await runProject(FLAGS, { cwd: dir, io: scriptedIo().io });
  assert.notEqual(result.code, 0);
  assert.deepEqual([...snapshot(dir).keys()], [], 'no files written');
});

test('e2e: --force initializes a non-repo dir', async (t) => {
  const dir = sandbox(t);
  const result = await runProject({ ...FLAGS, force: true }, { cwd: dir, io: scriptedIo().io });
  assert.equal(result.code, 0);
  for (const file of ['LOGBOOK.md', 'STATE.md', 'AGENTS.md', join('.agents', 'session.log')]) {
    assert.ok(snapshot(dir).has(file), `${file} created under --force`);
  }
});

test('interactive: owner comes from the prompt when --owner is absent', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo(['Prompted Owner']);
  const result = await runProject(
    { owner: null, tag: null, force: false, yes: false },
    { cwd: repo, io: scripted.io },
  );
  assert.equal(result.code, 0);
  assert.ok(readFileSync(join(repo, 'STATE.md'), 'utf8').includes('Prompted Owner'));
});

test('non-interactive: --yes without --owner exits non-zero', async (t) => {
  const repo = repoSandbox(t);
  const result = await runProject(
    { owner: null, tag: null, force: false, yes: true },
    { cwd: repo, io: scriptedIo().io },
  );
  assert.notEqual(result.code, 0);
});
