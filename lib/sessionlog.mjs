// Session-log grammar: the single source of truth for parsing the Session Log
// v2 envelope (canon/SESSION-LOG.md). Every consumer — brief and doctor today,
// the log stamper and state lint to come — reads the log through this module,
// so writers and readers can never drift apart on the grammar. Deterministic
// text processing only; disk access takes an injectable project root.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Repo-relative session-log location, as printed in refs and errors. */
export const SESSION_LOG_REF = '.agents/session.log';

/** Repo-relative archive directory (canon §8 rotation). */
export const SESSION_ARCHIVE_DIR_REF = '.agents/sessions';

/**
 * Active-log rotation threshold (canon SESSION-LOG.md §8): a log longer than
 * this is due for archiving to `.agents/sessions/{YYYY}-{Qn}.log`. Shared
 * seam constant — the `log` command's rotation advisory reads it from here
 * rather than keeping its own copy (doctor.mjs's oversize audit is a
 * separate path with its own threshold; this one is `log`'s).
 */
export const ROTATION_LINES = 700;

/** In-progress entries older than this are ghosts (canon v1.1 constant). */
export const GHOST_THRESHOLD_HOURS = 48;

/** PHASE vocabulary (canon §1). Written lowercase always. */
export const PHASES = ['discuss', 'build', 'refactor', 'debug', 'review', 'ops'];

/** STATUS vocabulary (canon §2), in write-protocol order. */
export const STATUSES = ['in-progress', 'complete', 'blocked', 'abandoned'];

/** The STATUS values that close an entry (everything but in-progress). */
export const TERMINAL_STATUSES = ['complete', 'blocked', 'abandoned'];

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
 * Compose the canonical envelope heading line. The single site that owns the
 * heading format string — every writer (the `log` command, tests, docs
 * examples) builds headings by calling this, never by string-templating the
 * grammar themselves.
 * @param {{date: string, agent: string, feature: string, n: number, phase: string, title: string}} fields
 * @returns {string}
 */
export function formatEnvelope({ date, agent, feature, n, phase, title }) {
  return `## [${date}] ${agent} ${feature}.${n} | ${phase} — ${title}`;
}

/**
 * Is this the grep unit canon §3/§4 scan for (`grep "^## \[" ... `)? Broader
 * than ENVELOPE_RE on purpose: a mangled heading (hyphen for em-dash, bad
 * date) is invisible to parseSessionLog but still visible to this test —
 * concurrency-guard adjacency is decided on this, not on parsed entries.
 * @param {string} line
 * @returns {boolean}
 */
export function isHeadingLine(line) {
  return /^## \[/.test(line);
}

/**
 * Logical line count of a text blob — split on any EOL style, minus one for
 * a lone trailing empty segment produced by a final newline (so `"a\nb\n"`
 * and `"a\nb"` both count as 2 lines). Shared by the `log` command's
 * rotation advisory, compared against ROTATION_LINES.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * Local calendar day as YYYY-MM-DD, hand-built from local date getters
 * (never toISOString/toLocaleDateString, which drift to UTC or locale).
 * @param {number} nowMs epoch ms
 * @returns {string}
 */
export function formatLocalDate(nowMs) {
  const d = new Date(nowMs);
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a session log into structured entries. Lines before the first
 * envelope heading (the seed header block) are ignored.
 * @param {string} text
 * @returns {LogEntry[]}
 */
export function parseSessionLog(text) {
  // A leading UTF-8 BOM (U+FEFF) sits on the first character and would
  // otherwise glue itself to the first heading's `## [`, defeating
  // ENVELOPE_RE and silently dropping the log's first entry in every
  // consumer. Strip it before anything else sees the text.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
 *
 * GHOST-SKEW: the entry's date is stamped from the writer's LOCAL calendar
 * day (formatLocalDate), but the math below treats that date as UTC
 * midnight. A writer west of UTC effectively backdates their entry (skews
 * toward "already old"); east of UTC forward-dates it (skews toward "still
 * fresh"). Bounded by the widest real UTC offset spread, ±14h — never
 * enough on its own to flip a same-day entry into ghost territory, but
 * worth knowing when eyeballing a case that lands close to the 48h line.
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

/**
 * @typedef {object} SessionArchive
 * @property {string} file repo-relative path (forward-slash) of the archive
 * @property {LogEntry[]} entries
 */

/**
 * @typedef {object} SessionHistory
 * @property {LogEntry[]} active entries from .agents/session.log
 * @property {SessionArchive[]} archives entries from .agents/sessions/*.log
 */

/**
 * The active log plus every rotated archive (canon §8: `.agents/sessions/
 * {YYYY}-{Qn}.log`). The active log is required — a missing one throws the
 * same error as loadSessionLog. Archives are read best-effort: a missing
 * archive directory or an unreadable archive file is silently skipped
 * rather than failing the whole read, since the active log alone is always
 * a valid (if incomplete) history.
 * @param {string} cwd project root
 * @returns {SessionHistory}
 * @throws when the project has no .agents/session.log
 */
export function loadSessionHistory(cwd) {
  const active = loadSessionLog(cwd);
  const archivesDir = join(cwd, '.agents', 'sessions');
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(archivesDir).filter((name) => name.endsWith('.log')).sort();
  } catch {
    names = [];
  }
  /** @type {SessionArchive[]} */
  const archives = [];
  for (const name of names) {
    try {
      const text = readFileSync(join(archivesDir, name), 'utf8');
      archives.push({ file: `${SESSION_ARCHIVE_DIR_REF}/${name}`, entries: parseSessionLog(text) });
    } catch {
      // best-effort: an unreadable archive is skipped, not fatal.
    }
  }
  return { active, archives };
}

/**
 * The next `n` for a feature: max(n)+1 over the active log union every
 * archive (canon §8 rotation). Gaps are never filled (1,2,5 -> 6). Legacy
 * `.claude/session.log` is never scanned — different pre-v2 grammar.
 * @param {string} cwd project root
 * @param {string} feature slug
 * @returns {number}
 * @throws when the project has no .agents/session.log
 */
export function nextN(cwd, feature) {
  const { active, archives } = loadSessionHistory(cwd);
  let max = 0;
  for (const entry of active) {
    if (entry.feature === feature && entry.n > max) max = entry.n;
  }
  for (const { entries } of archives) {
    for (const entry of entries) {
      if (entry.feature === feature && entry.n > max) max = entry.n;
    }
  }
  return max + 1;
}

/**
 * The set of `{feature}.{n}` ids retired by a SUPERSEDES body line, across
 * both forms: a correction (`SUPERSEDES: {feature}.{n} ({reason})`) and a
 * concurrency-guard continuation (`SUPERSEDES: {feature}.{n} (continuation
 * — closes the entry left open above)`). Ghost surfaces and target
 * resolution both skip any entry whose id lands in this set.
 * @param {LogEntry[]} entries
 * @returns {Set<string>}
 */
export function supersededIds(entries) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const entry of entries) {
    for (const line of entry.body) {
      const m = line.match(/^SUPERSEDES:\s*(\S+)\.(\d+)/);
      if (m) ids.add(`${m[1]}.${m[2]}`);
    }
  }
  return ids;
}
