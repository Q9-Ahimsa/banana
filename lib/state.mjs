// `state lint` (#9 project mode, #13 global mode): lints a STATE.md page
// against the canon's mechanical invariants — never grades content, every
// verdict is reproducible from file bytes alone (no check may read the
// clock, so no `now` is ever injected here). Verdict tiers: FAIL (a
// mechanical invariant is broken), WARN (ambiguous residue a model should
// look at), PASS (neither). Exit codes: 0 PASS/WARN-only, 1 any FAIL, 2 usage
// error or the target STATE.md missing/unreadable. Contract:
// docs/DESIGN.md `state lint` — verdict contract,
// docs/adr/0004-state-lint-verdict-tiers.md,
// .agents/specs/cli-9-13-state-lint.md.
//
// Shared by project mode (#9) and global mode (#13): the qualifier-tolerant
// heading matcher, the owner matcher, the cap check, the Finding shape, and
// the output formatter are all mode-agnostic pure functions reused by both
// `lintProjectState` and `lintGlobalState` below. `home` is never read from
// the real environment in this module (repo AGENTS.md rule) — always
// injected through `runStateLint`'s deps; only `bin/` resolves it to
// `os.homedir()`.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

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

/**
 * The four mandatory global-STATE.md sections (canon CONTINUITY.md's Global
 * grain), by full canonical name — the qualifier-tolerant matcher requires
 * this exact name as a prefix, so a bare `## Recently closed` heading does
 * NOT satisfy `Recently closed (context for next session)`: the parenthetical
 * is part of the required name here, not an optional qualifier.
 */
export const REQUIRED_GLOBAL_SECTIONS = [
  'Active threads',
  'Backlog (owned)',
  'Watch',
  'Recently closed (context for next session)',
];

/** `state` command verb vocabulary — room for more, `lint` only today. */
const STATE_VERBS = ['lint'];

/**
 * @typedef {object} StateFlags
 * @property {'lint'} verb
 * @property {boolean} global true iff `--global` was passed
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
 * @throws on a missing/unknown verb or unknown flag
 */
export function parseStateArgs(argv) {
  if (argv.length === 0) throw new Error(`missing verb (expected ${STATE_VERBS.join('|')})`);
  const [verb, ...rest] = argv;
  if (!STATE_VERBS.includes(verb)) {
    throw new Error(`unknown state verb '${verb}' (expected ${STATE_VERBS.join('|')})`);
  }
  let global = false;
  for (const arg of rest) {
    if (arg === '--global') global = true;
    else throw new Error(`unknown option '${arg}'`);
  }
  return { verb: 'lint', global };
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

/** Strip one leading markdown-emphasis marker (`**`, `*`, `__`, `_`). */
function stripLeadingEmphasis(content) {
  return content.replace(/^(\*\*|\*|__|_)/, '');
}

/**
 * True iff a top-level bullet is a template placeholder — content (after
 * removing the `- `/`* ` marker and one leading emphasis marker) starts with
 * `(`. Shared by the owner matcher (project `## Next`, global
 * `## Backlog (owned)`) and the global `## Active threads` freshness checks
 * (#13): a placeholder Active-threads/Backlog bullet is skipped by every
 * check that reads bullet content, not just ownership.
 * @param {string} line a raw line already known to match /^[-*] /
 * @returns {boolean}
 */
export function isPlaceholderBullet(line) {
  const rawContent = line.slice(2); // strip the leading `- ` / `* ` marker
  return stripLeadingEmphasis(rawContent).startsWith('(');
}

/**
 * Classify a top-level bullet's ownership per the shared owner matcher
 * (project `## Next`, global `## Backlog (owned)`, #13). The literal,
 * unsubstituted bootstrap placeholder token `__OWNER__` is checked against
 * the RAW bullet content first — before the leading-emphasis strip below,
 * which would otherwise consume `__OWNER__`'s own wrapping underscores
 * before any comparison could see them. Past that, content is stripped of
 * one leading markdown-emphasis marker; a bullet whose stripped content
 * starts with `(` is a template placeholder (see isPlaceholderBullet). A
 * bullet is owned iff its (stripped) content matches `owner — text`
 * (em-dash), the owner token itself carries no em-dash, and the owner
 * token — after stripping one trailing emphasis marker — is not `unowned`
 * (case-insensitive).
 * @param {string} line a raw line already known to match /^[-*] /
 * @returns {'owned' | 'unowned' | 'placeholder'}
 */
export function classifyOwnerBullet(line) {
  const rawContent = line.slice(2); // strip the leading `- ` / `* ` marker
  if (/^__OWNER__(\s|$)/.test(rawContent)) return 'unowned';

  const content = stripLeadingEmphasis(rawContent);
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

// --- Global mode (#13) ---------------------------------------------------

/** The freshness stamp on an Active-threads bullet: `(as of YYYY-MM-DD)`. */
const AS_OF_STAMP_RE = /\(as of (\d{4}-\d{2}-\d{2})\)/;

/**
 * The pointer target text: the first backtick-quoted span after the arrow,
 * else the first whitespace-delimited token. Null when there is nothing
 * after the arrow to resolve.
 * @param {string} afterArrow the bullet text after the LAST `→`
 * @returns {string | null}
 */
function extractPointerTarget(afterArrow) {
  const backtick = afterArrow.match(/`([^`]+)`/);
  if (backtick) return backtick[1];
  const trimmed = afterArrow.trim();
  return trimmed === '' ? null : trimmed.split(/\s+/)[0];
}

/**
 * Resolve a pointer target string to an absolute STATE.md path, or null when
 * the form is unrecognized or it does not name a file called `STATE.md`
 * (case-sensitive). `~/` and `~\` resolve against `home`; `X:\…`, `X:/…`,
 * `/…` are absolute as-is; anything else is unverifiable. A target that is a
 * directory resolves to `<dir>/STATE.md`. Does not check readability — that
 * is `readTargetStateMd`'s job.
 * @param {string | null} rawTarget
 * @param {string} home
 * @returns {string | null}
 */
function resolvePointerPath(rawTarget, home) {
  if (rawTarget === null) return null;
  /** @type {string} */
  let p;
  if (rawTarget.startsWith('~/') || rawTarget.startsWith('~\\')) {
    p = join(home, rawTarget.slice(2));
  } else if (/^[A-Za-z]:[\\/]/.test(rawTarget) || rawTarget.startsWith('/')) {
    p = rawTarget;
  } else {
    return null; // unrecognized form — unverifiable
  }
  try {
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'STATE.md');
  } catch {
    return null;
  }
  return basename(p) === 'STATE.md' ? p : null;
}

/**
 * Read and CRLF-normalize a resolved target STATE.md, or null when it does
 * not exist, is not a file, or is unreadable.
 * @param {string} path
 * @returns {string | null}
 */
function readTargetStateMd(path) {
  try {
    if (!existsSync(path) || statSync(path).isDirectory()) return null;
    return normalizeCRLF(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * FAIL `thread-unstamped` / `thread-no-pointer` / `thread-stale`, WARN
 * `thread-unverifiable` / `thread-target-undated` — over every non-placeholder
 * top-level `## Active threads` bullet. A bullet with no `→` skips pointer
 * resolution entirely (nothing to resolve); `thread-stale` only fires when
 * BOTH a stamp and a resolved, dated target exist (equal dates pass).
 * @param {string} text CRLF-normalized
 * @param {string} home
 * @returns {Finding[]}
 */
export function checkActiveThreads(text, home) {
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, 'Active threads')) {
    if (isPlaceholderBullet(line)) continue;

    const stampMatch = line.match(AS_OF_STAMP_RE);
    const stamp = stampMatch ? stampMatch[1] : null;
    if (stamp === null) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-unstamped',
        message: `no "(as of YYYY-MM-DD)" freshness stamp: "${trimLine(line)}"`,
      });
    }

    const arrowIdx = line.lastIndexOf('→');
    if (arrowIdx === -1) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-no-pointer',
        message: `no "→" pointer to a project STATE.md: "${trimLine(line)}"`,
      });
      continue; // nothing to resolve without a pointer
    }

    const rawTarget = extractPointerTarget(line.slice(arrowIdx + 1));
    const targetPath = resolvePointerPath(rawTarget, home);
    const targetText = targetPath !== null ? readTargetStateMd(targetPath) : null;

    if (targetText === null) {
      findings.push({
        tier: 'WARN',
        type: 'thread-unverifiable',
        message: `pointer does not resolve to a readable STATE.md: "${trimLine(line)}"`,
      });
      continue;
    }

    const targetAsOf = stateAsOf(targetText);
    if (targetAsOf === null) {
      findings.push({
        tier: 'WARN',
        type: 'thread-target-undated',
        message: `${targetPath} has no "as of YYYY-MM-DD" date`,
      });
      continue;
    }

    if (stamp !== null && targetAsOf > stamp) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-stale',
        message: `bullet stamped (as of ${stamp}) but ${targetPath} is as of ${targetAsOf} — rebuild the stamp`,
      });
    }
  }
  return findings;
}

/**
 * Run every global-mode check and compose the findings. Never flags the
 * retired "rebuilt whole, never patched" header (checkRetiredHeader) — that
 * phrase is correct at this grain by design — and has no dirty-marker check:
 * the global page is rebuilt whole, never patched mid-arc, so there is no
 * standing-marker state to flag.
 * @param {string} text CRLF-normalized global STATE.md text
 * @param {{ home: string }} sources
 * @returns {Finding[]}
 */
export function lintGlobalState(text, { home }) {
  return [
    ...checkMissingSections(text, REQUIRED_GLOBAL_SECTIONS),
    ...checkOverCap(text),
    ...checkActiveThreads(text, home),
    ...checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned'),
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
 * Run a parsed `banana state lint` invocation: project mode (default) lints
 * `<cwd>/STATE.md`; `--global` (#13) lints `<home>/.agents/STATE.md` instead,
 * with no LOGBOOK.md/session.log inputs (global mode has none).
 * @param {StateFlags} flags
 * @param {{ cwd: string, io: StateIo, home: string }} deps
 * @returns {Promise<StateResult>}
 */
export async function runStateLint(flags, deps) {
  const { cwd, io, home } = deps;
  const err = io.err ?? io.out;

  if (flags.global) {
    const globalTarget = join(home, '.agents', 'STATE.md');
    /** @type {string} */
    let globalRaw;
    try {
      globalRaw = readFileSync(globalTarget, 'utf8');
    } catch {
      err(`banana state lint: ${globalTarget} is missing or unreadable`);
      return { code: 2 };
    }
    const globalText = normalizeCRLF(globalRaw);
    const globalFindings = lintGlobalState(globalText, { home });
    return emitFindings(io, globalFindings, '~/.agents/STATE.md');
  }

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
