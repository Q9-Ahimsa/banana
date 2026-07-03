import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('bin --version prints the package.json version and exits 0', () => {
  const out = execFileSync(process.execPath, ['bin/banana.mjs', '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(out, pkg.version);
});

test('bin --help lists all four commands', () => {
  const out = execFileSync(process.execPath, ['bin/banana.mjs', '--help'], { encoding: 'utf8' });
  for (const cmd of ['init', 'project', 'brief', 'doctor']) {
    assert.match(out, new RegExp(`\\b${cmd}\\b`));
  }
});

test('unknown command exits non-zero', () => {
  assert.throws(() =>
    execFileSync(process.execPath, ['bin/banana.mjs', 'peel'], { encoding: 'utf8' })
  );
});
