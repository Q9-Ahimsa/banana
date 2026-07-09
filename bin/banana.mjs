#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync'];
const [cmd] = process.argv.slice(2);

/** Owner inference rung shared by init and project: git config user.name. */
function gitUserName() {
  try {
    const name = execSync('git config --get user.name', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Short-circuit a subcommand to its usage string and exit 0 when --help/-h
 * is present in its argv slice. Every subcommand's own arg parser otherwise
 * throws 'unknown option' for --help/-h, since npm/npx only reserve
 * --help/-h/--version/-v at the top level, not per-subcommand.
 * @param {string[]} argv the subcommand's argv slice (after the command word)
 * @param {string} usage
 */
function maybeSubHelp(argv, usage) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(pkg.version);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h' || cmd === undefined) {
  console.log(`banana ${pkg.version} — harness-neutral continuity kit
Usage: banana <command> [options]

Commands:
  init      detect installed agent harnesses, wire the continuity protocol into each
  project   initialize a workspace (git repo or topic dir) with LOGBOOK.md, STATE.md, and .agents/session.log
  brief     compile a per-intent context brief for a session; no feature arg lists active slugs
  doctor    check wiring versions and run liveness audits
  sync      refresh the kit-owned canon and re-apply stale wiring fences

Tip: under npx, run the bare 'version' subcommand (not --version/-v) to check
the version — npm reserves those flags globally and they never reach this
script.`);
  process.exit(cmd === undefined ? 1 : 0);
}

if (!COMMANDS.includes(cmd)) {
  console.error(`banana: unknown command '${cmd}' (expected ${COMMANDS.join('|')})`);
  process.exit(1);
}

if (cmd === 'init') {
  const argv = process.argv.slice(3);
  maybeSubHelp(
    argv,
    'Usage: banana init [--owner <name>] [--tag <agent>] [--harnesses <ids>] [--yes] [--deliver]',
  );
  const { parseInitArgs, runInit } = await import('../lib/init.mjs');
  /** @type {import('../lib/init.mjs').InitFlags} */
  let flags;
  try {
    flags = parseInitArgs(argv);
  } catch (error) {
    console.error(`banana init: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  /** @type {import('node:readline/promises').Interface | null} */
  let rl = null;
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
    prompt: async (/** @type {string} */ question) => {
      if (rl === null) {
        const { createInterface } = await import('node:readline/promises');
        rl = createInterface({ input: process.stdin, output: process.stdout });
      }
      return rl.question(question);
    },
  };
  const result = await runInit(flags, {
    home: homedir(),
    io,
    isTTY: process.stdin.isTTY === true,
    gitUserName,
  });
  rl?.close();
  process.exit(result.code);
}

if (cmd === 'project') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana project [--owner <name>] [--tag <agent>] [--yes]');
  const { parseProjectArgs, runProject } = await import('../lib/project.mjs');
  /** @type {import('../lib/project.mjs').ProjectFlags} */
  let flags;
  try {
    flags = parseProjectArgs(argv);
  } catch (error) {
    console.error(`banana project: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  /** @type {import('node:readline/promises').Interface | null} */
  let rl = null;
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
    prompt: async (/** @type {string} */ question) => {
      if (rl === null) {
        const { createInterface } = await import('node:readline/promises');
        rl = createInterface({ input: process.stdin, output: process.stdout });
      }
      return rl.question(question);
    },
  };
  const result = await runProject(flags, {
    cwd: process.cwd(),
    io,
    isTTY: process.stdin.isTTY === true,
    gitUserName,
  });
  rl?.close();
  process.exit(result.code);
}

if (cmd === 'brief') {
  const argv = process.argv.slice(3);
  maybeSubHelp(
    argv,
    'Usage: banana brief [feature] --tag <agent>\n  no feature: list active slugs (discovery mode)',
  );
  const { parseBriefArgs, runBrief } = await import('../lib/brief.mjs');
  /** @type {import('../lib/brief.mjs').BriefArgs} */
  let flags;
  try {
    flags = parseBriefArgs(argv);
  } catch (error) {
    console.error(`banana brief: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
  };
  const result = await runBrief(flags, { cwd: process.cwd(), io });
  process.exit(result.code);
}

if (cmd === 'doctor') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana doctor [--verify]');
  const { parseDoctorArgs, runDoctor } = await import('../lib/doctor.mjs');
  /** @type {import('../lib/doctor.mjs').DoctorFlags} */
  let flags;
  try {
    flags = parseDoctorArgs(argv);
  } catch (error) {
    console.error(`banana doctor: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
  };
  const result = await runDoctor(flags, { cwd: process.cwd(), home: homedir(), io });
  process.exit(result.code);
}

if (cmd === 'sync') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana sync');
  const { parseSyncArgs, runSync } = await import('../lib/sync.mjs');
  /** @type {import('../lib/sync.mjs').SyncFlags} */
  let flags;
  try {
    flags = parseSyncArgs(argv);
  } catch (error) {
    console.error(`banana sync: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
  };
  const result = await runSync(flags, { home: homedir(), io });
  process.exit(result.code);
}

// Unreachable: the COMMANDS guard above already rejects anything not in the
// five-command vocabulary, and every member of COMMANDS has a dispatch arm
// above that exits. This is an internal-invariant guard — if it ever fires,
// a COMMANDS entry was added without a matching dispatch arm.
console.error(`banana: internal error — no dispatch arm for '${cmd}'`);
process.exit(1);
