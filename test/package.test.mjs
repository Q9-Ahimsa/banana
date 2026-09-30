import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The kit's runtime file set: what a consumer's `npx github:...` needs, nothing else.
const RUNTIME_DIRS = ['bin/', 'lib/', 'adapters/', 'canon/', 'templates/'];

let cached;
/** Packed file list from `npm pack --dry-run --json` (hermetic — writes no tarball). */
function packedFiles() {
  if (cached) return cached;
  const out = execSync('npm pack --dry-run --json', { cwd: repoRoot, encoding: 'utf8' });
  cached = JSON.parse(out)[0].files.map((f) => f.path);
  return cached;
}

test('package.json declares the files allowlist (the 5 runtime dirs)', () => {
  assert.ok(Array.isArray(pkg.files), 'files must be an array');
  assert.deepEqual(pkg.files, RUNTIME_DIRS);
});

test('package ships zero runtime dependencies (DESIGN.md hard rule)', () => {
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test('packed tarball excludes internal + dev artifacts (no machine-path leak)', () => {
  const files = packedFiles();
  const leaked = files.filter(
    (p) =>
      p.startsWith('.agents/') ||
      p.startsWith('test/') ||
      p === 'docs/DESIGN.md' ||
      p === 'tsconfig.json' ||
      p === 'package-lock.json' ||
      p === 'AGENTS.md',
  );
  assert.deepEqual(leaked, [], 'internal artifacts leaked into pack: ' + leaked.join(', '));
});

test('packed tarball includes the runtime set + always-included metadata', () => {
  const files = packedFiles();
  const has = (p) => files.some((f) => f === p || f.startsWith(p));
  for (const req of ['bin/banana.mjs', 'lib/', 'adapters/', 'canon/', 'templates/', 'package.json', 'README.md', 'LICENSE']) {
    assert.ok(has(req), 'runtime file missing from pack: ' + req);
  }
});

// Exact shape of the pack, not a file-count ceiling: every packed path is an
// always-included metadata file, runtime code (.mjs) under bin/, lib/ or
// adapters/, or markdown under canon/ or templates/. A stray file (a .bak, a
// scratch note, a fixture) fails here wherever it lands and however small
// the pack is; adding a real runtime module needs no edit.
const PACK_SHAPE = [
  /^(package\.json|README\.md|LICENSE)$/,
  /^(bin|lib|adapters)\/[\w-]+\.mjs$/,
  /^(canon|templates)\/([\w-]+\/)?[\w-]+\.md$/,
];

test('every packed file matches the runtime shape (guards against stray files)', () => {
  const files = packedFiles();
  const stray = files.filter((p) => !PACK_SHAPE.some((re) => re.test(p)));
  assert.deepEqual(stray, [], 'files outside the runtime shape: ' + stray.join(', '));
});
