// bin e2e: subprocess-level coverage of bin/banana.mjs's own dispatch logic
// (flag-free `version`, per-subcommand --help/-h, top-level help/no-arg, and
// a real `project` run through the compiled binary) — behavior the unit
// tests for lib/*.mjs can't see because it lives in the dispatcher itself.
// npx shadows --version/-v/--help/-h globally, so `version` (a bare word) is
// the only reliable version probe under npx; per-subcommand --help/-h used to
// fall through to each parser's 'unknown option' error before this slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../bin/banana.mjs', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync', 'log', 'state'];

/**
 * Run the bin as a subprocess, never throwing on a non-zero exit.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(args, opts = {}) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {import('node:test').TestContext} t
 * @param {string} prefix
 * @returns {string} a fresh temp dir, cleaned up when the test ends
 */
function sandbox(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bin: bare `version` subcommand prints the package version and exits 0', () => {
  const { status, stdout } = run(['version']);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('bin: --version and -v still print the package version and exit 0 (regression)', () => {
  for (const flag of ['--version', '-v']) {
    const { status, stdout } = run([flag]);
    assert.equal(status, 0, `${flag} exits 0`);
    assert.equal(stdout.trim(), pkg.version, `${flag} prints the version`);
  }
});

test('bin: every subcommand accepts --help and -h with a usage string, not an option error', () => {
  for (const cmd of COMMANDS) {
    for (const flag of ['--help', '-h']) {
      const { status, stdout, stderr } = run([cmd, flag]);
      assert.equal(status, 0, `${cmd} ${flag} exits 0`);
      assert.ok(stdout.startsWith(`Usage: banana ${cmd}`), `${cmd} ${flag} prints usage: ${stdout}`);
      assert.equal(stderr, '', `${cmd} ${flag} writes nothing to stderr`);
      assert.ok(!stdout.includes('unknown'), `${cmd} ${flag} is not the unknown-option error`);
    }
  }
});

test('bin: top-level --help and -h exit 0 and list all seven commands', () => {
  for (const flag of ['--help', '-h']) {
    const { status, stdout } = run([flag]);
    assert.equal(status, 0, `${flag} exits 0`);
    for (const cmd of COMMANDS) {
      assert.ok(stdout.includes(cmd), `${flag} output names ${cmd}`);
    }
  }
});

test('bin: no-arg invocation exits 1', () => {
  const { status } = run([]);
  assert.equal(status, 1);
});

test('bin: unknown command exits non-zero', () => {
  const { status, stderr } = run(['peel']);
  assert.notEqual(status, 0);
  assert.ok(stderr.includes("unknown command 'peel'"));
});

// Dispatch-only slices: the log arm does POSITIONAL --help/-h detection
// (argv[0]/argv[1] of the slice after 'log'), not maybeSubHelp, and behavior
// itself lives at the lib/log.mjs seam (covered by test/log.test.mjs) — these
// three just prove the bin wires the verb dispatch and exit codes correctly.
test('bin: bare `banana log` prints usage to stderr and exits 1', () => {
  const { status, stdout, stderr } = run(['log']);
  assert.equal(status, 1);
  assert.equal(stdout, '');
  assert.ok(stderr.includes('Usage: banana log'), `stderr carries usage: ${stderr}`);
});

test('bin: `banana log stub --help` prints stub usage and exits 0', () => {
  const { status, stdout, stderr } = run(['log', 'stub', '--help']);
  assert.equal(status, 0);
  assert.ok(stdout.startsWith('Usage: banana log stub'), `stdout: ${stdout}`);
  assert.equal(stderr, '');
});

test('bin: `banana log <unknown verb>` exits 1 naming the vocabulary', () => {
  const { status, stderr } = run(['log', 'frobnicate']);
  assert.equal(status, 1);
  assert.ok(
    stderr.includes("unknown log verb 'frobnicate' (expected stub|append|close|supersede)"),
    `stderr: ${stderr}`,
  );
});

// Dispatch-only slices: the state arm does POSITIONAL --help/-h detection
// (mirrors log's arm), and its usage-error exit code is 2, not 1 — the
// contract distinguishes usage errors from any FAIL finding (exit 1).
// Behavior itself lives at the lib/state.mjs seam (test/state.test.mjs).
test('bin: bare `banana state` prints usage to stderr and exits 2', () => {
  const { status, stdout, stderr } = run(['state']);
  assert.equal(status, 2);
  assert.equal(stdout, '');
  assert.ok(stderr.includes('Usage: banana state'), `stderr carries usage: ${stderr}`);
});

test('bin: `banana state lint --help` prints lint usage and exits 0', () => {
  const { status, stdout, stderr } = run(['state', 'lint', '--help']);
  assert.equal(status, 0);
  assert.ok(stdout.startsWith('Usage: banana state lint'), `stdout: ${stdout}`);
  assert.equal(stderr, '');
});

test('bin: `banana state <unknown verb>` exits 2 naming the vocabulary', () => {
  const { status, stderr } = run(['state', 'frobnicate']);
  assert.equal(status, 2);
  assert.ok(stderr.includes("unknown state verb 'frobnicate' (expected lint)"), `stderr: ${stderr}`);
});

test('bin: `banana state lint --global` runs against a sandboxed home (env HOME/USERPROFILE) and exits 0 on a clean global page', (t) => {
  const home = sandbox(t, 'banana-bin-state-global-');
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(
    join(home, '.agents', 'STATE.md'),
    [
      '# GLOBAL STATE — cross-project projection',
      '> One page, hard cap. Rebuilt whole, never patched. Chronology lives in project',
      '> logbooks; this file only answers "what\'s live and what\'s queued across',
      '> everything." Owner: testagent. Protocol: `~/.agents/canon/CONTINUITY.md`.',
      '',
      '## Active threads',
      '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)',
      '',
      '## Backlog (owned)',
      '- (queued cross-project items, each owned: `testagent — action` or an agent tag)',
      '',
      '## Watch',
      '- (assumptions and deadlines needing attention, each with a validate-by date)',
      '',
      '## Recently closed (context for next session)',
      '- (last few finished threads, one line each, with pointers)',
      '',
    ].join('\n'),
    'utf8',
  );
  const { status, stdout } = run(['state', 'lint', '--global'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(status, 0, `stdout: ${stdout}`);
  assert.equal(stdout.trim(), 'state lint: PASS');
});

test('bin: `banana state lint --global` exits 2 when the target is missing', (t) => {
  const home = sandbox(t, 'banana-bin-state-global-missing-');
  const { status, stderr } = run(['state', 'lint', '--global'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(status, 2);
  assert.ok(stderr.includes('missing or unreadable'), `stderr: ${stderr}`);
});

test('bin: `banana state lint` against a real STATE.md prints a verdict and exits 0', (t) => {
  const cwd = sandbox(t, 'banana-bin-state-');
  writeFileSync(
    join(cwd, 'STATE.md'),
    [
      '# STATE — widget',
      '> Projection of LOGBOOK.md as of (date) (through none). Logbook wins',
      '> on conflict. One page, hard cap. Rebuilt at session close; mid-arc',
      '> section patches are legal and must carry the dirty-marker line.',
      '',
      '## Now',
      '- (current focus, 1–3 lines)',
      '',
      '## Truths',
      '- (decisions in force, one line each + logbook id — pointers, not rationale)',
      '',
      '## Next',
      '- testagent — ship it',
      '',
      '## Blocked',
      '- (what, on whom/what, since when)',
      '',
      '## Watch',
      '- (assumptions needing validation, each with a validate-by date)',
      '',
      '## Dead ends',
      '- (approaches tried and abandoned, one line each + why, or an entry pointer)',
      '',
    ].join('\n'),
    'utf8',
  );
  const { status, stdout } = run(['state', 'lint'], { cwd });
  assert.equal(status, 0);
  assert.equal(stdout.trim(), 'state lint: PASS');
});

test('bin: `banana state lint` exits 2 when STATE.md is missing', (t) => {
  const cwd = sandbox(t, 'banana-bin-state-');
  const { status, stderr } = run(['state', 'lint'], { cwd });
  assert.equal(status, 2);
  assert.ok(stderr.includes('missing or unreadable'), `stderr: ${stderr}`);
});

// #14 dispatch-only slice: the section content itself is covered by
// test/brief.test.mjs (lib/brief.mjs) — this just proves bin.mjs threads a
// real `home` (env HOME/USERPROFILE, same override other state-lint e2e
// tests above use) into `runBrief` end to end.
test('bin: `banana brief` output contains a `## State lint` section', (t) => {
  const home = sandbox(t, 'banana-bin-brief-home-');
  const cwd = sandbox(t, 'banana-bin-brief-');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const project = run(['project', '--owner', 'Bin Brief Owner', '--yes'], { cwd, env });
  assert.equal(project.status, 0, `project setup failed: ${project.stderr}`);
  const stub = run(
    ['log', 'stub', 'cli', '--tag', 'testagent', '--phase', 'build', '--title', 'x', '--approach', 'a'],
    { cwd, env },
  );
  assert.equal(stub.status, 0, `stub setup failed: ${stub.stderr}`);
  const { status, stdout } = run(['brief', 'cli', '--tag', 'testagent'], { cwd, env });
  assert.equal(status, 0, `stdout: ${stdout}`);
  assert.ok(stdout.includes('## State lint'), `expected a State lint section: ${stdout}`);
});

// C1: parseLogArgs' own parse-shape errors are already self-identifying
// ("banana log append: missing <feature>", "banana log supersede: missing
// ..."). The log arm's catch used to unconditionally prepend its own
// generic "banana log: " prefix, producing a doubled, confusing
// "banana log: banana log append: missing <feature>" — two occurrences of
// the "banana log" phrase in one line. Exactly one must survive.
test('bin: a parse-shape error (missing positional) is not double-prefixed with `banana log`', () => {
  const { status, stdout, stderr } = run(['log', 'append']);
  assert.equal(status, 1);
  assert.equal(stdout, '');
  assert.ok(stderr.includes('missing <feature>'), `stderr: ${stderr}`);
  const occurrences = (stderr.match(/banana log/g) ?? []).length;
  assert.equal(
    occurrences,
    1,
    `expected exactly one 'banana log' prefix, got ${occurrences}: ${JSON.stringify(stderr)}`,
  );
});

// C2: lib's dry-run path prints via `(io.write ?? io.out)(text)` (B5) so a
// raw sink can hand back the exact composed bytes. Before makeIo() grew
// `write`, the log arm's io.out was console.log — which appends its own
// trailing newline — so `--dry-run` stdout carried one extra `\n` beyond
// what a real run actually appends to disk. Prove byte-exactness at the
// process boundary: dry-run stdout must equal the literal file suffix a
// real run of the same command appends.
test('bin: `log append --dry-run` stdout is byte-identical to what a real append writes to disk', (t) => {
  const cwd = sandbox(t, 'banana-bin-dryrun-');
  mkdirSync(join(cwd, '.agents'), { recursive: true });
  const logPath = join(cwd, '.agents', 'session.log');
  writeFileSync(
    logPath,
    '# Session log — task-grain work journal (Session Log v2)\n' +
      '> Append-only. Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`\n',
    'utf8',
  );

  const stub = run(
    [
      'log', 'stub', 'cli',
      '--tag', 'testagent',
      '--phase', 'build',
      '--title', 'dry-run byte check',
      '--approach', 'seed an open entry to append onto',
    ],
    { cwd },
  );
  assert.equal(stub.status, 0, `stub setup failed: ${stub.stderr}`);

  const before = readFileSync(logPath, 'utf8');

  const dry = run(
    [
      'log', 'append', 'cli',
      '--tag', 'testagent',
      '--body', 'FILES: lib/x.mjs',
      '--body', 'VALIDATED: 3 tests green',
      '--dry-run',
    ],
    { cwd },
  );
  assert.equal(dry.status, 0, `dry-run append failed: ${dry.stderr}`);
  assert.equal(readFileSync(logPath, 'utf8'), before, 'dry-run must not touch the file');

  const real = run(
    [
      'log', 'append', 'cli',
      '--tag', 'testagent',
      '--body', 'FILES: lib/x.mjs',
      '--body', 'VALIDATED: 3 tests green',
    ],
    { cwd },
  );
  assert.equal(real.status, 0, `real append failed: ${real.stderr}`);
  const after = readFileSync(logPath, 'utf8');
  const appendedSuffix = after.slice(before.length);

  assert.equal(dry.stdout, appendedSuffix, 'dry-run stdout must equal exactly the appended bytes');
});

test('bin: `project --owner X --yes` in a fresh sandbox cwd creates all continuity files', (t) => {
  const home = sandbox(t, 'banana-bin-home-');
  const cwd = sandbox(t, 'banana-bin-project-');
  const { status } = run(['project', '--owner', 'Bin Test Owner', '--yes'], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(status, 0);
  assert.ok(existsSync(join(cwd, 'LOGBOOK.md')), 'LOGBOOK.md created');
  assert.ok(existsSync(join(cwd, 'STATE.md')), 'STATE.md created');
  assert.ok(existsSync(join(cwd, '.agents', 'session.log')), '.agents/session.log created');
  assert.ok(existsSync(join(cwd, 'AGENTS.md')), 'AGENTS.md created');
  assert.ok(
    readFileSync(join(cwd, 'STATE.md'), 'utf8').includes('Bin Test Owner'),
    'owner substituted into STATE.md',
  );
});
