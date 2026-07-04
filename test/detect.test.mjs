import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

import { detect, HARNESSES, findOnPath } from '../lib/detect.mjs';

/** @type {string[]} */
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a fixture fake-home tree containing the given harness dot-dirs.
 * @param {string[]} dirs
 * @returns {string}
 */
function makeHome(dirs = []) {
  const home = mkdtempSync(join(tmpdir(), 'banana-detect-'));
  tempDirs.push(home);
  for (const d of dirs) mkdirSync(join(home, d), { recursive: true });
  return home;
}

/**
 * Build a fixture bin dir holding the given executable names, returning an
 * env whose PATH contains only that dir — no real-machine leakage.
 * @param {string[]} bins
 * @returns {{ PATH: string }}
 */
function makeEnv(bins = []) {
  const binDir = mkdtempSync(join(tmpdir(), 'banana-bin-'));
  tempDirs.push(binDir);
  for (const b of bins) writeFileSync(join(binDir, b), '');
  return { PATH: binDir };
}

const EMPTY_ENV = { PATH: '' };

/**
 * @param {ReturnType<typeof detect>} report
 * @param {string} id
 */
function entry(report, id) {
  const found = report.harnesses.find((h) => h.id === id);
  assert.ok(found, `report has an entry for ${id}`);
  return found;
}

test('report covers all four harnesses with a stable shape', () => {
  const home = makeHome();
  const report = detect(home, { env: EMPTY_ENV });

  assert.equal(report.home, home);
  assert.equal(report.harnesses.length, 4);
  assert.deepEqual(
    report.harnesses.map((h) => h.id),
    HARNESSES.map((h) => h.id)
  );
  assert.deepEqual(
    HARNESSES.map((h) => h.id),
    ['claude-code', 'pi', 'codex', 'hermes']
  );
  for (const h of report.harnesses) {
    assert.equal(typeof h.name, 'string');
    assert.equal(typeof h.detected, 'boolean');
    assert.ok(h.via === 'home-dir' || h.via === 'path' || h.via === null);
  }
});

// Present and absent home-dir cases for each of the four harnesses.
const DIR_CASES = [
  { id: 'claude-code', dir: '.claude' },
  { id: 'pi', dir: '.pi' },
  { id: 'codex', dir: '.codex' },
  { id: 'hermes', dir: '.hermes' },
];

for (const { id, dir } of DIR_CASES) {
  test(`${id}: detected via ${dir} home dir when present`, () => {
    const report = detect(makeHome([dir]), { env: EMPTY_ENV });
    const h = entry(report, id);
    assert.equal(h.detected, true);
    assert.equal(h.via, 'home-dir');
  });

  test(`${id}: absent when home has no ${dir} and PATH is empty`, () => {
    const report = detect(makeHome(), { env: EMPTY_ENV });
    const h = entry(report, id);
    assert.equal(h.detected, false);
    assert.equal(h.via, null);
  });
}

test('claude-code: falls back to claude binary on PATH', () => {
  const report = detect(makeHome(), { env: makeEnv(['claude']) });
  const h = entry(report, 'claude-code');
  assert.equal(h.detected, true);
  assert.equal(h.via, 'path');
});

test('hermes: falls back to hermes binary on PATH', () => {
  const report = detect(makeHome(), { env: makeEnv(['hermes']) });
  const h = entry(report, 'hermes');
  assert.equal(h.detected, true);
  assert.equal(h.via, 'path');
});

test('pi and codex are dir-only: binaries on PATH do not count', () => {
  const report = detect(makeHome(), { env: makeEnv(['pi', 'codex']) });
  assert.equal(entry(report, 'pi').detected, false);
  assert.equal(entry(report, 'codex').detected, false);
});

test('a harness path that is a plain file, not a dir, does not count', () => {
  const home = makeHome();
  writeFileSync(join(home, '.claude'), 'not a directory');
  const report = detect(home, { env: EMPTY_ENV });
  assert.equal(entry(report, 'claude-code').detected, false);
});

test('home-dir wins over PATH when both are present', () => {
  const report = detect(makeHome(['.claude']), { env: makeEnv(['claude']) });
  const h = entry(report, 'claude-code');
  assert.equal(h.detected, true);
  assert.equal(h.via, 'home-dir');
});

test('findOnPath: locates a binary across PATH entries and misses cleanly', () => {
  const env = makeEnv(['claude']);
  const found = findOnPath('claude', env);
  assert.ok(found && found.endsWith('claude'));
  assert.equal(findOnPath('claude', EMPTY_ENV), null);
  // Multiple PATH entries: hit in the second one.
  const twoDirs = { PATH: makeHome().concat(delimiter, env.PATH) };
  assert.ok(findOnPath('claude', twoDirs));
});

test('findOnPath: respects PATHEXT-style suffixed executables', () => {
  const env = makeEnv(['claude.cmd']);
  const found = findOnPath('claude', { PATH: env.PATH, PATHEXT: '.COM;.EXE;.CMD' });
  assert.ok(found && found.toLowerCase().endsWith('claude.cmd'));
});
