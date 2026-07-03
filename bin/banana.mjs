#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

const COMMANDS = ['init', 'project', 'brief', 'doctor'];
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
  doctor    check wiring versions and run liveness audits`);
  process.exit(cmd === undefined ? 1 : 0);
}

if (!COMMANDS.includes(cmd)) {
  console.error(`banana: unknown command '${cmd}' (expected ${COMMANDS.join('|')})`);
  process.exit(1);
}

console.error(`banana: '${cmd}' is not implemented yet`);
process.exit(1);
