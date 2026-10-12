// The deny-list over the source tree (#23). canon/ and templates/ keep their
// own scans (test/canon.test.mjs, test/templates.test.mjs); this file covers
// every dir the typecheck covers (tsconfig.json include): bin/, lib/,
// adapters/, test/. Fixtures, help examples and comments use a placeholder
// owner such as `alice`, never a real person's name or handle.
//
// Two things are sanctioned, each stripped as a substring, never by skipping
// a line or a file: the public repo slug (the kit's distribution coordinate),
// and the deny-list entries themselves, byte-exact, which live in exactly
// three files: test/canon.test.mjs, test/templates.test.mjs and this one.
// This file scans itself: nothing forbidden appears here outside the
// FORBIDDEN_PATTERNS block; planted test text is built from the patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SCANNED_DIRS = ['bin', 'lib', 'adapters', 'test'];
const REPO_SLUG = 'Q9-Ahimsa/banana';

// Byte-identical to test/canon.test.mjs:54-57 and test/templates.test.mjs:149-152.
const FORBIDDEN_PATTERNS = [
  { name: 'Ahimsa', re: /ahimsa/i },
  { name: 'VICTUS', re: /victus/i },
  { name: 'hermes.exe', re: /hermes\.exe/i },
  { name: 'absolute C:/ path', re: /\bC:[\\/]/ },
];

const OWNER_PATTERN = FORBIDDEN_PATTERNS[0];
const PLANTED_HANDLE = OWNER_PATTERN.re.source;
const DENY_LIST_CARRIERS = ['test/canon.test.mjs', 'test/deny-list.test.mjs', 'test/templates.test.mjs'];

/**
 * A file's deny-list entry lines, trimmed, trailing comma dropped.
 * @param {string} text
 * @returns {string[]}
 */
function entryLines(text) {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => /^[ \t]*\{ name: '[^']*', re: \//.test(line))
    .map((line) => line.trim().replace(/,$/, ''));
}

// The exempt entry texts, read from the canonical copy's SOURCE — never rebuilt
// from the RegExp objects, so no escaping assumption is involved.
const DETECTOR_LITERALS = entryLines(readFileSync(join(repoRoot, 'test', 'canon.test.mjs'), 'utf8'));

/**
 * @param {string} rel repo-relative dir, forward slashes
 * @returns {string[]} every file under it, repo-relative with forward slashes
 */
function walk(rel) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

/** @returns {string[]} */
function scannedFiles() {
  return SCANNED_DIRS.flatMap(walk);
}

/**
 * @param {string} text
 * @returns {string[]} `line N: <pattern name>` per forbidden hit
 */
function forbiddenReferencesIn(text) {
  /** @type {string[]} */
  const hits = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    let line = raw.replaceAll(REPO_SLUG, '');
    for (const literal of DETECTOR_LITERALS) line = line.replaceAll(literal, '');
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(line)) hits.push(`line ${i + 1}: ${name}`);
    }
  });
  return hits;
}

test('bin/, lib/, adapters/ and test/ carry zero machine-specific references (#23)', () => {
  /** @type {string[]} */
  const hits = [];
  for (const rel of scannedFiles()) {
    const text = readFileSync(join(repoRoot, rel), 'utf8');
    for (const hit of forbiddenReferencesIn(text)) hits.push(`${rel} ${hit}`);
  }
  assert.deepEqual(
    hits,
    [],
    `forbidden references; use a placeholder owner such as alice (only the repo slug and the deny-list entries are exempt):\n${hits.join('\n')}`,
  );
});

test('the scan reaches every source dir', () => {
  const tsconfig = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8'));
  assert.deepEqual(SCANNED_DIRS, tsconfig.include.map((/** @type {string} */ g) => g.split('/')[0]));
  const files = scannedFiles();
  for (const expected of ['bin/banana.mjs', 'lib/state.mjs', 'adapters/claude-code.mjs', 'test/deny-list.test.mjs']) {
    assert.ok(files.includes(expected), `${expected} is scanned`);
  }
});

test('the deny-list entries live in exactly three files, each carrying the same entries in the same order', () => {
  assert.equal(DETECTOR_LITERALS.length, FORBIDDEN_PATTERNS.length);
  const carriers = scannedFiles()
    .filter((rel) => {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      return DETECTOR_LITERALS.some((literal) => text.includes(literal));
    })
    .sort();
  assert.deepEqual(carriers, DENY_LIST_CARRIERS);
  for (const rel of DENY_LIST_CARRIERS) {
    assert.deepEqual(entryLines(readFileSync(join(repoRoot, rel), 'utf8')), DETECTOR_LITERALS, `${rel} entries`);
  }
});

test('negative control: a planted handle is caught in any letter case, with its line number', () => {
  assert.deepEqual(
    forbiddenReferencesIn(`first line\n- ${PLANTED_HANDLE.toUpperCase()} — review the shipped slice\n`),
    [`line 2: ${OWNER_PATTERN.name}`],
  );
  // Every entry's name is text its own pattern matches, so one line plants all four.
  assert.deepEqual(
    forbiddenReferencesIn(FORBIDDEN_PATTERNS.map(({ name }) => name).join(' ')),
    FORBIDDEN_PATTERNS.map(({ name }) => `line 1: ${name}`),
  );
});

test('negative control: only the full repo slug is exempt, as a substring', () => {
  assert.equal(
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).repository.url,
    `git+https://github.com/${REPO_SLUG}.git`,
    'REPO_SLUG is the full slug from package.json',
  );
  assert.deepEqual(forbiddenReferencesIn(`npx --yes github:${REPO_SLUG} --owner ${PLANTED_HANDLE}`), [
    `line 1: ${OWNER_PATTERN.name}`,
  ]);
  assert.deepEqual(forbiddenReferencesIn(`owner: ${REPO_SLUG.split('/')[0]}`), [`line 1: ${OWNER_PATTERN.name}`]);
  assert.deepEqual(forbiddenReferencesIn(`${REPO_SLUG} ${REPO_SLUG}`), []);
  assert.deepEqual(forbiddenReferencesIn(REPO_SLUG.toUpperCase()), [`line 1: ${OWNER_PATTERN.name}`]);
});

test('negative control: only a byte-exact deny-list entry is exempt, as a substring', () => {
  assert.deepEqual(forbiddenReferencesIn(`  ${DETECTOR_LITERALS[0]},`), []);
  assert.deepEqual(forbiddenReferencesIn(`${DETECTOR_LITERALS[0]} ${DETECTOR_LITERALS[0]}`), []);
  assert.deepEqual(forbiddenReferencesIn(`  ${DETECTOR_LITERALS[0]}, // ${PLANTED_HANDLE}`), [
    `line 1: ${OWNER_PATTERN.name}`,
  ]);
  assert.deepEqual(
    forbiddenReferencesIn(`  { name: 'owner', re: /${PLANTED_HANDLE}/i },`),
    [`line 1: ${OWNER_PATTERN.name}`],
  );
});
