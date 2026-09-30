import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readKitVersion, compareVersions } from '../lib/version.mjs';

/** @returns {string} a fresh temp dir, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('readKitVersion reads the version string from a sandbox package.json', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: '1.2.3' }));
  assert.equal(readKitVersion(dir), '1.2.3');
});

test('readKitVersion returns null when package.json is missing', (t) => {
  const dir = sandbox(t);
  assert.equal(readKitVersion(dir), null);
});

test('readKitVersion returns null on malformed JSON', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'package.json'), '{ not valid json');
  assert.equal(readKitVersion(dir), null);
});

test('readKitVersion returns null when version is missing', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-kit' }));
  assert.equal(readKitVersion(dir), null);
});

test('readKitVersion returns null when version is not a string', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-kit', version: 7 }));
  assert.equal(readKitVersion(dir), null);
});

test('readKitVersion with no argument reads the real kit package.json', () => {
  const version = readKitVersion();
  assert.equal(typeof version, 'string');
  assert.ok(version.length > 0);
});

test('compareVersions orders a lower version below a higher one', () => {
  assert.equal(compareVersions('0.2.0', '0.3.0'), -1);
});

test('compareVersions orders a higher version above a lower one', () => {
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
});

test('compareVersions treats equal versions as equal', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
});

test('compareVersions ignores one leading v on either side', () => {
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
});

test('compareVersions compares numerically, not lexically (0.10.0 > 0.9.0)', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
});

test('compareVersions returns null for a two-part version', () => {
  assert.equal(compareVersions('0.3', '0.2.0'), null);
});

test('compareVersions returns null for a prerelease suffix', () => {
  assert.equal(compareVersions('0.3.0-beta', '0.2.0'), null);
});

test('compareVersions returns null for a non-numeric string', () => {
  assert.equal(compareVersions('abc', '0.2.0'), null);
});

test('compareVersions returns null for the literal string "null"', () => {
  assert.equal(compareVersions('null', '0.2.0'), null);
});

test('compareVersions returns null when the second argument is malformed', () => {
  assert.equal(compareVersions('0.2.0', 'abc'), null);
});
