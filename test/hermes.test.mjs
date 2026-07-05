import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import * as hermes from '../adapters/hermes.mjs';

// Empty PATH so detection can never leak in from the real machine.
const NO_PATH = { env: { PATH: '', PATHEXT: '' } };

const SENDER_HEADER = 'FROM: banana continuity kit (agent-to-agent) on behalf of alice';
// v2 directives are thin bootstrap pointers — protocol rules live in the canon.
const CANON_DIR_POINTER = '~/.agents/canon/';
const NPX_INVOCATION = 'npx --yes github:Q9-Ahimsa/banana';

/** @returns {string} a fresh sandbox home, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-hermes-'));
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

test('hermes: describe declares write-through delivery with no file target', () => {
  const description = hermes.describe();
  assert.equal(description.id, 'hermes');
  assert.equal(description.target, null);
  assert.equal(description.delivery, 'write-through-agent');
});

test('hermes: detect reports the home dir, and its absence', (t) => {
  const home = sandbox(t);
  assert.equal(hermes.detect(home, NO_PATH).detected, false);
  mkdirSync(join(home, '.hermes'));
  const report = hermes.detect(home, NO_PATH);
  assert.equal(report.detected, true);
  assert.equal(report.via, 'home-dir');
});

test('hermes: compose requires an owner', () => {
  assert.throws(() => hermes.compose(/** @type {any} */ ({})), /owner/i);
});

test('hermes: directive carries the sender header, canon pointer, and agent tag', () => {
  const { directive, tag } = hermes.compose({ owner: 'alice' });
  assert.ok(directive.includes(SENDER_HEADER), 'sender header present');
  assert.ok(directive.includes(CANON_DIR_POINTER), 'canon dir pointer present');
  assert.ok(directive.includes(NPX_INVOCATION), 'npx invocation present');
  assert.equal(tag, 'hermes');
  assert.ok(directive.includes('`hermes`'), 'agent tag present in directive');
  assert.ok(
    !directive.includes('__OWNER__') && !directive.includes('__AGENT_TAG__'),
    'no placeholder residue',
  );
});

test('hermes: an explicit tag overrides the default', () => {
  const { directive, tag } = hermes.compose({ owner: 'alice', tag: 'custom-tag' });
  assert.equal(tag, 'custom-tag');
  assert.ok(directive.includes('`custom-tag`'));
});

test('hermes: one-shot command wraps the directive for delivery', () => {
  const { command, directive } = hermes.compose({ owner: 'alice' });
  assert.ok(command.startsWith('hermes -z "'), 'one-shot form');
  assert.ok(command.includes('FROM: banana continuity kit'), 'directive embedded');
  assert.ok(directive.length > 0);
});

test('hermes: composing and delivering leaves a sandbox hermes home byte-identical', (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.hermes'));
  writeFileSync(join(home, '.hermes', 'memory.json'), '{"keep":true}\n');
  writeFileSync(join(home, 'notes.md'), 'mine\n');
  const before = snapshot(home);
  const composed = hermes.compose({ owner: 'alice' });
  hermes.deliver(composed, {});
  hermes.deliver(composed, { deliver: true, run: () => {} });
  const after = snapshot(home);
  assert.deepEqual(
    [...after.keys()].sort(),
    [...before.keys()].sort(),
    'no files added or removed',
  );
  for (const [path, bytes] of before) {
    const untouched = after.get(path);
    assert.ok(untouched && untouched.equals(bytes), `${path} must be byte-identical`);
  }
});

test('hermes: deliver refuses without the explicit deliver flag', () => {
  let ran = 0;
  const composed = hermes.compose({ owner: 'alice' });
  const report = hermes.deliver(composed, {
    run: () => {
      ran += 1;
    },
  });
  assert.equal(report.delivered, false);
  assert.equal(ran, 0, 'run must not be invoked without --deliver');
});

test('hermes: deliver runs the one-shot command when explicitly flagged', () => {
  /** @type {string[]} */
  const calls = [];
  const composed = hermes.compose({ owner: 'alice' });
  const report = hermes.deliver(composed, {
    deliver: true,
    run: (command) => {
      calls.push(command);
    },
  });
  assert.equal(report.delivered, true);
  assert.deepEqual(calls, [composed.command]);
});
