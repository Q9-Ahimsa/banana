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
import { join, relative } from 'node:path';

import * as claudeCode from '../adapters/claude-code.mjs';
import * as pi from '../adapters/pi.mjs';
import * as codex from '../adapters/codex.mjs';
import { fenceBegin, FENCE_END } from '../lib/fence.mjs';
import { renderWiringTemplate } from '../lib/wiring.mjs';

const CASES = [
  { adapter: claudeCode, dir: '.claude', target: join('.claude', 'CLAUDE.md'), tag: 'claude' },
  { adapter: pi, dir: '.pi', target: join('.pi', 'agent', 'AGENTS.md'), tag: 'pi' },
  { adapter: codex, dir: '.codex', target: join('.codex', 'AGENTS.md'), tag: 'codex' },
];

// Empty PATH so detection can never leak in from the real machine.
const NO_PATH = { env: { PATH: '', PATHEXT: '' } };

/** @returns {string} a fresh sandbox home, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-adapters-'));
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

for (const { adapter, dir, target, tag } of CASES) {
  test(`${adapter.id}: describe declares the target file`, () => {
    const description = adapter.describe();
    assert.equal(description.id, adapter.id);
    assert.equal(description.target, target);
  });

  test(`${adapter.id}: detect reports the home dir, and its absence`, (t) => {
    const home = sandbox(t);
    assert.equal(adapter.detect(home, NO_PATH).detected, false);
    mkdirSync(join(home, dir));
    const report = adapter.detect(home, NO_PATH);
    assert.equal(report.detected, true);
    assert.equal(report.via, 'home-dir');
  });

  test(`${adapter.id}: wire requires an owner`, (t) => {
    const home = sandbox(t);
    mkdirSync(join(home, dir));
    assert.throws(() => adapter.wire(home, /** @type {any} */ ({})), /owner/i);
  });

  test(`${adapter.id}: wire writes the fenced block with owner and tag substituted`, (t) => {
    const home = sandbox(t);
    mkdirSync(join(home, dir));
    const report = adapter.wire(home, { owner: 'alice' });
    assert.equal(report.created, true);
    assert.equal(report.target, join(home, target));
    const text = readFileSync(join(home, target), 'utf8');
    assert.ok(text.includes(fenceBegin(2)), 'begin marker present');
    assert.ok(text.includes(FENCE_END), 'end marker present');
    assert.ok(text.includes('`alice`'), 'owner substituted');
    assert.ok(text.includes('`' + tag + '`'), 'default agent tag substituted');
    assert.ok(!text.includes('__OWNER__') && !text.includes('__AGENT_TAG__'), 'no placeholder residue');
  });

  test(`${adapter.id}: an explicit tag overrides the default`, (t) => {
    const home = sandbox(t);
    mkdirSync(join(home, dir));
    adapter.wire(home, { owner: 'alice', tag: 'custom-tag' });
    const text = readFileSync(join(home, target), 'utf8');
    assert.ok(text.includes('`custom-tag`'));
  });

  test(`${adapter.id}: second wire run is byte-identical and preserves user content`, (t) => {
    const home = sandbox(t);
    mkdirSync(join(home, dir), { recursive: true });
    mkdirSync(join(home, target, '..'), { recursive: true });
    writeFileSync(join(home, target), '# My own config\n\nkeep me\n');
    adapter.wire(home, { owner: 'alice' });
    const firstPass = readFileSync(join(home, target));
    const report = adapter.wire(home, { owner: 'alice' });
    const secondPass = readFileSync(join(home, target));
    assert.equal(report.changed, false);
    assert.ok(firstPass.equals(secondPass), 'second wire must be byte-identical');
    assert.ok(secondPass.toString('utf8').startsWith('# My own config\n\nkeep me\n'));
  });

  test(`${adapter.id}: writes nothing outside the declared target file`, (t) => {
    const home = sandbox(t);
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, 'notes.md'), 'mine\n');
    writeFileSync(join(home, dir, 'settings.json'), '{"keep":true}\n');
    const before = snapshot(home);
    adapter.wire(home, { owner: 'alice' });
    const after = snapshot(home);
    const added = [...after.keys()].filter((path) => !before.has(path));
    assert.deepEqual(added, [target], 'only the declared target may be created');
    for (const [path, bytes] of before) {
      const untouched = after.get(path);
      assert.ok(untouched && untouched.equals(bytes), `${path} must be untouched`);
    }
  });
}

test('renderWiringTemplate: requires an agent tag', () => {
  assert.throws(
    () => renderWiringTemplate('claude-code.md', { owner: 'alice', tag: '' }),
    /agent tag/i,
  );
});
