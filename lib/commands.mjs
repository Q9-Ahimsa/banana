// The CLI's command vocabulary — every `banana <command>` word bin/banana.mjs
// dispatches, in its top-level help order. Single-sourced here, not in bin/,
// because bin/banana.mjs runs on import (it reads process.argv and dispatches
// at top level), so a test can't import a constant from it; the README drift
// tests (test/readme.test.mjs, #22) read this list. `version` is not a member:
// bin answers it (with --version/-v) before the COMMANDS guard runs.

/** @type {string[]} */
export const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync', 'log', 'state'];
