import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));

// The npx one-liner per prd.json US-011.
const NPX_COMMAND = 'npx github:Q9-Ahimsa/banana';

// The four commands per bin/banana.mjs COMMANDS.
const COMMANDS = ['init', 'project', 'brief', 'doctor'];

// One section heading per shipped adapter (adapters/*.mjs describe().name).
const ADAPTER_HEADINGS = ['### Claude Code', '### Pi', '### Codex', '### Hermes'];

test('README.md carries the npx one-liner', () => {
  const text = readFileSync(readmePath, 'utf8');
  assert.ok(text.includes(NPX_COMMAND), `README.md missing install command: "${NPX_COMMAND}"`);
});

test('README.md names all four commands', () => {
  const text = readFileSync(readmePath, 'utf8');
  for (const cmd of COMMANDS) {
    assert.ok(
      text.includes(`banana ${cmd}`),
      `README.md missing command: "banana ${cmd}"`,
    );
  }
});

test('README.md has one section per shipped adapter', () => {
  const text = readFileSync(readmePath, 'utf8');
  for (const heading of ADAPTER_HEADINGS) {
    assert.ok(text.includes(heading), `README.md missing adapter section: "${heading}"`);
  }
});

test('README.md opens by saying what banana does', () => {
  const text = readFileSync(readmePath, 'utf8');
  const firstLine = text.split('\n', 1)[0];
  assert.ok(/continuity/i.test(firstLine), 'first line must say what banana does');
});
