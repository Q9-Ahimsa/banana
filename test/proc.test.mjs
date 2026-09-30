// #6 A: makeExec is the real process runner behind sync's kit-update step.
// It must never throw or reject — every failure mode (spawn error, non-zero
// exit, timeout) resolves to a result object so callers branch on
// `code`/`error`, not try/catch. The REAL makeExec is exercised only against
// a harmless local command (`node --version`) and a command that does not
// exist — no network, ever. makeExec is documented for trusted, FIXED
// argument lists only (review S5) — every script this file spawns via
// `node -e` is written with zero spaces in the argument text, sidestepping
// the win32 single-command-string join's lack of re-quoting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeExec } from '../lib/proc.mjs';

test('makeExec: a harmless local command resolves code 0 with stdout starting "v"', async () => {
  const exec = makeExec();
  const result = await exec('node', ['--version']);
  assert.equal(result.code, 0);
  assert.equal(result.error, undefined);
  assert.ok(result.stdout.trim().startsWith('v'), `stdout must start with 'v': ${JSON.stringify(result.stdout)}`);
});

test('makeExec: a command that does not exist resolves (never rejects/throws) with a non-zero code or an error', async () => {
  const exec = makeExec();
  const result = await exec('banana-definitely-not-a-real-command-xyz');
  assert.ok(result.code !== 0 || result.error !== undefined, 'a missing command must not report success');
});

test('makeExec: capture both stdout and stderr as strings, never undefined', async () => {
  const exec = makeExec();
  const result = await exec('node', ['--version']);
  assert.equal(typeof result.stdout, 'string');
  assert.equal(typeof result.stderr, 'string');
});

test('makeExec: each factory call is independent — concurrent execs do not interfere with each other', async () => {
  const execA = makeExec();
  const execB = makeExec();
  assert.notEqual(execA, execB);
  const [a, b] = await Promise.all([execA('node', ['--version']), execB('node', ['--version'])]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
});

test('makeExec: a very small timeout on a slow command resolves rather than hanging, with a null-ish code', async () => {
  const exec = makeExec({ timeoutMs: 1 });
  // node --version.mjs itself is fast, but a startup-heavy invocation (loading
  // a fake nonexistent module) reliably takes longer than 1ms to spawn+exit.
  // `function(){}`, not `()=>{}`: on win32 this text goes through an
  // unescaped shell join (S5) where a bare `>` is a redirect operator to
  // cmd.exe, arrow-function syntax included — every script in this file
  // avoids `=>` for that reason.
  const result = await exec('node', ['-e', 'setTimeout(function(){},500)']);
  assert.ok(result.code !== 0 || result.error !== undefined, 'a timed-out run must not report a clean 0');
});

// -----------------------------------------------------------------------
// Review S2: a timeout must kill the WHOLE process tree, not just the
// shell wrapper spawn() creates under shell:true. Proven with a genuine
// orphan check: a slow child writes a marker file past its own deadline;
// the marker path travels through an env var (inherited by the child),
// never embedded in the script text, so this test carries zero shell/argv
// quoting risk of its own.
// -----------------------------------------------------------------------
test('makeExec: a timeout kills the whole process tree — an orphaned grandchild must not survive to write its marker', async (t) => {
  const markerDir = mkdtempSync(join(tmpdir(), 'banana-proc-marker-'));
  t.after(() => rmSync(markerDir, { recursive: true, force: true }));
  const markerPath = join(markerDir, 'alive.txt');

  const previousEnv = process.env.BANANA_TEST_MARKER;
  process.env.BANANA_TEST_MARKER = markerPath;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.BANANA_TEST_MARKER;
    else process.env.BANANA_TEST_MARKER = previousEnv;
  });

  const exec = makeExec({ timeoutMs: 200 });
  // Writes the marker 1500ms in — comfortably past both the 200ms timeout
  // below and this second node.exe's own cold-start overhead — if (and
  // only if) this process is still alive at that point.
  const script =
    "setTimeout(function(){require('fs').writeFileSync(process.env.BANANA_TEST_MARKER,'alive')},1500)";
  const result = await exec('node', ['-e', script]);
  assert.ok(result.code !== 0 || result.error !== undefined, 'the run must be reported as timed out, not clean');

  // Wait well past the child's own write deadline (generous margin against
  // process-startup jitter) before checking.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(existsSync(markerPath), false, 'the child (and its descendants) must not survive the timeout');
});

// -----------------------------------------------------------------------
// Review S5: makeExec is trusted-fixed-args only, and on win32 must build
// ONE command string for spawn under shell:true — passing a separate args
// ARRAY together with shell:true is what triggers Node's DEP0190 warning
// (unescaped concatenation).
// -----------------------------------------------------------------------
test('makeExec: no DEP0190 deprecation warning is emitted', () => {
  // Node dedupes each deprecation code once per process, so this can only be
  // observed reliably in a FRESH subprocess — any earlier test in this file
  // (or run order) could otherwise mask a real regression.
  const procUrl = new URL('../lib/proc.mjs', import.meta.url).href;
  const script =
    `import(${JSON.stringify(procUrl)}).then((m) => m.makeExec()('node', ['--version']))` +
    `.then((r) => process.exit(r.code === 0 ? 0 : 1));`;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, `subprocess must complete cleanly: ${child.stderr}`);
  assert.ok(!child.stderr.includes('DEP0190'), `no DEP0190 warning expected, got stderr: ${child.stderr}`);
});

// -----------------------------------------------------------------------
// Review S6: stdout/stderr must be decoded as utf8 streams, not raw Buffer
// concatenation — otherwise a multi-byte character split across a chunk
// boundary corrupts into U+FFFD. 400k em dashes (1.2MB of 3-byte sequences)
// reliably straddles at least one chunk boundary.
// -----------------------------------------------------------------------
test('makeExec: stdout captures multi-byte UTF-8 correctly across chunk boundaries (no U+FFFD)', async () => {
  const exec = makeExec();
  const script = "process.stdout.write('\\u2014'.repeat(400000))";
  const result = await exec('node', ['-e', script]);
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes('�'), 'stdout must contain no U+FFFD replacement characters');
  assert.equal(result.stdout.length, 400000, 'every em dash must survive, none dropped or merged');
});
