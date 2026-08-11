// Session-log grammar: the single source of truth for parsing the Session Log
// v2 envelope (canon/SESSION-LOG.md). Every consumer — brief and doctor today,
// the log stamper and state lint to come — reads the log through this module,
// so writers and readers can never drift apart on the grammar. Deterministic
// text processing only; disk access takes an injectable project root.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo-relative session-log location, as printed in refs and errors. */
export const SESSION_LOG_REF = '.agents/session.log';

/** In-progress entries older than this are ghosts (canon v1.1 constant). */
export const GHOST_THRESHOLD_HOURS = 48;

// The envelope grammar: ## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}
// Anchored to the full line; the separator is the em-dash, not a hyphen.
// Deliberately private: consumers parse through parseSessionLog, never by
// matching the raw grammar themselves.
const ENVELOPE_RE = /^## \[(\d{4}-\d{2}-\d{2})\] (\S+) (\S+)\.(\d+) \| (\S+) — (.+)$/;

/**
 * @typedef {object} LogEntry
 * @property {string} date YYYY-MM-DD from the envelope
 * @property {string} agent
 * @property {string} feature
 * @property {number} n
 * @property {string} phase
 * @property {string} title
 * @property {string} heading the full `## [...]` line, verbatim
 * @property {string[]} body lines between this heading and the next
 * @property {string | null} status last STATUS: value seen in the body
 * @property {string[]} nextLines NEXT: lines in the body, verbatim
 */

/**
 * Parse a session log into structured entries. Lines before the first
 * envelope heading (the seed header block) are ignored.
 * @param {string} text
 * @returns {LogEntry[]}
 */
export function parseSessionLog(text) {
  /** @type {LogEntry[]} */
  const entries = [];
  /** @type {LogEntry | null} */
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ENVELOPE_RE);
    if (m) {
      current = {
        date: m[1],
        agent: m[2],
        feature: m[3],
        n: Number(m[4]),
        phase: m[5],
        title: m[6],
        heading: line,
        body: [],
        status: null,
        nextLines: [],
      };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    current.body.push(line);
    const status = line.match(/^STATUS:\s*(\S+)/);
    if (status) current.status = status[1];
    if (line.startsWith('NEXT:')) current.nextLines.push(line);
  }
  for (const entry of entries) {
    while (entry.body.length && entry.body[entry.body.length - 1].trim() === '') entry.body.pop();
  }
  return entries;
}

/**
 * Absolute path of a project's session log.
 * @param {string} cwd project root
 * @returns {string}
 */
export function sessionLogPath(cwd) {
  return join(cwd, '.agents', 'session.log');
}

/**
 * Read and parse the project session log.
 * @param {string} cwd project root
 * @returns {LogEntry[]}
 * @throws when the project has no .agents/session.log
 */
export function loadSessionLog(cwd) {
  const logPath = sessionLogPath(cwd);
  if (!existsSync(logPath)) {
    throw new Error(`no ${SESSION_LOG_REF} here — run \`banana project\` to initialize this repo`);
  }
  return parseSessionLog(readFileSync(logPath, 'utf8'));
}

/**
 * Owner of a `NEXT: {owner} — {action}` line, or null when unowned.
 * @param {string} line
 * @returns {string | null}
 */
export function nextOwner(line) {
  const m = line.match(/^NEXT:\s*(.+?)\s+—/);
  return m ? m[1].trim() : null;
}

/**
 * An open entry is a live claim: STATUS: in-progress, not yet closed.
 * @param {LogEntry} entry
 * @returns {boolean}
 */
export function isOpen(entry) {
  return entry.status === 'in-progress';
}

/**
 * A ghost is an open entry older than the 48h threshold — a dead claim that
 * must not steer live sessions.
 * @param {LogEntry} entry
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function isGhost(entry, now) {
  if (!isOpen(entry)) return false;
  const opened = Date.parse(`${entry.date}T00:00:00Z`);
  if (Number.isNaN(opened)) return false;
  return now - opened > GHOST_THRESHOLD_HOURS * 60 * 60 * 1000;
}

/**
 * All entries for one feature slug, in log order.
 * @param {LogEntry[]} entries
 * @param {string} feature
 * @returns {LogEntry[]}
 */
export function entriesForFeature(entries, feature) {
  return entries.filter((entry) => entry.feature === feature);
}

/**
 * Newest entry date per feature slug (YYYY-MM-DD strings compare lexically).
 * @param {LogEntry[]} entries
 * @returns {Map<string, string>}
 */
export function latestEntryDates(entries) {
  /** @type {Map<string, string>} */
  const latest = new Map();
  for (const entry of entries) {
    const prev = latest.get(entry.feature);
    if (prev === undefined || entry.date > prev) latest.set(entry.feature, entry.date);
  }
  return latest;
}
