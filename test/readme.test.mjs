import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
const binPath = fileURLToPath(new URL('../bin/banana.mjs', import.meta.url));

// The canonical invocation per the v2 wiring templates (templates.test.mjs NPX_INVOCATION).
const NPX_COMMAND = 'npx --yes github:Q9-Ahimsa/banana';

// The five commands per bin/banana.mjs COMMANDS.
const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync'];

// The kit-owned canon dir the wiring blocks point at.
const CANON_DIR_POINTER = '~/.agents/canon/';

// The first heading that addresses agents marks the end of the human section.
const AGENT_HEADING_RE = /^#{1,6}\s.*agent/i;

test('README.md opens by saying what banana does', () => {
  const text = readFileSync(readmePath, 'utf8');
  const firstLine = text.split('\n', 1)[0];
  assert.ok(/continuity/i.test(firstLine), 'first line must say what banana does');
});

test('README.md carries the canonical npx one-liner', () => {
  const text = readFileSync(readmePath, 'utf8');
  assert.ok(text.includes(NPX_COMMAND), `README.md missing install command: "${NPX_COMMAND}"`);
});

test('README.md names all five commands', () => {
  const text = readFileSync(readmePath, 'utf8');
  for (const cmd of COMMANDS) {
    assert.ok(
      text.includes(`banana ${cmd}`),
      `README.md missing command: "banana ${cmd}"`,
    );
  }
});

test('README.md carries the canon dir path', () => {
  const text = readFileSync(readmePath, 'utf8');
  assert.ok(
    text.includes(CANON_DIR_POINTER),
    `README.md missing canon dir path: "${CANON_DIR_POINTER}"`,
  );
});

test('README.md human section is 40 lines or fewer', () => {
  const lines = readFileSync(readmePath, 'utf8').split('\n');
  const agentHeadingIndex = lines.findIndex((line) => AGENT_HEADING_RE.test(line));
  assert.notEqual(agentHeadingIndex, -1, 'README.md has no agent-addressed heading');
  assert.ok(
    agentHeadingIndex <= 40,
    `human section is ${agentHeadingIndex} lines; must be 40 or fewer`,
  );
});

test('banana --version prints 0.2.0', () => {
  const out = execFileSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), '0.2.0');
});
