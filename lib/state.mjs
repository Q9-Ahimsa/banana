// `state lint` (#9 project mode, #13 global mode to follow): lints a
// STATE.md page against the canon's mechanical invariants — never grades
// content, every verdict is reproducible from file bytes alone (no check may
// read the clock, so no `now` is ever injected here). Verdict tiers: FAIL (a
// mechanical invariant is broken), WARN (ambiguous residue a model should
// look at), PASS (neither). Exit codes: 0 PASS/WARN-only, 1 any FAIL, 2 usage
// error or the target STATE.md missing/unreadable. Contract:
// docs/DESIGN.md `state lint` — verdict contract,
// docs/adr/0004-state-lint-verdict-tiers.md,
// .agents/specs/cli-9-13-state-lint.md.
//
// Shared by project mode (this file, #9) and global mode (#13, not yet
// implemented): the owner matcher, the cap check, the missing-section check,
// the Finding shape, and the output formatter below are all mode-agnostic
// pure functions — `--global` slots in later by adding a global-mode
// composer alongside `lintProjectState` and a branch in `runStateLint` on
// `flags.global` (the parser rejects `--global` for now; `home` is already
// threaded through `runStateLint`'s deps for when it lands).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { newestLogbookDate, stateAsOf } from './doctor.mjs';
import { latestEntryDates, parseSessionLog, sessionLogPath } from './sessionlog.mjs';

/**
 * One-page hard cap: JS string length, measured after CRLF normalization.
 * Decision record (ADR 0004): no numeric cap existed anywhere before this —
 * real project pages measured 1.4k-15k chars (median ~5.5k), so 10k fails
 * only the one genuinely bloated page. Lines are not the unit: real pages
 * have single lines up to 969 chars.
 */
export const STATE_CAP_CHARS = 10000;

// Single-sourced with test/canon.test.mjs and test/templates.test.mjs (they
// previously each kept their own file-local copy) so the canon's own
// byte-exact assertions and this lint tool's detection can never drift apart.
/** ADR 0001 (rebuild-on-close): the canonical dirty-marker line, byte-exact. */
export const DIRTY_MARKER_LINE = '> ⚠ patched since last rebuild — log is authority';
/** The retired project-STATE rule. (The global page keeps rebuild-whole by design.) */
export const RETIRED_HEADER_RE = /rebuilt whole, never patched/i;

/**
 * The six mandatory project-STATE.md sections (canon STANDARD.md §3), by
 * bare name — no `## ` prefix. `hasSection`/`topLevelBullets` below qualify
 * each name into a heading-matching regex.
 */
export const REQUIRED_PROJECT_SECTIONS = ['Now', 'Truths', 'Next', 'Blocked', 'Watch', 'Dead ends'];

/** `state` command verb vocabulary — room for more, `lint` only today. */
const STATE_VERBS = ['lint'];

/**
 * @typedef {object} StateFlags
 * @property {'lint'} verb
 */

/**
 * @typedef {object} StateIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err] defaults to out
 */

/**
 * @typedef {'FAIL' | 'WARN'} Tier
 */

/**
 * @typedef {object} Finding
 * @property {Tier} tier
 * @property {string} type
 * @property {string} message printable, without the `[type]`/file prefix —
 *   emitFindings composes the full line
 */

/**
 * @typedef {object} StateResult
 * @property {number} code 0 PASS/WARN-only, 1 any FAIL, 2 usage or missing/unreadable target
 */

/**
 * Parse the argv slice after `state` (argv[0] is the verb).
 * @param {string[]} argv
 * @returns {StateFlags}
 * @throws on a missing/unknown verb or any flag — phase 1 accepts none;
 *   `--global` lands with #13.
 */
export function parseStateArgs(argv) {
  if (argv.length === 0) throw new Error(`missing verb (expected ${STATE_VERBS.join('|')})`);
  const [verb, ...rest] = argv;
  if (!STATE_VERBS.includes(verb)) {
    throw new Error(`unknown state verb '${verb}' (expected ${STATE_VERBS.join('|')})`);
  }
  for (const arg of rest) {
    throw new Error(`unknown option '${arg}'`);
  }
  return { verb: 'lint' };
}

/** Normalize CRLF -> LF once, up front, before any check sees the text. */
function normalizeCRLF(text) {
  return text.replace(/\r\n/g, '\n');
}

/** An offending line, trimmed to 120 chars for a finding message. */
function trimLine(line) {
  return line.length > 120 ? line.slice(0, 120) : line;
}

/** Escape regex special characters in a literal string. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The line index of a `## <name>` section heading, or -1 if absent. The
 * heading is qualifier-tolerant: `<name>` may be followed by nothing, or by
 * whitespace and then any text — `## Watch (tripwires ...)` counts for
 * `Watch`, but a glued suffix does not (`## Watchlist` does NOT count for
 * `Watch`, `## Nextsteps` does NOT count for `Next`), since real project
 * pages qualify their headings with parenthetical context (fixed 2026-09-28
 * after the phase-1 smoke run exposed false-positive `missing-section`
 * findings on real pages — see ADR 0004).
 * @param {string[]} lines text already split on '\n'
 * @param {string} name exact section name, e.g. 'Watch', 'Dead ends'
 * @returns {number}
 */
function sectionHeadingIndex(lines, name) {
  const re = new RegExp(`^## ${escapeRegExp(name)}(?:\\s.*)?$`);
  return lines.findIndex((l) => re.test(l.trimEnd()));
}

/**
 * True iff a `## <name>` section heading is present (qualifier-tolerant, see
 * sectionHeadingIndex).
 * @param {string} text CRLF-normalized
 * @param {string} name exact section name, e.g. 'Watch', 'Dead ends'
 * @returns {boolean}
 */
export function hasSection(text, name) {
  return sectionHeadingIndex(text.split('\n'), name) !== -1;
}

/**
 * Classify a top-level bullet's ownership per the shared owner matcher
 * (project `## Next`, global `## Backlog (owned)`, #13). The literal,
 * unsubstituted bootstrap placeholder token `__OWNER__` is checked against
 * the RAW bullet content first — before the leading-emphasis strip below,
 * which would otherwise consume `__OWNER__`'s own wrapping underscores
 * before any comparison could see them. Past that, content is stripped of
 * one leading markdown-emphasis marker; a bullet whose stripped content
 * starts with `(` is a template placeholder. A bullet is owned iff its
 * (stripped) content matches `owner — text` (em-dash), the owner token
 * itself carries no em-dash, and the owner token — after stripping one
 * trailing emphasis marker — is not `unowned` (case-insensitive).
 * @param {string} line a raw line already known to match /^[-*] /
 * @returns {'owned' | 'unowned' | 'placeholder'}
 */
export function classifyOwnerBullet(line) {
  const rawContent = line.slice(2); // strip the leading `- ` / `* ` marker
  if (/^__OWNER__(\s|$)/.test(rawContent)) return 'unowned';

  let content = rawContent.replace(/^(\*\*|\*|__|_)/, '');
  if (content.startsWith('(')) return 'placeholder';

  const m = content.match(/^(\S+)\s+—\s+\S/);
  if (!m) return 'unowned';
  let owner = m[1];
  if (owner.includes('—')) return 'unowned';
  owner = owner.replace(/(\*\*|\*|__|_)$/, '');
  if (owner.toLowerCase() === 'unowned') return 'unowned';
  return 'owned';
}

/**
 * Top-level bullets (`^[-*] `, no indentation) inside a named `## ` section,
 * bounded by the next `## ` heading or EOF. The section heading itself is
 * qualifier-tolerant (see sectionHeadingIndex): a page whose Next heading
 * reads `## Next (owned)` is still scanned as the `Next` section — otherwise
 * a qualified heading would silently skip the unowned-bullet scan, which
 * prints identically to a clean PASS. Prose, blank lines, indented bullets
 * and `###` sub-headings are not top-level bullets and are skipped.
 * @param {string} text CRLF-normalized
 * @param {string} name exact section name, e.g. 'Next', 'Backlog (owned)'
 * @returns {string[]}
 */
export function topLevelBullets(text, name) {
  const lines = text.split('\n');
  const start = sectionHeadingIndex(lines, name);
  if (start === -1) return [];
  /** @type {string[]} */
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    if (/^[-*] /.test(lines[i])) out.push(lines[i]);
  }
  return out;
}

/**
 * FAIL for every unowned top-level bullet in a named section — shared by
 * project `unowned-next` (`## Next`) and global `backlog-unowned`
 * (`## Backlog (owned)`, #13).
 * @param {string} text CRLF-normalized
 * @param {string} name exact section name, e.g. 'Next'
 * @param {string} type the Finding `type` to tag ('unowned-next' | 'backlog-unowned')
 * @returns {Finding[]}
 */
export function checkUnownedBullets(text, name, type) {
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, name)) {
    if (classifyOwnerBullet(line) === 'unowned') {
      findings.push({ tier: 'FAIL', type, message: `unowned bullet in "## ${name}": "${trimLine(line)}"` });
    }
  }
  return findings;
}

/**
 * FAIL for each of `sections` absent as a heading line (qualifier-tolerant,
 * see sectionHeadingIndex; trailing whitespace ok).
 * @param {string} text CRLF-normalized
 * @param {string[]} sections exact section names, e.g. REQUIRED_PROJECT_SECTIONS
 * @returns {Finding[]}
 */
export function checkMissingSections(text, sections) {
  /** @type {Finding[]} */
  const findings = [];
  for (const name of sections) {
    if (!hasSection(text, name)) {
      findings.push({ tier: 'FAIL', type: 'missing-section', message: `missing required section "## ${name}"` });
    }
  }
  return findings;
}

/**
 * FAIL when the page exceeds STATE_CAP_CHARS.
 * @param {string} text CRLF-normalized
 * @returns {Finding[]}
 */
export function checkOverCap(text) {
  if (text.length <= STATE_CAP_CHARS) return [];
  return [
    {
      tier: 'FAIL',
      type: 'over-cap',
      message: `${text.length} chars exceeds the ${STATE_CAP_CHARS}-char cap`,
    },
  ];
}

/**
 * FAIL when no `as of YYYY-MM-DD` date is found, unless the page is still
 * the bootstrap placeholder (`as of (date)`) AND has no LOGBOOK.md entries
 * yet — a fresh page, not a defect.
 * @param {string} text CRLF-normalized
 * @param {string | null} asOf `stateAsOf(text)`, computed once by the caller
 * @param {boolean} hasLogbookEntries
 * @returns {Finding[]}
 */
export function checkAsOfMissing(text, asOf, hasLogbookEntries) {
  if (asOf !== null) return [];
  const isFreshPlaceholder = text.includes('as of (date)') && !hasLogbookEntries;
  if (isFreshPlaceholder) return [];
  return [
    { tier: 'FAIL', type: 'as-of-missing', message: 'no "as of YYYY-MM-DD" date found in the header' },
  ];
}

/**
 * FAIL when the as-of date is older than the newest LOGBOOK.md entry date
 * (equal passes).
 * @param {string | null} asOf
 * @param {string | null} newest
 * @returns {Finding[]}
 */
export function checkStaleVsLogbook(asOf, newest) {
  if (asOf === null || newest === null || asOf >= newest) return [];
  return [
    {
      tier: 'FAIL',
      type: 'stale-vs-logbook',
      message: `as-of ${asOf} is older than the newest LOGBOOK.md entry ${newest}`,
    },
  ];
}

/**
 * WARN when the as-of date is older than the newest .agents/session.log
 * entry date (equal passes). Deliberately WARN, not FAIL (ADR 0004): the
 * canon's rebuild trigger is logbook promotion or a standing dirty marker,
 * so a newer unpromoted session entry is legitimate residue, not a defect.
 * @param {string | null} asOf
 * @param {string | null} newest
 * @returns {Finding[]}
 */
export function checkStaleVsSessionLog(asOf, newest) {
  if (asOf === null || newest === null || asOf >= newest) return [];
  return [
    {
      tier: 'WARN',
      type: 'stale-vs-session-log',
      message: `as-of ${asOf} is older than the newest .agents/session.log entry ${newest}`,
    },
  ];
}

/**
 * WARN when the rebuild-on-close dirty marker (ADR 0001) still stands.
 * @param {string} text CRLF-normalized
 * @returns {Finding[]}
 */
export function checkDirtyMarker(text) {
  const standing = text.split('\n').some((line) => line === DIRTY_MARKER_LINE);
  if (!standing) return [];
  return [
    {
      tier: 'WARN',
      type: 'dirty-marker',
      message: `standing dirty marker: "${DIRTY_MARKER_LINE}" — log is authority until the next rebuild`,
    },
  ];
}

/**
 * WARN when the page still carries the pre-amendment "rebuilt whole, never
 * patched" rule. Project grain only — the global page keeps rebuild-whole by
 * design and must never be flagged for it (#13 skips this check entirely).
 * @param {string} text CRLF-normalized
 * @returns {Finding[]}
 */
export function checkRetiredHeader(text) {
  if (!RETIRED_HEADER_RE.test(text)) return [];
  return [
    {
      tier: 'WARN',
      type: 'retired-header',
      message:
        'header carries the retired "rebuilt whole, never patched" rule — migrate to rebuild-on-close (ADR 0001)',
    },
  ];
}

/** Newest date across every feature in a parsed session log, or null. */
function newestSessionLogDate(entries) {
  const dates = [...latestEntryDates(entries).values()];
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b > a ? b : a));
}

/**
 * Run every project-mode check and compose the findings.
 * @param {string} text CRLF-normalized STATE.md text
 * @param {{ logbookText: string | null, sessionEntries: import('./sessionlog.mjs').LogEntry[] }} sources
 * @returns {Finding[]}
 */
export function lintProjectState(text, { logbookText, sessionEntries }) {
  const asOf = stateAsOf(text);
  const newestLogbook = logbookText !== null ? newestLogbookDate(logbookText) : null;
  const newestSession = newestSessionLogDate(sessionEntries);

  return [
    ...checkMissingSections(text, REQUIRED_PROJECT_SECTIONS),
    ...checkOverCap(text),
    ...checkUnownedBullets(text, 'Next', 'unowned-next'),
    ...checkAsOfMissing(text, asOf, newestLogbook !== null),
    ...checkStaleVsLogbook(asOf, newestLogbook),
    ...checkStaleVsSessionLog(asOf, newestSession),
    ...checkDirtyMarker(text),
    ...checkRetiredHeader(text),
  ];
}

/**
 * Print every finding (FAILs first, then WARNs) through io, then the summary
 * line, and derive the exit code.
 * @param {StateIo} io
 * @param {Finding[]} findings
 * @param {string} file printed as the `<file>` token on every finding line
 * @returns {StateResult}
 */
export function emitFindings(io, findings, file) {
  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of [...fails, ...warns]) {
    io.out(`${f.tier} [${f.type}] ${file}: ${f.message}`);
  }
  if (fails.length > 0) {
    io.out(`state lint: FAIL (${fails.length} fail, ${warns.length} warn)`);
    return { code: 1 };
  }
  if (warns.length > 0) {
    io.out(`state lint: WARN (${warns.length} warn)`);
    return { code: 0 };
  }
  io.out('state lint: PASS');
  return { code: 0 };
}

/**
 * Run a parsed `banana state lint` invocation. Project mode only (phase 1,
 * #9) — global mode (#13) will branch on `flags.global` here once the parser
 * accepts `--global`; `home` is already threaded through for that.
 * @param {StateFlags} flags
 * @param {{ cwd: string, io: StateIo, home: string }} deps
 * @returns {Promise<StateResult>}
 */
export async function runStateLint(flags, deps) {
  const { cwd, io } = deps; // deps.home: unused until #13 branches on flags.global
  const err = io.err ?? io.out;

  const target = join(cwd, 'STATE.md');
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    err(`banana state lint: ${target} is missing or unreadable`);
    return { code: 2 };
  }
  const text = normalizeCRLF(raw);

  const logbookPath = join(cwd, 'LOGBOOK.md');
  let logbookText = null;
  if (existsSync(logbookPath)) {
    try {
      logbookText = normalizeCRLF(readFileSync(logbookPath, 'utf8'));
    } catch {
      logbookText = null;
    }
  }

  /** @type {import('./sessionlog.mjs').LogEntry[]} */
  let sessionEntries = [];
  const logPath = sessionLogPath(cwd);
  if (existsSync(logPath)) {
    try {
      sessionEntries = parseSessionLog(readFileSync(logPath, 'utf8'));
    } catch {
      sessionEntries = [];
    }
  }

  const findings = lintProjectState(text, { logbookText, sessionEntries });
  return emitFindings(io, findings, 'STATE.md');
}
