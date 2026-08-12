// brief command: compile a per-intent context brief to stdout. The brief is
// the closed-allowlist entry ritual from canon v1.1 — a session reads its
// compiled brief, nothing else by default. Include/exclude contract
// (docs/DESIGN.md): target feature's session-log entries with full bodies;
// headings only of the last 5 entries from other features; NEXT lines owned
// by --tag or unowned; project STATE.md verbatim; ghosts flagged. Every
// section carries a ref line — the brief is an index into the record, not a
// replacement for it. Deterministic text processing only; project root and
// clock are injectable so tests run against fixture dirs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SESSION_LOG_REF,
  GHOST_THRESHOLD_HOURS,
  loadSessionLog,
  nextOwner,
  isGhost,
  entriesForFeature,
  latestEntryDates,
  supersededIds,
} from './sessionlog.mjs';

/** @typedef {import('./sessionlog.mjs').LogEntry} LogEntry */

/** How many other-feature entry headings a brief surfaces. */
const OTHER_HEADINGS_WINDOW = 5;

/**
 * @typedef {object} BriefFlags
 * @property {string} feature target feature slug the session is entering
 * @property {string} tag agent tag of the reading session (NEXT ownership filter)
 */

/**
 * @typedef {object} BriefArgs
 * @property {string | null} feature null = discovery mode: list active slugs instead of compiling
 * @property {string | null} tag required whenever a feature is given, otherwise ignored
 */

/**
 * @typedef {object} BriefIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err]
 */

/**
 * Parse the argv slice after the `brief` subcommand. No feature arg is valid:
 * it selects discovery mode (list active slugs) instead of compiling a brief.
 * @param {string[]} argv
 * @returns {BriefArgs}
 * @throws on a feature without --tag, or unknown options
 */
export function parseBriefArgs(argv) {
  /** @type {string | null} */
  let feature = null;
  /** @type {string | null} */
  let tag = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tag') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--tag requires a value');
      tag = next;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown brief option '${arg}'`);
    } else if (feature === null) {
      feature = arg;
    } else {
      throw new Error(`unexpected argument '${arg}'`);
    }
  }
  if (feature && !tag) throw new Error('--tag <agent> is required (who is reading this brief)');
  return { feature, tag };
}

/**
 * Active-slug listing: one line per feature slug with the date of its latest
 * entry, newest first (slug asc on date ties). This is the discovery surface —
 * a session that doesn't know the active slugs runs `banana brief` bare
 * instead of grepping the log.
 * @param {LogEntry[]} entries
 * @returns {string}
 */
export function slugListing(entries) {
  const latest = latestEntryDates(entries);
  const lines = [`active features — slug + last entry (${SESSION_LOG_REF}):`];
  if (latest.size === 0) {
    lines.push('(none yet — the log has no entries)');
  } else {
    const slugs = [...latest.entries()].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1].localeCompare(a[1])
    );
    for (const [slug, date] of slugs) lines.push(`- ${slug} — ${date}`);
  }
  lines.push('');
  lines.push('usage: banana brief <feature> --tag <agent>');
  return lines.join('\n');
}

/**
 * Compile the brief text for one feature/tag pair.
 * @param {BriefFlags} flags
 * @param {{ cwd: string, now: number }} deps project root and clock (epoch ms)
 * @returns {string}
 * @throws when the project has no .agents/session.log
 */
export function compileBrief(flags, deps) {
  const { feature, tag } = flags;
  const { cwd, now } = deps;

  const logRef = SESSION_LOG_REF;
  const entries = loadSessionLog(cwd);
  // Supersession-aware ghosts, per CONTINUITY.md's 48h ghost rule (v1.4
  // supersession carve-out; ADR 0003): a continuation/abandon supersede
  // retires the entry it points at, so a ghost id in this set is a
  // resolved claim, not a dead one — both ghost surfaces below skip it.
  const superseded = supersededIds(entries);

  /** @type {string[]} */
  const lines = [];
  lines.push(`# brief — ${feature} (agent: ${tag})`);
  lines.push('> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;');
  lines.push('> your own open log entry is the cohesion anchor. Refs point into the record.');
  lines.push('');

  // Project STATE.md verbatim — the hot projection, one page by contract.
  // Global STATE is machine grain and deliberately excluded.
  lines.push('## Project state');
  lines.push('ref: STATE.md');
  const statePath = join(cwd, 'STATE.md');
  if (existsSync(statePath)) {
    lines.push(readFileSync(statePath, 'utf8').trimEnd());
  } else {
    lines.push('(no STATE.md found — run `banana project` to create it)');
  }
  lines.push('');

  // Target feature: full bodies, ghosts flagged inline where they sit.
  lines.push(`## Feature history — ${feature} (full bodies)`);
  lines.push(`ref: ${logRef}`);
  const mine = entriesForFeature(entries, feature);
  if (mine.length === 0) {
    lines.push(`(no entries for '${feature}' yet — this session opens the record)`);
  }
  for (const entry of mine) {
    lines.push(entry.heading);
    if (isGhost(entry, now) && !superseded.has(`${entry.feature}.${entry.n}`)) {
      lines.push(
        `[GHOST — in-progress since ${entry.date}, older than ${GHOST_THRESHOLD_HOURS}h; ` +
          'close as abandoned via a SUPERSEDES entry]'
      );
    }
    lines.push(...entry.body);
    lines.push('');
  }
  if (mine.length === 0) lines.push('');

  // Other features: awareness that work exists, zero exposure to approach.
  lines.push(`## Other work in flight — headings only (last ${OTHER_HEADINGS_WINDOW})`);
  lines.push(`ref: ${logRef}`);
  const others = entries.filter((e) => e.feature !== feature).slice(-OTHER_HEADINGS_WINDOW);
  if (others.length === 0) lines.push('(none)');
  for (const entry of others) {
    lines.push(`- ${entry.heading.slice(3)}`);
  }
  lines.push('');

  // Handoffs: NEXT lines this session may act on — owned by its tag or
  // unowned. NEXT lines are the one body element carved out of the
  // headings-not-bodies rule: they are the handoff surface.
  lines.push(`## Handoffs — NEXT for ${tag} or unowned`);
  lines.push(`ref: ${logRef}`);
  /** @type {string[]} */
  const handoffs = [];
  for (const entry of entries) {
    for (const next of entry.nextLines) {
      const owner = nextOwner(next);
      if (owner === tag || owner === null) {
        handoffs.push(`- ${entry.feature}.${entry.n}: ${next}`);
      }
    }
  }
  lines.push(...(handoffs.length ? handoffs : ['(none)']));
  lines.push('');

  // Ghosts across the whole log — id and title only for foreign features.
  lines.push(`## Ghosts — in-progress older than ${GHOST_THRESHOLD_HOURS}h`);
  lines.push(`ref: ${logRef}`);
  const ghosts = entries.filter((e) => isGhost(e, now) && !superseded.has(`${e.feature}.${e.n}`));
  if (ghosts.length === 0) lines.push('(none)');
  for (const entry of ghosts) {
    lines.push(
      `- [GHOST] ${entry.feature}.${entry.n} (${entry.date}) — ${entry.title} — ` +
        'next session in this project closes it as abandoned via SUPERSEDES'
    );
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * @typedef {object} BriefResult
 * @property {number} code process exit code
 */

/**
 * Run the brief command. Three shapes (packet T7):
 * - no feature: print the active-slug listing to stdout, exit 0 (discovery);
 * - unknown slug: print the listing to stderr, exit 1;
 * - known slug: compile and print the brief to stdout (contract unchanged).
 * @param {BriefArgs} flags
 * @param {{ cwd: string, io: BriefIo, now?: number }} deps
 * @returns {Promise<BriefResult>}
 */
export async function runBrief(flags, deps) {
  const { cwd, io, now = Date.now() } = deps;
  const err = io.err ?? io.out;
  try {
    const { feature, tag } = flags;
    if (feature === null) {
      io.out(slugListing(loadSessionLog(cwd)));
      return { code: 0 };
    }
    const entries = loadSessionLog(cwd);
    if (entriesForFeature(entries, feature).length === 0) {
      err(`banana brief: no entries for feature '${feature}'`);
      err(slugListing(entries));
      return { code: 1 };
    }
    io.out(compileBrief({ feature, tag: /** @type {string} */ (tag) }, { cwd, now }));
    return { code: 0 };
  } catch (error) {
    err(`banana brief: ${error instanceof Error ? error.message : error}`);
    return { code: 1 };
  }
}
