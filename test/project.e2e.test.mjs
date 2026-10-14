// US-005 acceptance: the project command initializes a workspace for
// continuity — LOGBOOK.md (header block + TYPE vocabulary), STATE.md (all six
// sections), .agents/session.log seed, and the fenced AGENTS.md wiring block.
// Topic-grain: a non-git dir proceeds with a not-version-controlled note (no
// --force); owner resolution shares init's inference order (flag, git config,
// TTY prompt) and its non-TTY fail-fast. Temp-dir e2e: files created with
// required sections, re-run idempotent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { parseProjectArgs, runProject } from '../lib/project.mjs';
import { fenceBegin, FENCE_END } from '../lib/fence.mjs';
import { renderWiringTemplate, wiringTemplateVersion } from '../lib/wiring.mjs';

/** Fence version the current agents-md wiring template declares. */
const CURRENT_FENCE = wiringTemplateVersion('agents-md.md');

/** @param {string} s @returns {string} s with every line ending CRLF */
const asCrlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

// A real v3 agents-md block (placeholders alpha / owner-x), as the v3 kit rendered it.
const V3_AGENTS_MD_BLOCK = `<!-- banana:begin v3 -->
## Continuity bootstrap (banana)

- **Identity:** you are \`alpha\`; owner: \`owner-x\`. Sign every entry
  you author with your tag.
- **Protocol authority:** \`~/.agents/canon/\` — the harness-neutral continuity
  protocol shared by every agent and human on this machine (CONTINUITY.md,
  STANDARD.md, SESSION-LOG.md). All rules live behind this pointer, never in
  this block; on conflict, the canon wins. Read CONTINUITY.md before your
  first entry.
- **Kit:** \`banana <command>\` (commands: init · project · brief · doctor ·
  sync · log · state lint). Install once:
  \`npm install -g github:Q9-Ahimsa/banana\`; then \`banana sync\` updates the
  kit and refreshes this block. Not installed yet? Prefix
  \`npx --yes github:Q9-Ahimsa/banana\` instead. Kits can drift between
  machines: the brief prints the kit version, and \`banana doctor\` warns when
  a newer one exists.
- **Self-setup:** if this workspace (git repo or non-code topic dir) lacks
  continuity files, initialize it yourself per the canon's agent bootstrap
  section: run \`banana project\` from the workspace root.
- **Session ritual:** read \`~/.agents/STATE.md\` first (machine grain — the
  brief does not carry it), then your brief
  (\`banana brief <feature> --tag alpha\`);
  end by closing your log entry with an owned \`NEXT:\` (\`banana log close\`).
<!-- banana:end -->`;

/** @returns {string} a fresh temp dir, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-project-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @returns {string} a temp dir that looks like a git repo */
function repoSandbox(t) {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.git'));
  return dir;
}

/**
 * Scripted IO: canned prompt answers, captured output.
 * @param {string[]} [answers]
 */
function scriptedIo(answers = []) {
  const queue = [...answers];
  /** @type {string[]} */
  const lines = [];
  return {
    lines,
    io: {
      out: (line = '') => lines.push(line),
      prompt: async (/** @type {string} */ question) => {
        if (queue.length === 0) throw new Error(`unexpected prompt: ${question}`);
        return queue.shift() ?? '';
      },
    },
  };
}

/**
 * Snapshot every file under root: relative path -> content bytes.
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
function snapshot(root) {
  const files = new Map();
  const walk = (/** @type {string} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return files;
}

/**
 * @param {Map<string, Buffer>} a
 * @param {Map<string, Buffer>} b
 */
function assertTreesIdentical(a, b) {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'same file set');
  for (const [path, bytes] of a) {
    const other = b.get(path);
    assert.ok(other && other.equals(bytes), `${path} must be byte-identical`);
  }
}

const NOTE = 'not version controlled';
const FLAGS = { owner: 'Test Owner', tag: 'test-agent', yes: true };

test('parseProjectArgs: parses all flags', () => {
  const flags = parseProjectArgs(['--owner', 'Ada', '--tag', 'claude', '--yes']);
  assert.deepEqual(flags, { owner: 'Ada', tag: 'claude', yes: true });
});

test('parseProjectArgs: rejects unknown options and missing values', () => {
  assert.throws(() => parseProjectArgs(['--bogus']), /unknown project option/);
  assert.throws(() => parseProjectArgs(['--owner']), /--owner requires a value/);
});

test('parseProjectArgs: --force is gone', () => {
  assert.throws(() => parseProjectArgs(['--force']), /unknown project option '--force'/);
});

test('e2e: fresh run in a git repo creates all continuity files, no note', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(FLAGS, { cwd: repo, io: scripted.io });
  assert.equal(result.code, 0);

  const projectName = basename(repo);
  const logbook = readFileSync(join(repo, 'LOGBOOK.md'), 'utf8');
  assert.match(logbook, /^# LOGBOOK/, 'LOGBOOK.md header block');
  assert.ok(logbook.includes(`# LOGBOOK — ${projectName}`), 'title carries the dir basename');
  assert.ok(!logbook.includes('(project)'), 'no project-name placeholder residue');
  assert.match(logbook, /TYPE vocabulary/, 'declared TYPE vocabulary');
  assert.match(logbook, /SESSION · DECISION · MILESTONE/, 'TYPE vocabulary entries');
  assert.match(logbook, /\{actor\} \{stream\}\.\{n\}/, 'envelope spec');

  const state = readFileSync(join(repo, 'STATE.md'), 'utf8');
  for (const section of ['## Now', '## Truths', '## Next', '## Blocked', '## Watch', '## Dead ends']) {
    assert.ok(state.includes(section), `STATE.md must contain '${section}'`);
  }
  assert.ok(state.includes(`# STATE — ${projectName}`), 'STATE.md title carries the dir basename');
  assert.ok(!state.includes('(project)'), 'no project-name placeholder residue in STATE.md');
  assert.ok(state.includes('Test Owner'), 'STATE.md carries the owner');
  assert.ok(!state.includes('__OWNER__'), 'no placeholder residue');

  const seed = readFileSync(join(repo, '.agents', 'session.log'), 'utf8');
  assert.match(seed, /Session Log v2/, 'session.log seed header');
  assert.match(seed, /APPROACH:/, 'seed documents the entry protocol');

  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(fenceBegin(CURRENT_FENCE)), 'AGENTS.md carries the begin marker');
  assert.ok(agents.includes(FENCE_END), 'AGENTS.md carries the end marker');
  assert.ok(agents.includes('test-agent'), 'wiring block carries the agent tag');
  assert.ok(!agents.includes('__AGENT_TAG__'), 'no placeholder residue');

  assert.equal(result.created.length, 3, 'LOGBOOK.md, STATE.md, session.log reported created');
  assert.equal(result.wired?.created, true);
  assert.ok(!scripted.lines.join('\n').includes(NOTE), 'no note inside a git repo');
});

test('e2e: a non-git dir proceeds with a not-version-controlled note', async (t) => {
  const dir = sandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(FLAGS, { cwd: dir, io: scripted.io });
  assert.equal(result.code, 0);
  for (const file of ['LOGBOOK.md', 'STATE.md', 'AGENTS.md', join('.agents', 'session.log')]) {
    assert.ok(snapshot(dir).has(file), `${file} created in a non-git dir`);
  }
  assert.ok(scripted.lines.join('\n').includes(NOTE), 'note present in output');
});

test('e2e: a second run exits 0 with a byte-identical tree', async (t) => {
  const repo = repoSandbox(t);
  const first = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(first.code, 0);

  const before = snapshot(repo);
  const second = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(second.code, 0);
  assert.deepEqual(second.created, [], 'nothing newly created on re-run');
  assert.equal(second.wired?.changed, false, 'fence already current');
  assertTreesIdentical(before, snapshot(repo));
});

test('e2e: re-run in a non-git dir is idempotent too', async (t) => {
  const dir = sandbox(t);
  const first = await runProject(FLAGS, { cwd: dir, io: scriptedIo().io });
  assert.equal(first.code, 0);

  const before = snapshot(dir);
  const second = await runProject(FLAGS, { cwd: dir, io: scriptedIo().io });
  assert.equal(second.code, 0);
  assert.deepEqual(second.created, [], 'nothing newly created on re-run');
  assertTreesIdentical(before, snapshot(dir));
});

test('e2e: existing files are never overwritten; AGENTS.md content outside the fence survives', async (t) => {
  const repo = repoSandbox(t);
  writeFileSync(join(repo, 'LOGBOOK.md'), '# my existing logbook\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Repo instructions\n\nHand-written content.\n');

  const result = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(join(repo, 'LOGBOOK.md'), 'utf8'), '# my existing logbook\n');

  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Repo instructions\n\nHand-written content.\n'), 'user content preserved');
  assert.ok(agents.includes(fenceBegin(CURRENT_FENCE)) && agents.includes(FENCE_END), 'fence appended');
});

test('owner inference: git config user.name fills in when --owner is absent', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scripted.io, gitUserName: () => 'Git Alice' },
  );
  assert.equal(result.code, 0);
  assert.ok(scripted.lines.join('\n').includes('Git Alice (from git config user.name)'), 'inference reported');
  assert.ok(readFileSync(join(repo, 'STATE.md'), 'utf8').includes('Git Alice'));
});

test('interactive: owner comes from the TTY prompt when nothing is inferable', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo(['Prompted Owner']);
  const result = await runProject(
    { owner: null, tag: null, yes: false },
    { cwd: repo, io: scripted.io, isTTY: true },
  );
  assert.equal(result.code, 0);
  assert.ok(readFileSync(join(repo, 'STATE.md'), 'utf8').includes('Prompted Owner'));
});

test('non-TTY: no inferable owner exits non-zero naming --owner and --yes, writes nothing', async (t) => {
  const repo = repoSandbox(t);
  const scripted = scriptedIo();
  const result = await runProject(
    { owner: null, tag: null, yes: false },
    { cwd: repo, io: scripted.io },
  );
  assert.notEqual(result.code, 0);
  const output = scripted.lines.join('\n');
  assert.ok(output.includes('--owner'), 'failure names --owner');
  assert.ok(output.includes('--yes'), 'failure names --yes');
  assert.deepEqual([...snapshot(repo).keys()], [], 'no files written');
});

// #16: a re-run must preserve an existing AGENTS.md fence's owner-set
// tag/owner instead of overwriting it with this run's inferred defaults.

test('e2e: re-run preserves a custom tag/owner already wired into AGENTS.md, ignoring git config', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  const first = await runProject(
    { owner: 'beta-owner', tag: 'alpha-agent', yes: true },
    { cwd: repo, io: scriptedIo().io },
  );
  assert.equal(first.code, 0);

  const scripted = scriptedIo();
  const second = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scripted.io, gitUserName: () => 'Someone Else' },
  );
  assert.equal(second.code, 0);
  assert.equal(second.wired?.changed, false, 'identical block re-applied — no change');

  const agents = readFileSync(agentsTarget, 'utf8');
  assert.ok(agents.includes('`beta-owner`'), 'owner preserved from the existing fence');
  assert.ok(agents.includes('`alpha-agent`'), 'tag preserved from the existing fence');
  assert.ok(!agents.includes('Someone Else'), 'git config must not override a preserved identity');
  assert.ok(
    scripted.lines.join('\n').includes('beta-owner (preserved from existing AGENTS.md fence)'),
    'preservation reported',
  );
});

test('e2e: project upgrades an old fence version while preserving its custom identity', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  writeFileSync(
    agentsTarget,
    [
      '# Repo notes',
      '',
      '<!-- banana:begin v1 -->',
      '## Continuity bootstrap (banana)',
      '',
      '- **Your agent tag:** `alpha-agent`. Owner: `beta-owner`. Sign every entry.',
      '<!-- banana:end -->',
      '',
    ].join('\n'),
  );

  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scriptedIo().io, gitUserName: () => 'Someone Else' },
  );
  assert.equal(result.code, 0);

  const agents = readFileSync(agentsTarget, 'utf8');
  assert.ok(agents.includes(fenceBegin(CURRENT_FENCE)), 'fence upgraded to the current version');
  assert.ok(!agents.includes(fenceBegin(1)), 'old version marker gone');
  assert.ok(agents.includes('`alpha-agent`'), 'tag preserved through the upgrade');
  assert.ok(agents.includes('`beta-owner`'), 'owner preserved through the upgrade');
  assert.ok(!agents.includes('Someone Else'), 'git config must not override a preserved identity');

  const expectedBlock = renderWiringTemplate('agents-md.md', { owner: 'beta-owner', tag: 'alpha-agent' });
  assert.ok(agents.includes(expectedBlock), 'rest of the block matches the current template verbatim');
});

test('e2e (#24, #25): project upgrades a real v3 block in a CRLF AGENTS.md — identity kept, CRLF kept, bytes outside untouched', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  writeFileSync(agentsTarget, asCrlf('# Repo notes\n\n' + V3_AGENTS_MD_BLOCK + '\n'));

  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scriptedIo().io, gitUserName: () => 'Someone Else' },
  );
  assert.equal(result.code, 0);

  const agents = readFileSync(agentsTarget, 'utf8');
  const expectedBlock = renderWiringTemplate('agents-md.md', { owner: 'owner-x', tag: 'alpha' });
  assert.equal(agents, asCrlf('# Repo notes\n\n') + asCrlf(expectedBlock) + '\r\n');
  assert.ok(agents.includes(fenceBegin(CURRENT_FENCE)), 'current opener present');
  assert.ok(!agents.includes(fenceBegin(3)), 'no v3 opener left');
  assert.ok(agents.includes('state archive'), 'roster names state archive');
  assert.ok(agents.includes('`banana project`, run in a workspace'), 'refresh wording present');
});

/**
 * A workspace holding a v3 AGENTS.md block, a STATE.md, and a session log with one line.
 * @param {import('node:test').TestContext} t
 * @param {string} logLine
 */
function deferralWorkspace(t, logLine) {
  const repo = repoSandbox(t);
  mkdirSync(join(repo, '.agents'));
  writeFileSync(join(repo, '.agents', 'session.log'), logLine + '\n');
  writeFileSync(join(repo, 'STATE.md'), '# state\n');
  writeFileSync(join(repo, 'AGENTS.md'), V3_AGENTS_MD_BLOCK + '\n');
  return repo;
}

test('e2e (#25 review): project keeps a recorded LOGBOOK.md deferral while it refreshes the block', async (t) => {
  const repo = deferralWorkspace(t, 'DECISION: defer LOGBOOK.md (owner)');
  const { io, lines } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 0);
  assert.ok(!existsSync(join(repo, 'LOGBOOK.md')), 'LOGBOOK.md was not created');
  assert.ok(readFileSync(join(repo, 'AGENTS.md'), 'utf8').includes(fenceBegin(CURRENT_FENCE)), 'current opener present');
  assert.ok(lines.some((line) => line.includes('kept LOGBOOK.md deferred')), 'output names the kept deferral');
});

test('e2e (#25 review): text about deferring outside a DECISION line does not defer LOGBOOK.md', async (t) => {
  const repo = deferralWorkspace(t, 'NOTE: we may defer LOGBOOK.md later');
  const { io } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 0);
  assert.ok(existsSync(join(repo, 'LOGBOOK.md')), 'LOGBOOK.md was created');
});

test('e2e (#25 review): a DECISION line on another topic plus a later mention of the deferral does not defer LOGBOOK.md', async (t) => {
  const repo = deferralWorkspace(t, 'DECISION: pick the shorter name\nNOTE: we may defer LOGBOOK.md later');
  const { io } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 0);
  assert.ok(existsSync(join(repo, 'LOGBOOK.md')), 'LOGBOOK.md was created');
});

test('e2e (#25 review): a recorded deferral with LOGBOOK.md already on disk prints no "kept deferred" line', async (t) => {
  const repo = deferralWorkspace(t, 'DECISION: defer LOGBOOK.md (owner)');
  writeFileSync(join(repo, 'LOGBOOK.md'), '# existing logbook\n');
  const { io, lines } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(join(repo, 'LOGBOOK.md'), 'utf8'), '# existing logbook\n');
  assert.ok(!lines.some((line) => line.includes('kept LOGBOOK.md deferred')), 'no kept-deferred line');
});

/** A workspace whose .agents/session.log is a directory: it exists, and reading it throws EISDIR. */
function unreadableLogWorkspace(t) {
  const repo = repoSandbox(t);
  const logPath = join(repo, '.agents', 'session.log');
  mkdirSync(logPath, { recursive: true });
  writeFileSync(join(repo, 'STATE.md'), '# state\n');
  writeFileSync(join(repo, 'AGENTS.md'), V3_AGENTS_MD_BLOCK + '\n');
  return { repo, logPath };
}

test('e2e (#25 review): a session log project cannot read never stops the block refresh', async (t) => {
  const { repo, logPath } = unreadableLogWorkspace(t);
  const { io, lines } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 1, 'a log project could not read fails the run, after the rest is done');
  assert.ok(readFileSync(join(repo, 'AGENTS.md'), 'utf8').includes(fenceBegin(CURRENT_FENCE)), 'AGENTS.md is refreshed');
  assert.ok(!existsSync(join(repo, 'LOGBOOK.md')), 'LOGBOOK.md is left alone');
  assert.ok(
    lines.some((line) =>
      line.startsWith(`skipped LOGBOOK.md: cannot read ${logPath} to check for a deferral (`),
    ),
    lines.join('\n'),
  );
  assert.ok(lines.includes('banana project: 1 file could not be read — see the skipped line above'), lines.join('\n'));
});

test('e2e (#25 review): with LOGBOOK.md on disk project never reads the session log', async (t) => {
  const { repo } = unreadableLogWorkspace(t);
  writeFileSync(join(repo, 'LOGBOOK.md'), '# logbook\n');
  const { io, lines } = scriptedIo();
  const result = await runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 0);
  assert.ok(readFileSync(join(repo, 'AGENTS.md'), 'utf8').includes(fenceBegin(CURRENT_FENCE)));
  assert.ok(!lines.some((line) => line.startsWith('skipped ')), lines.join('\n'));
  assert.equal(readFileSync(join(repo, 'LOGBOOK.md'), 'utf8'), '# logbook\n');
});

test('e2e (#25 review): an unreadable session log still creates a missing STATE.md, and the skip lines go to stderr', async (t) => {
  const repo = repoSandbox(t);
  const logPath = join(repo, '.agents', 'session.log');
  mkdirSync(logPath, { recursive: true });
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const io = {
    out: (/** @type {string} */ line = '') => out.push(line),
    err: (/** @type {string} */ line = '') => err.push(line),
    prompt: async () => {
      throw new Error('unexpected prompt');
    },
  };
  const result = await runProject({ owner: 'alice', tag: 'alpha', yes: true }, { cwd: repo, io, gitUserName: () => null });
  assert.equal(result.code, 1);
  assert.ok(existsSync(join(repo, 'STATE.md')), 'STATE.md is created');
  assert.ok(!existsSync(join(repo, 'LOGBOOK.md')), 'LOGBOOK.md is left alone');
  assert.ok(
    err.some((line) => line.startsWith(`skipped LOGBOOK.md: cannot read ${logPath} to check for a deferral (`)),
    err.join('\n'),
  );
  assert.ok(err.includes('banana project: 1 file could not be read — see the skipped line above'), err.join('\n'));
  assert.ok(!out.some((line) => line.startsWith('skipped ') || line.startsWith('banana project: 1 file')), out.join('\n'));
});

test('e2e: explicit --owner/--tag flags win over a preserved identity', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  const first = await runProject(
    { owner: 'beta-owner', tag: 'alpha-agent', yes: true },
    { cwd: repo, io: scriptedIo().io },
  );
  assert.equal(first.code, 0);

  const second = await runProject(
    { owner: 'Override Owner', tag: 'override-agent', yes: true },
    { cwd: repo, io: scriptedIo().io },
  );
  assert.equal(second.code, 0);

  const agents = readFileSync(agentsTarget, 'utf8');
  assert.ok(agents.includes('`Override Owner`'), 'explicit --owner wins over the preserved owner');
  assert.ok(agents.includes('`override-agent`'), 'explicit --tag wins over the preserved tag');
  assert.ok(!agents.includes('beta-owner'), 'preserved owner replaced by the override');
  assert.ok(!agents.includes('alpha-agent'), 'preserved tag replaced by the override');
});

test('e2e: fresh workspace has no fence to preserve — current default behavior applies', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scriptedIo().io, gitUserName: () => 'Git Alice' },
  );
  assert.equal(result.code, 0);
  const agents = readFileSync(agentsTarget, 'utf8');
  assert.ok(agents.includes('`Git Alice`'), 'no preserved identity — falls through to git config inference');
  assert.ok(agents.includes('`<agent-tag>`'), 'no preserved identity — falls through to the default tag');
});

test('e2e: an AGENTS.md fence whose identity line cannot be parsed falls back to current behavior with one warning', async (t) => {
  const repo = repoSandbox(t);
  const agentsTarget = join(repo, 'AGENTS.md');
  const content = '<!-- banana:begin v1 -->\nno identity line here\n<!-- banana:end -->\n';
  writeFileSync(agentsTarget, content);
  const scripted = scriptedIo();

  const result = await runProject(
    { owner: null, tag: null, yes: true },
    { cwd: repo, io: scripted.io, gitUserName: () => 'Fallback Owner' },
  );
  assert.equal(result.code, 0);

  const agents = readFileSync(agentsTarget, 'utf8');
  assert.ok(agents.includes('`Fallback Owner`'), 'falls back to normal owner inference');
  assert.ok(agents.includes('`<agent-tag>`'), 'falls back to the default tag placeholder');

  const warnings = scripted.lines.filter(
    (line) => line.includes(agentsTarget) && /cannot recover/i.test(line),
  );
  assert.equal(warnings.length, 1, 'exactly one warning line naming the file');
});

test('e2e: a filesystem error mid-run fails gracefully instead of throwing', async (t) => {
  const repo = repoSandbox(t);
  // Occupy .agents with a plain file so mkdirSync(agentsDir, ...) throws
  // instead of creating the directory — the audit's reproduction scenario.
  writeFileSync(join(repo, '.agents'), 'not a directory');
  const scripted = scriptedIo();
  const result = await runProject(FLAGS, { cwd: repo, io: scripted.io });
  assert.equal(result.code, 1, 'returns a failure code instead of throwing');
  assert.ok(
    scripted.lines.some((line) => line.startsWith('banana project:')),
    'graceful "banana project: <message>" line printed, not a raw stack trace',
  );
});

test('#19: a CRLF project AGENTS.md already carrying the current block reports (already current)', async (t) => {
  const repo = repoSandbox(t);
  const first = await runProject(FLAGS, { cwd: repo, io: scriptedIo().io });
  assert.equal(first.code, 0);
  const agentsPath = join(repo, 'AGENTS.md');
  const crlf = asCrlf(readFileSync(agentsPath, 'utf8'));
  writeFileSync(agentsPath, crlf);

  const scripted = scriptedIo();
  const second = await runProject(FLAGS, { cwd: repo, io: scripted.io });
  assert.equal(second.code, 0);
  assert.equal(second.wired?.changed, false);
  const wiredLine = scripted.lines.find((line) => line.startsWith('wired AGENTS.md'));
  assert.ok(wiredLine?.includes('(already current)'), `got: ${wiredLine}`);
  assert.equal(readFileSync(agentsPath, 'utf8'), crlf, 'bytes unchanged');
});
