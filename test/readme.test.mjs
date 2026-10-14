import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { COMMANDS } from '../lib/commands.mjs';
import { fenceBegin } from '../lib/fence.mjs';
import { wiringTemplateVersion } from '../lib/wiring.mjs';
import { ARCHIVE_REASONS, STATE_VERBS } from '../lib/state.mjs';
import { CLOCK_GATES } from '../lib/state-archive.mjs';

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
const binPath = fileURLToPath(new URL('../bin/banana.mjs', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The canonical invocation per the wiring templates (templates.test.mjs NPX_INVOCATION).
const NPX_COMMAND = 'npx --yes github:Q9-Ahimsa/banana';

// The kit-owned canon dir the wiring blocks point at.
const CANON_DIR_POINTER = '~/.agents/canon/';

// The fence opener the wiring templates write today, and the archive section's heading.
const CURRENT_FENCE_BEGIN = fenceBegin(wiringTemplateVersion('claude-code.md'));
const ARCHIVE_HEADING = '### Archiving a global STATE line';

// The first heading that addresses agents marks the end of the human section.
const AGENT_HEADING_RE = /^#{1,6}\s.*agent/i;

/**
 * @param {string} text
 * @returns {{ cmd: string, line: string }[]} one entry per command-table row
 */
function tableRows(text) {
  /** @type {{ cmd: string, line: string }[]} */
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\| `banana ([a-z]+)/.exec(line);
    if (m) rows.push({ cmd: m[1], line });
  }
  return rows;
}

/**
 * @param {string} text
 * @param {string} heading
 * @returns {string | null} the section body on one line, or null if the heading is absent
 */
function sectionFlat(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').replace(/\s+/g, ' ');
}

/**
 * @param {string[]} args
 * @returns {string} stdout of `banana <args>`
 */
function helpOf(args) {
  return execFileSync(process.execPath, [binPath, ...args], { encoding: 'utf8' });
}

test('README.md opens by saying what banana does', () => {
  const text = readFileSync(readmePath, 'utf8');
  const firstLine = text.split('\n', 1)[0];
  assert.ok(/continuity/i.test(firstLine), 'first line must say what banana does');
});

test('README.md carries the canonical npx one-liner', () => {
  const text = readFileSync(readmePath, 'utf8');
  assert.ok(text.includes(NPX_COMMAND), `README.md missing install command: "${NPX_COMMAND}"`);
});

test('README.md command table has exactly one row per CLI command, and the state row names every state verb', () => {
  const rows = tableRows(readFileSync(readmePath, 'utf8'));
  const words = rows.map((r) => r.cmd);
  const missing = COMMANDS.filter((c) => !words.includes(c));
  const unknown = words.filter((w) => !COMMANDS.includes(w));
  const duplicated = words.filter((w, i) => words.indexOf(w) !== i);
  assert.deepEqual(missing, [], 'commands without a table row');
  assert.deepEqual(unknown, [], 'table rows for non-commands');
  assert.deepEqual(duplicated, [], 'commands with more than one table row');
  const stateRow = rows.find((r) => r.cmd === 'state');
  assert.ok(stateRow, 'state row present');
  const firstCell = stateRow.line.split(' | ')[0];
  for (const verb of STATE_VERBS) {
    assert.ok(firstCell.includes(verb), `state row's first cell names verb "${verb}": ${firstCell}`);
  }
});

test('README.md command table sits under a Commands heading with no count', () => {
  const lines = readFileSync(readmePath, 'utf8').split(/\r?\n/);
  const tableAt = lines.findIndex((l) => l.startsWith('| Command |'));
  assert.notEqual(tableAt, -1, 'command table header present');
  let heading = null;
  for (let i = tableAt - 1; i >= 0; i--) {
    if (/^#{1,6}\s/.test(lines[i])) {
      heading = lines[i];
      break;
    }
  }
  assert.ok(heading, 'a heading sits above the command table');
  assert.match(heading, /command/i);
  assert.doesNotMatch(
    heading,
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/i,
  );
});

test("README.md command rows list every flag their command's --help usage names", () => {
  const rows = tableRows(readFileSync(readmePath, 'utf8'));
  for (const cmd of COMMANDS) {
    let usage = helpOf([cmd, '--help']);
    if (cmd === 'state') {
      for (const verb of STATE_VERBS) {
        usage += '\n' + helpOf(['state', verb, '--help']).split('\n', 1)[0];
      }
    }
    const flags = new Set(usage.match(/--[a-z][a-z-]*/g) ?? []);
    const row = rows.find((r) => r.cmd === cmd);
    assert.ok(row, `row for ${cmd}`);
    for (const flag of flags) {
      assert.ok(
        new RegExp(`${flag}(?![a-z-])`).test(row.line),
        `README row for "banana ${cmd}" must name ${flag}`,
      );
    }
  }
});

test('README.md fence example carries the version the wiring templates write', () => {
  const text = readFileSync(readmePath, 'utf8');
  const found = text.match(/<!-- banana:begin v\d+ -->/g) ?? [];
  assert.ok(found.length > 0, 'README shows at least one fence opener');
  for (const opener of found) {
    assert.equal(opener, CURRENT_FENCE_BEGIN);
  }
});

test("README.md archive section covers --global, all six reasons (trimmed copy-only) and each reason's own clock gate", () => {
  const flat = sectionFlat(readFileSync(readmePath, 'utf8'), ARCHIVE_HEADING);
  assert.ok(flat !== null, `README has the heading "${ARCHIVE_HEADING}"`);
  assert.ok(flat.includes('`--global` is required'));
  for (const r of ARCHIVE_REASONS) {
    assert.ok(flat.includes(`\`${r}\`:`), `reason ${r} is listed`);
  }
  assert.ok(flat.includes('`trimmed`: copy only. The page is left as it is'));
  for (const [reason, { keyword, limit }] of Object.entries(CLOCK_GATES)) {
    assert.match(
      flat,
      new RegExp(
        `\`${reason}\`: [^\`]*\`\\(${keyword} YYYY-MM-DD\\)\` stamp is more than ${limit} days`,
      ),
      `${reason} carries its own clock gate`,
    );
  }
});

test('README.md documents the bare `banana version` subcommand', () => {
  assert.ok(readFileSync(readmePath, 'utf8').includes('`banana version`'));
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

test('banana --version prints the package version', () => {
  const out = execFileSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), pkg.version);
});

test('README doctor and sync rows name the right refresh commands (#19, #25, #26)', () => {
  const rows = tableRows(readFileSync(readmePath, 'utf8'));
  const doctor = rows.find((row) => row.cmd === 'doctor')?.line ?? '';
  const sync = rows.find((row) => row.cmd === 'sync')?.line ?? '';
  for (const phrase of ['`banana sync`', '`banana init --harnesses <id>`', '`banana project`']) {
    assert.ok(doctor.includes(phrase), `the doctor row names ${phrase}`);
  }
  for (const phrase of [
    'home wiring fence',
    '`banana project`',
    'a block with no owner/tag line is skipped',
  ]) {
    assert.ok(sync.includes(phrase), `the sync row names ${phrase}`);
  }
  const prose = readFileSync(readmePath, 'utf8').replace(/\s+/g, ' ');
  assert.ok(
    prose.includes(
      "re-applies any stale wiring block in a home instruction file (`banana project` refreshes a project's `AGENTS.md`)",
    ),
    'the sync paragraph says one block, home file, and points project files at banana project',
  );
  assert.ok(!prose.includes('re-applies any stale wiring blocks'), 'the plural overclaim is gone');
});

test('README fence paragraph says sync skips a block with no identity line and names the init remedy (#26)', () => {
  const prose = readFileSync(readmePath, 'utf8').replace(/\s+/g, ' ');
  assert.ok(
    prose.includes(
      'A block with no identity line is skipped (`sync` never invents one); `banana doctor` then names `banana init --harnesses <id>`.',
    ),
    'the fence paragraph names the skip and the init remedy',
  );
});
