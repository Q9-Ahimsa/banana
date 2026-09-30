// Real process execution for sync's kit-update step (#6). Never throws or
// rejects: every failure mode (spawn error, non-zero exit, timeout) resolves
// to a result object so callers branch on `code`/`error`, not try/catch.
// shell: true on Windows because npm resolves to npm.cmd, which spawn cannot
// exec directly without going through a shell.
//
// makeExec is for TRUSTED, FIXED argument lists only (sync's own hardcoded
// `npm install -g ...` / `npm root -g`) — never build its args from
// untrusted or user-supplied input. On win32 it joins command+args into ONE
// string for spawn under shell:true (review S5): passing a separate args
// ARRAY together with shell:true makes Node concatenate them UNESCAPED
// (Node's own DEP0190 warning) and, more concretely, corrupts any argument
// containing a shell metacharacter (a bare `>`, even inside `=>`, is cmd.exe
// redirection). This module never re-quotes an argument that itself needs a
// space or a shell metacharacter — that risk is accepted for the two fixed
// npm invocations this module exists to run.
import { spawn } from 'node:child_process';

/**
 * @typedef {object} ExecResult
 * @property {number | null} code
 * @property {string} stdout
 * @property {string} stderr
 * @property {string} [error]
 */

/**
 * Build an exec function that runs a command to completion, capturing
 * stdout/stderr and never rejecting.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {(command: string, args?: string[]) => Promise<ExecResult>}
 */
export function makeExec({ timeoutMs = 120000 } = {}) {
  return function exec(command, args = []) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      /** @type {import('node:child_process').ChildProcess} */
      let child;
      try {
        // POSIX: real argv, no shell, and `detached: true` so the child
        // becomes its own process-group leader — required for killTree's
        // `process.kill(-pid)` below to reach the whole tree, not just this
        // one process.
        child =
          process.platform === 'win32'
            ? spawn([command, ...args].join(' '), { shell: true })
            : spawn(command, args, { detached: true });
      } catch (error) {
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      // Decode as utf8 at the stream level, not as raw Buffer chunks
      // concatenated with `+=`: a multi-byte character split across a chunk
      // boundary otherwise corrupts into U+FFFD (review S6). Node's own
      // StringDecoder, wired in via setEncoding, buffers an incomplete
      // trailing sequence until the rest of it arrives.
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killTree(child);
        resolve({ code: null, stdout, stderr, error: `timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr, error: error.message });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  };
}

/**
 * Kill a spawned command's WHOLE process tree, not just the immediate
 * child (review S2). On win32, `shell: true` makes the immediate child a
 * cmd.exe wrapper — `child.kill()` only ever terminates that wrapper,
 * leaving whatever it launched (e.g. npm, then node) running orphaned.
 * win32: `taskkill /T /F` walks the tree by PID. POSIX: the child was
 * spawned `detached: true`, making it its own process-group leader —
 * killing `-pid` signals the whole group.
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      tk.unref();
    } catch {
      // best effort — the timeout result above is returned regardless
    }
  } else {
    try {
      process.kill(-child.pid);
    } catch {
      try {
        child.kill();
      } catch {
        // best effort
      }
    }
  }
}
