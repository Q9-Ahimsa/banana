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

if (cmd === '--version' || cmd === '-v') {
  console.log(pkg.version);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h' || cmd === undefined) {
  console.log(`banana ${pkg.version} — harness-neutral continuity kit
Usage: banana <command> [options]

Commands:
  init      detect installed agent harnesses, wire the continuity protocol into each
  project   initialize a repo with LOGBOOK.md, STATE.md, and .agents/session.log
  brief     compile a per-intent context brief for a session (feature-scoped)
  doctor    check wiring versions and run liveness audits
  sync      refresh the kit-owned canon and re-apply stale wiring fences`);
  process.exit(cmd === undefined ? 1 : 0);
}

if (!COMMANDS.includes(cmd)) {
  console.error(`banana: unknown command '${cmd}' (expected ${COMMANDS.join('|')})`);
  process.exit(1);
}

if (cmd === 'init') {
  const { parseInitArgs, runInit } = await import('../lib/init.mjs');
  /** @type {import('../lib/init.mjs').InitFlags} */
  let flags;
  try {
    flags = parseInitArgs(process.argv.slice(3));
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
    gitUserName: () => {
      try {
        const name = execSync('git config --get user.name', {
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
        return name || null;
      } catch {
        return null;
      }
    },
  });
  rl?.close();
  process.exit(result.code);
}

if (cmd === 'project') {
  const { parseProjectArgs, runProject } = await import('../lib/project.mjs');
  /** @type {import('../lib/project.mjs').ProjectFlags} */
  let flags;
  try {
    flags = parseProjectArgs(process.argv.slice(3));
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
  const result = await runProject(flags, { cwd: process.cwd(), io });
  rl?.close();
  process.exit(result.code);
}

if (cmd === 'brief') {
  const { parseBriefArgs, runBrief } = await import('../lib/brief.mjs');
  /** @type {import('../lib/brief.mjs').BriefFlags} */
  let flags;
  try {
    flags = parseBriefArgs(process.argv.slice(3));
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
  const { parseDoctorArgs, runDoctor } = await import('../lib/doctor.mjs');
  /** @type {import('../lib/doctor.mjs').DoctorFlags} */
  let flags;
  try {
    flags = parseDoctorArgs(process.argv.slice(3));
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
  const { parseSyncArgs, runSync } = await import('../lib/sync.mjs');
  /** @type {import('../lib/sync.mjs').SyncFlags} */
  let flags;
  try {
    flags = parseSyncArgs(process.argv.slice(3));
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

console.error(`banana: '${cmd}' is not implemented yet`);
process.exit(1);
