// doctor command: one command that answers "is the continuity protocol alive
// on this machine and in this project?". Reports detected harnesses and the
// fence-block version in every wired file; audits the liveness contract from
// docs/DESIGN.md — in-progress entries older than 48h (ghosts), unowned NEXT:
// lines, a project STATE.md "as of" older than the newest LOGBOOK entry date,
// and any continuity file over the 700-line rotation threshold — plus the v2
// upstream contract: a home canon dir that is missing or older than the kit's
// bundled canon, and any wired fence block older than its current template,
// each naming `sync` as the remediation. Exit 0 clean, 1 when any audit hits.
// --verify prints (never executes) per-harness headless recital commands.
// Home root, project root, clock, and env are injectable — tests run against
// sandbox dirs exclusively.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';
import { findFence } from './fence.mjs';
import { GHOST_THRESHOLD_HOURS, isGhost, nextOwner, parseSessionLog } from './brief.mjs';
import { CANON_FILES, FILE_ADAPTERS } from './init.mjs';
import { wiringTemplateVersion } from './wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
 * @property {'ghost' | 'unowned-next' | 'stale-state' | 'oversize' | 'stale-canon' | 'stale-fence'} type
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
 * Canon revision a canon file declares via its machine-readable marker line
 * (`<!-- banana:canon rev X.Y -->`), or null when the marker is absent.
 * @param {string} text
 * @returns {string | null} e.g. "1.2"
 */
export function canonRev(text) {
  const m = text.match(/<!-- banana:canon rev (\d+\.\d+) -->/);
  return m ? m[1] : null;
}

/**
 * Numeric major.minor comparison — string compare would call "1.10" older
 * than "1.2".
 * @param {string} a @param {string} b
 * @returns {boolean} a is strictly older than b
 */
function revOlderThan(a, b) {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  return aMaj !== bMaj ? aMaj < bMaj : aMin < bMin;
}

/**
 * Run the v2 upstream audits: the kit-owned canon dir must exist and match
 * the bundled canon's revision, and every wired fence block must be at its
 * template's current version. Both drift states are mechanical — `sync` is
 * the remediation each finding names. Unwired files (missing or fence-less)
 * are skipped, matching sync's own eligibility rule.
 * @param {string} home home root holding .agents/canon/ and harness files
 * @param {string} cwd project root, for the repo-local AGENTS.md fence
 * @returns {Finding[]}
 */
export function auditUpstream(home, cwd) {
  /** @type {Finding[]} */
  const findings = [];

  // Canon: missing dir, missing file, or an older revision marker.
  const canonDir = join(home, '.agents', 'canon');
  if (!existsSync(canonDir)) {
    findings.push({
      type: 'stale-canon',
      message: `[stale-canon] ${canonDir} missing — run sync to install the canon`,
    });
  } else {
    for (const name of CANON_FILES) {
      const bundled = canonRev(readFileSync(join(KIT_ROOT, 'canon', name), 'utf8'));
      if (bundled === null) continue; // kit invariant, guarded by canon tests
      const target = join(canonDir, name);
      const installed = existsSync(target) ? canonRev(readFileSync(target, 'utf8')) : null;
      if (installed === null || revOlderThan(installed, bundled)) {
        findings.push({
          type: 'stale-canon',
          message:
            `[stale-canon] ${target} is ${installed === null ? 'missing or unmarked' : `rev ${installed}`} ` +
            `but the kit bundles rev ${bundled} — run sync to refresh the canon`,
        });
      }
    }
  }

  // Fences: every wired block is compared against its own template's current
  // version — the home adapter targets plus the repo-local AGENTS.md.
  const wired = [
    ...FILE_ADAPTERS.map((adapter) => {
      const spec = adapter.describe();
      return { target: join(home, spec.target), template: spec.template };
    }),
    { target: join(cwd, 'AGENTS.md'), template: 'agents-md.md' },
  ];
  for (const { target, template } of wired) {
    if (!existsSync(target)) continue;
    /** @type {ReturnType<typeof findFence>} */
    let fence;
    try {
      fence = findFence(readFileSync(target, 'utf8'));
    } catch {
      continue; // malformed markers already surface in the report section
    }
    if (fence === null) continue;
    const current = wiringTemplateVersion(template);
    if (fence.version < current) {
      findings.push({
        type: 'stale-fence',
        message: `[stale-fence] ${target} fence is v${fence.version} but current is v${current} — run sync to re-fence`,
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

    const findings = [...auditProject(cwd, now), ...auditUpstream(home, cwd)];
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
