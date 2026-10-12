import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { COMMANDS } from '../lib/commands.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('bin --version prints the package.json version and exits 0', () => {
  const out = execFileSync(process.execPath, ['bin/banana.mjs', '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(out, pkg.version);
});

test('bin `version` subcommand prints the package.json version and exits 0', () => {
  const out = execFileSync(process.execPath, ['bin/banana.mjs', 'version'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(out, pkg.version);
});

test('bin -v and -h are short-flag equivalents of --version and --help', () => {
  const versionOut = execFileSync(process.execPath, ['bin/banana.mjs', '-v'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(versionOut, pkg.version, '-v prints the same version as --version');

  const helpOut = execFileSync(process.execPath, ['bin/banana.mjs', '-h'], { encoding: 'utf8' });
  for (const cmd of COMMANDS) {
    assert.ok(helpOut.includes(cmd), `-h output names ${cmd}`);
  }
});

test('bin --help lists every command in lib/commands.mjs COMMANDS', () => {
  const out = execFileSync(process.execPath, ['bin/banana.mjs', '--help'], { encoding: 'utf8' });
  for (const cmd of COMMANDS) {
    assert.ok(out.includes(cmd), `--help output names ${cmd}`);
  }
  const at = COMMANDS.map((c) => out.search(new RegExp('^  ' + c + ' ', 'm')));
  assert.ok(
    at.every((i) => i >= 0),
    `--help lists each command on its own indented line: ${at}`
  );
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
});

test('unknown command exits non-zero', () => {
  assert.throws(() =>
    execFileSync(process.execPath, ['bin/banana.mjs', 'peel'], { encoding: 'utf8' })
  );
});
