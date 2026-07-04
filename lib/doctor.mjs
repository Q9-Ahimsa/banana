// doctor command: one command that answers "is the continuity protocol alive
// on this machine and in this project?". Reports detected harnesses and the
// fence-block version in every wired file; audits the liveness contract from
// docs/DESIGN.md — in-progress entries older than 48h (ghosts), unowned NEXT:
// lines, a project STATE.md "as of" older than the newest LOGBOOK entry date,
// and any continuity file over the 700-line rotation threshold. Exit 0 clean,
// 1 when any audit hits. --verify prints (never executes) per-harness headless
// recital commands. Home root, project root, clock, and env are injectable —
// tests run against sandbox dirs exclusively.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detect } from './detect.mjs';
import { findFence } from './fence.mjs';
import { GHOST_THRESHOLD_HOURS, isGhost, nextOwner, parseSessionLog } from './brief.mjs';
import { FILE_ADAPTERS } from './init.mjs';

/** Continuity files over this many lines must rotate (canon v1.1 constant). */
export const ROTATION_THRESHOLD_LINES = 700;

const RECITAL_PROMPT =
  'Recite the continuity protocol you follow: the session-log envelope, the append-only rule, and your agent tag.';

/**
 * Headless recital commands, one per harness — a liveness probe for the
 * wiring itself (a wired agent can recite the protocol from a cold start).
 * Doctor only ever prints these; the human runs them.
 */
export const RECITALS = [
  { id: 'claude-code', command: `claude -p "${RECITAL_PROMPT}"` },
  { id: 'pi', command: `pi -p "${RECITAL_PROMPT}"` },
  { id: 'codex', command: `codex exec "${RECITAL_PROMPT}"` },
  { id: 'hermes', command: `hermes -z "${RECITAL_PROMPT}"` },
];

/**
 * @typedef {object} DoctorFlags
 * @property {boolean} verify print per-harness recital commands
 */

/**
 * @typedef {object} DoctorIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err]
 */

/**
 * @typedef {object} Finding
 * @property {'ghost' | 'unowned-next' | 'stale-state' | 'oversize'} type
 * @property {string} message printable line, tagged with [type]
 */

/**
 * Parse the argv slice after the `doctor` subcommand.
 * @param {string[]} argv
 * @returns {DoctorFlags}
 * @throws on unknown options
 */
export function parseDoctorArgs(argv) {
  /** @type {DoctorFlags} */
  const flags = { verify: false };
  for (const arg of argv) {
    if (arg === '--verify') flags.verify = true;
    else throw new Error(`unknown doctor option '${arg}'`);
  }
  return flags;
}

/**
 * Logical line count, ignoring a trailing final newline.
 * @param {string} text
 * @returns {number}
 */
function countLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * The "as of" date a STATE.md projection declares, if any.
 * @param {string} text
 * @returns {string | null} YYYY-MM-DD
 */
export function stateAsOf(text) {
  const m = text.match(/\bas of (\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * Newest entry date in a LOGBOOK.md, from its envelope headings.
 * @param {string} text
 * @returns {string | null} YYYY-MM-DD
 */
export function newestLogbookDate(text) {
  /** @type {string | null} */
  let newest = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^## \[(\d{4}-\d{2}-\d{2})\]/);
    if (m && (newest === null || m[1] > newest)) newest = m[1];
  }
  return newest;
}

/**
 * Run the four liveness audits against a project root. Missing continuity
 * files are skipped, not findings — doctor may run anywhere, and "not a
 * banana project yet" is not a liveness failure.
 * @param {string} cwd project root
 * @param {number} now epoch ms
 * @returns {Finding[]}
 */
export function auditProject(cwd, now) {
  /** @type {Finding[]} */
  const findings = [];

  // Ghosts + unowned NEXT in the session log.
  const logPath = join(cwd, '.agents', 'session.log');
  if (existsSync(logPath)) {
    for (const entry of parseSessionLog(readFileSync(logPath, 'utf8'))) {
      if (isGhost(entry, now)) {
        findings.push({
          type: 'ghost',
          message:
            `[ghost] ${entry.feature}.${entry.n} (${entry.date}) in-progress older than ` +
            `${GHOST_THRESHOLD_HOURS}h — close as abandoned via a SUPERSEDES entry`,
        });
      }
      for (const next of entry.nextLines) {
        if (nextOwner(next) === null) {
          findings.push({
            type: 'unowned-next',
            message: `[unowned-next] .agents/session.log ${entry.feature}.${entry.n}: "${next}" — every NEXT needs an owner`,
          });
        }
      }
    }
  }

  // Unowned NEXT in the logbook, and STATE.md projection staleness.
  const logbookPath = join(cwd, 'LOGBOOK.md');
  const logbook = existsSync(logbookPath) ? readFileSync(logbookPath, 'utf8') : null;
  if (logbook !== null) {
    for (const line of logbook.split(/\r?\n/)) {
      if (line.startsWith('NEXT:') && nextOwner(line) === null) {
        findings.push({
          type: 'unowned-next',
          message: `[unowned-next] LOGBOOK.md: "${line}" — every NEXT needs an owner`,
        });
      }
    }
    const statePath = join(cwd, 'STATE.md');
    if (existsSync(statePath)) {
      const asOf = stateAsOf(readFileSync(statePath, 'utf8'));
      const newest = newestLogbookDate(logbook);
      if (asOf !== null && newest !== null && asOf < newest) {
        findings.push({
          type: 'stale-state',
          message:
            `[stale-state] STATE.md projection is as of ${asOf} but the newest LOGBOOK entry ` +
            `is ${newest} — rebuild the projection (whole, never patched)`,
        });
      }
    }
  }

  // Rotation: the living records must stay greppable.
  for (const rel of ['LOGBOOK.md', 'STATE.md', join('.agents', 'session.log')]) {
    const path = join(cwd, rel);
    if (!existsSync(path)) continue;
    const lines = countLines(readFileSync(path, 'utf8'));
    if (lines > ROTATION_THRESHOLD_LINES) {
      findings.push({
        type: 'oversize',
        message: `[oversize] ${rel} is ${lines} lines (rotation threshold ${ROTATION_THRESHOLD_LINES}) — archive the tail`,
      });
    }
  }

  return findings;
}

/**
 * Fence status of a wired file, for the report section.
 * @param {string} path
 * @returns {string}
 */
function fenceStatus(path) {
  if (!existsSync(path)) return '(file missing)';
  try {
    const fence = findFence(readFileSync(path, 'utf8'));
    return fence === null ? '(no fence block)' : `fence v${fence.version}`;
  } catch (error) {
    return `(${error instanceof Error ? error.message : error})`;
  }
}

/**
 * @typedef {object} DoctorResult
 * @property {number} code process exit code: 0 clean, 1 findings (or failure)
 */

/**
 * Run the doctor command: report wiring, run audits, optionally print the
 * recital commands. Never writes or executes anything.
 * @param {DoctorFlags} flags
 * @param {{ cwd: string, home: string, io: DoctorIo, now?: number, env?: { PATH?: string, PATHEXT?: string } }} deps
 * @returns {Promise<DoctorResult>}
 */
export async function runDoctor(flags, deps) {
  const { cwd, home, io, now = Date.now(), env } = deps;
  const out = io.out;
  const err = io.err ?? io.out;

  try {
    out(`banana doctor — project ${cwd}`);
    out('');

    out(`Harnesses (home: ${home}):`);
    for (const h of detect(home, env ? { env } : {}).harnesses) {
      out(`  ${h.id.padEnd(12)} ${h.detected ? `detected (${h.via}: ${h.location})` : 'not detected'}`);
    }
    out('');

    out('Wiring fences:');
    for (const adapter of FILE_ADAPTERS) {
      const target = join(home, adapter.describe().target);
      out(`  ${adapter.id.padEnd(12)} ${target}  ${fenceStatus(target)}`);
    }
    const projectAgents = join(cwd, 'AGENTS.md');
    out(`  ${'project'.padEnd(12)} ${projectAgents}  ${fenceStatus(projectAgents)}`);
    out('');

    const findings = auditProject(cwd, now);
    out('Audits:');
    if (findings.length === 0) {
      out('  clean — no findings');
    } else {
      for (const finding of findings) out(`  ${finding.message}`);
      out(`  -> ${findings.length} finding(s)`);
    }

    if (flags.verify) {
      out('');
      out('Verify (headless recital commands — printed only, never executed):');
      for (const recital of RECITALS) out(`  ${recital.id.padEnd(12)} ${recital.command}`);
    }

    return { code: findings.length === 0 ? 0 : 1 };
  } catch (error) {
    err(`banana doctor: ${error instanceof Error ? error.message : error}`);
    return { code: 1 };
  }
}
