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
//
// Review hardening (2026-09-28, adversarial round on 3526aed/bec16a1):
// every section/body scan, the as-of/stamp date logic, and the placeholder
// and owner matchers were hardened against 15 confirmed wrong-verdict
// inputs (fenced/commented headings, "any bullet starting with (" being
// exempt, page-wide/case-sensitive/first-match date parsing, arrows inside
// backticks or trailing prose, multiple stamps, single-strip emphasis,
// +/numbered/indented bullets, section bodies bleeding past a later H1,
// double-space-after-marker, stamp case, a mid-document BOM, a
// not-byte-exact dirty marker, and CR-only line endings) — see ADR 0004's
// "Review hardening" section for the one-line rule behind each fix.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { headerBlock, isRealCalendarDate, newestLogbookDate, stateAsOf, stateAsOfMalformed } from './doctor.mjs';
import { latestEntryDates, parseSessionLog, sessionLogPath } from './sessionlog.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
/**
 * The retired "rebuilt ... never patched" header rule — shared by BOTH
 * grains' retired-header checks (project: checkRetiredHeader, ADR 0001;
 * global: checkRetiredHeaderGlobal, ADR 0005, #15). Installed pages shipped
 * this rule in more than one wording ("Rebuilt whole, never patched.",
 * "Rebuilt, never patched.", the historical canon "Rebuilt from the
 * logbook, never patched."), sometimes with a blockquote line wrap falling
 * between "rebuilt" and "never patched" — so this matches the SENTENCE
 * SHAPE (the word "rebuilt", then "never patched" before the next period —
 * `[^.]` also stops the match from crossing a sentence boundary) rather
 * than one literal string. Only the migration target named in the finding
 * message differs between the two grains.
 */
export const RETIRED_HEADER_RE = /\brebuilt\b[^.]{0,60}?\bnever(?:\s|>)+patched\b/i;

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

/**
 * Normalize line endings (CRLF AND lone-CR old-Mac endings both become LF —
 * F15, review hardening 2026-09-28: `/\r\n?/g`, not `/\r\n/g`) and strip
 * every U+FEFF byte-order-mark, not just one at file start (F13): a BOM
 * glued directly in front of a heading mid-document (`\uFEFF## Next`) is
 * just as invisible-but-real-character as one at position 0, and either
 * would otherwise defeat every `^## ` anchor in this module.
 * @param {string} text
 * @returns {string}
 */
function normalizeCRLF(text) {
  return text.replace(/\r\n?/g, '\n').replace(/﻿/g, '');
}

/**
 * Blank fenced code regions (``` or ~~~, matching delimiter char, >=3) and
 * `<!-- ... -->` HTML comments (single- or multi-line) — every line they
 * touch becomes an empty line, so line indexes/counts stay stable and every
 * downstream check (section presence, body scans, as-of, dirty marker,
 * retired-header) sees only real page content, never quoted example text or
 * explanatory markup (F1, review hardening 2026-09-28). An unterminated
 * fence blanks to EOF — nothing after an unclosed fence can be trusted as
 * real content either.
 * @param {string} text CRLF-already-normalized
 * @returns {string}
 */
function blankNonSemanticRegions(text) {
  const lines = text.split('\n');
  const out = lines.slice();

  let inFence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence) {
      out[i] = '';
      if (new RegExp(`^\\s*\\${fenceChar}{3,}\\s*$`).test(line)) inFence = false;
      continue;
    }
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      inFence = true;
      fenceChar = m[1][0];
      out[i] = '';
    }
  }

  let inComment = false;
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    if (inComment) {
      out[i] = '';
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const startIdx = line.indexOf('<!--');
    if (startIdx === -1) continue;
    const closeIdx = line.indexOf('-->', startIdx + 4);
    out[i] = '';
    if (closeIdx === -1) inComment = true;
  }

  return out.join('\n');
}

/**
 * Full text-preparation pipeline every check runs against: normalize line
 * endings and strip BOMs, then blank fenced/commented regions (F1). The
 * entry point `runStateLint` uses on the raw file bytes before anything else
 * touches the text — exported as a test seam: every other exported check
 * function in this module documents itself as taking already-prepared text,
 * so a fixture exercising fence/comment/BOM/CR-only handling at that seam
 * (rather than only end-to-end through runStateLint) calls this first.
 * @param {string} raw
 * @returns {string}
 */
export function prepareText(raw) {
  return blankNonSemanticRegions(normalizeCRLF(raw));
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
 * A qualifier-tolerant `## <name>` heading matcher: `<name>` may be
 * followed by nothing, or by whitespace and then any text — `## Watch
 * (tripwires ...)` counts for `Watch`, but a glued suffix does not
 * (`## Watchlist` does NOT count for `Watch`), since real project pages
 * qualify their headings with parenthetical context (fixed 2026-09-28 after
 * the phase-1 smoke run exposed false-positive `missing-section` findings
 * on real pages — see ADR 0004).
 * @param {string} name exact section name, e.g. 'Watch', 'Dead ends'
 * @returns {RegExp}
 */
function headingMatcher(name) {
  return new RegExp(`^## ${escapeRegExp(name)}(?:\\s.*)?$`);
}

/**
 * The line index of the FIRST `## <name>` section heading, or -1 if absent
 * (qualifier-tolerant, see headingMatcher).
 * @param {string[]} lines text already split on '\n'
 * @param {string} name exact section name, e.g. 'Watch', 'Dead ends'
 * @returns {number}
 */
function sectionHeadingIndex(lines, name) {
  const re = headingMatcher(name);
  return lines.findIndex((l) => re.test(l.trimEnd()));
}

/**
 * True iff a `## <name>` section heading is present (qualifier-tolerant, see
 * headingMatcher).
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string} name exact section name, e.g. 'Watch', 'Dead ends'
 * @returns {boolean}
 */
export function hasSection(text, name) {
  return sectionHeadingIndex(text.split('\n'), name) !== -1;
}

/**
 * A top-level bullet marker: 0-1 leading spaces, then `-`, `*`, `+` or a
 * numbered marker (`\d+[.)]`), then a space or tab (F8, review hardening
 * 2026-09-28). Deliberately narrower than "any indentation": a genuinely
 * nested/indented bullet (2+ leading spaces, or a leading tab) is body
 * content, not a top-level item.
 */
const BULLET_MARKER_RE = /^ {0,1}(?:[-*+]|\d+[.)])[ \t]/;

/**
 * True iff `line` is a top-level bullet line (see BULLET_MARKER_RE).
 * @param {string} line
 * @returns {boolean}
 */
function isTopLevelBulletLine(line) {
  return BULLET_MARKER_RE.test(line);
}

/**
 * The bullet's content after its marker — stripped generically via
 * BULLET_MARKER_RE's own match rather than a hardcoded 2-char offset, so a
 * `+`/numbered marker or extra internal whitespace (F8/F11: `-  ahimsa`,
 * two spaces after the marker) still extracts cleanly, then `trimStart()`ed
 * defensively (F11's literal instruction).
 * @param {string} line a raw line already known to match isTopLevelBulletLine
 * @returns {string}
 */
function bulletContent(line) {
  return line.replace(BULLET_MARKER_RE, '').trimStart();
}

/**
 * Strip ONE layer of markdown emphasis from the START of `s` — the longest
 * matching marker first (`***`/`___` triple, then `**`/`__` double, then
 * `*`/`_` single) so a triple-wrapped word (`***unowned***`) unwraps in one
 * application per side instead of needing an open-ended repeat (which would
 * also eat into a literal word's OWN underscores, e.g. `__OWNER__` — F7,
 * review hardening 2026-09-28).
 * @param {string} s
 * @returns {string}
 */
function stripOneLeadingEmphasis(s) {
  return s.replace(/^(\*\*\*|\*\*|\*|___|__|_)/, '');
}

/** Strip ONE layer of markdown emphasis from the END of `s` — see stripOneLeadingEmphasis. */
function stripOneTrailingEmphasis(s) {
  return s.replace(/(\*\*\*|\*\*|\*|___|__|_)$/, '');
}

/**
 * Placeholder bullets no longer shipped in templates/ but still carried by
 * pages bootstrapped before an amendment changed the wording — recognized
 * alongside the current, dynamically-loaded set (loadPlaceholderPatterns)
 * so an un-migrated installed page doesn't spuriously fail a check that
 * only exists because of the new wording. #20: the Recently-closed
 * placeholder's text changed (the `(closed YYYY-MM-DD)` convention
 * replaces the old pointer-only phrasing); this is the old text, byte-exact.
 * @type {RegExp[]}
 */
const LEGACY_PLACEHOLDER_PATTERNS = [/^- \(last few finished threads, one line each, with pointers\)$/];

/**
 * Every top-level bullet line (trimmed) that appears literally in the
 * shipped bootstrap templates, with any `__OWNER__` token turned into a
 * wildcard — the ONLY placeholder bullets state lint recognizes (F2, review
 * hardening 2026-09-28): a placeholder is a bullet whose full (trimmed) text
 * matches one of these, not merely "starts with (" — a real, content-bearing
 * bullet that happens to open with a parenthetical
 * (`- (paused) rebuild the projection`) is checked like any other. The
 * `__OWNER__` wildcard means a freshly-`init`-ed/`project`-ed page's
 * placeholder bullets (owner already substituted) are still recognized —
 * not just the raw, never-bootstrapped template text. Also includes
 * LEGACY_PLACEHOLDER_PATTERNS (#20), retired bullets this module no longer
 * ships but must keep recognizing on already-installed pages.
 * @returns {RegExp[]}
 */
function loadPlaceholderPatterns() {
  const templateText = [
    readFileSync(join(KIT_ROOT, 'templates', 'project-STATE.md'), 'utf8'),
    readFileSync(join(KIT_ROOT, 'templates', 'global-STATE.md'), 'utf8'),
  ].join('\n');
  const bullets = templateText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*] /.test(line));
  const current = bullets.map((bullet) => {
    const pattern = escapeRegExp(bullet).replace(/__OWNER__/g, '(?:__OWNER__|\\S+)');
    return new RegExp(`^${pattern}$`);
  });
  return [...current, ...LEGACY_PLACEHOLDER_PATTERNS];
}

const PLACEHOLDER_PATTERNS = loadPlaceholderPatterns();

/**
 * True iff a top-level bullet is a template placeholder — its full trimmed
 * text matches one of the real, shipped template bullets (see
 * loadPlaceholderPatterns; F2). Shared by the owner matcher (project
 * `## Next`, global `## Backlog (owned)`) and the global `## Active threads`
 * freshness checks (#13): a placeholder Active-threads/Backlog bullet is
 * skipped by every check that reads bullet content, not just ownership.
 * @param {string} line a raw line already known to match isTopLevelBulletLine
 * @returns {boolean}
 */
export function isPlaceholderBullet(line) {
  const trimmed = line.trim();
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Classify a top-level bullet's ownership per the shared owner matcher
 * (project `## Next`, global `## Backlog (owned)`, #13). The literal,
 * unsubstituted bootstrap placeholder token `__OWNER__` is checked against
 * the bullet's raw content first (before the placeholder-pattern check),
 * so bare `__OWNER__` always fails even though it also matches one of the
 * wildcard placeholder patterns (F7's explicit "keep your pre-strip
 * `__OWNER__` check too" instruction). The owner token is matched directly
 * against the raw (unstripped) content — `\S+` naturally stops at the first
 * whitespace regardless of what emphasis markers are glued to it — then
 * both ends of the EXTRACTED TOKEN are stripped of one emphasis layer each
 * (F7) before the final `unowned`/`__OWNER__` comparison.
 * @param {string} line a raw line already known to match isTopLevelBulletLine
 * @returns {'owned' | 'unowned' | 'placeholder'}
 */
export function classifyOwnerBullet(line) {
  const rawContent = bulletContent(line);
  if (/^__OWNER__(\s|$)/.test(rawContent)) return 'unowned';
  if (isPlaceholderBullet(line)) return 'placeholder';

  const m = rawContent.match(/^(\S+)\s+—\s+\S/);
  if (!m) return 'unowned';
  let owner = m[1];
  if (owner.includes('—')) return 'unowned';
  owner = stripOneLeadingEmphasis(owner);
  owner = stripOneTrailingEmphasis(owner);
  if (owner.toLowerCase() === 'unowned' || owner === '__OWNER__') return 'unowned';
  return 'owned';
}

/**
 * Top-level bullets (see isTopLevelBulletLine) inside every occurrence of a
 * named `## ` section (F1: a page with a duplicated heading is scanned
 * under BOTH, not just the first — a duplicate heading's body must not go
 * silently unscanned). The section heading itself is qualifier-tolerant
 * (see headingMatcher): a page whose Next heading reads `## Next (owned)`
 * is still scanned as the `Next` section — otherwise a qualified heading
 * would silently skip the unowned-bullet scan, which prints identically to
 * a clean PASS. Each occurrence's body ends at the next heading of level 1
 * or 2 (`# ` or `## ` — F9: a deeper `###`/`####` heading or a `---` rule
 * does NOT end the body). Prose, blank lines, and indented/non-marker lines
 * are not top-level bullets and are skipped.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string} name exact section name, e.g. 'Next', 'Backlog (owned)'
 * @returns {string[]}
 */
/**
 * The line INDEXES (not content) of every top-level bullet across every
 * occurrence of a named section — the same scan topLevelBullets itself
 * runs, extracted as its own primitive (#20) so a caller that also needs a
 * bullet's CONTINUATION lines (topLevelBulletSpans, below) computes its span
 * boundaries from the same "where do top-level bullets live" scan
 * topLevelBullets returns content for, rather than a second,
 * independently-drifting one.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string} name exact section name, e.g. 'Next', 'Backlog (owned)'
 * @returns {number[]}
 */
function topLevelBulletLineIndexes(text, name) {
  const lines = text.split('\n');
  const re = headingMatcher(name);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i].trimEnd())) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,2} /.test(lines[j])) break;
      if (isTopLevelBulletLine(lines[j])) out.push(j);
    }
  }
  return out;
}

export function topLevelBullets(text, name) {
  const lines = text.split('\n');
  return topLevelBulletLineIndexes(text, name).map((i) => lines[i]);
}

/**
 * Every top-level bullet's FULL text in a named section — the bullet's own
 * marker line PLUS any continuation lines beneath it (#20 `line-over-limit`:
 * a wrapped bullet's length must be measured in full). This is deliberately
 * different from the Active-threads stamp/pointer scan (checkActiveThreads),
 * which reads a bullet as ONE physical line only by design (F14; canon:
 * "one line per in-flight project") — that rule exists so a wrapped
 * Active-threads bullet FAILs rather than being silently reconstructed;
 * `line-over-limit` has the opposite job, catching a bloated bullet
 * wherever its text physically lives, continuation lines included.
 *
 * A bullet's span runs from its own line up to (not including) the next
 * top-level bullet ANYWHERE in the body, or the next section boundary
 * (`#`/`##` heading) — whichever comes first — with any purely-blank
 * trailing lines dropped from the span (ordinary section-to-section
 * spacing is not the bullet's own content). Lines are joined with `\n`
 * (text is already CRLF-normalized by `prepareText`), so the result's JS
 * string length is exactly what a human reading the raw file would count.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string} name exact section name, e.g. 'Active threads'
 * @returns {{ line: string, fullText: string }[]}
 */
export function topLevelBulletSpans(text, name) {
  const lines = text.split('\n');
  return topLevelBulletLineIndexes(text, name).map((start) => {
    let end = start + 1;
    while (end < lines.length && !/^#{1,2} /.test(lines[end]) && !isTopLevelBulletLine(lines[end])) end++;
    while (end > start + 1 && lines[end - 1].trim() === '') end--;
    return { line: lines[start], fullText: lines.slice(start, end).join('\n') };
  });
}

/**
 * FAIL for every unowned top-level bullet in a named section — shared by
 * project `unowned-next` (`## Next`) and global `backlog-unowned`
 * (`## Backlog (owned)`, #13).
 * @param {string} text CRLF-normalized, fence/comment-blanked
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
 * see headingMatcher; trailing whitespace ok).
 * @param {string} text CRLF-normalized, fence/comment-blanked
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
 * yet — a fresh page, not a defect. Mutually exclusive with
 * checkAsOfMalformed at the `lintProjectState` call site: a malformed date
 * IS an attempt, so it gets its own FAIL type instead of also reporting
 * "missing."
 * @param {string} text CRLF-normalized, fence/comment-blanked
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
 * FAIL when the header's "as of" date is date-shaped but not a real
 * calendar date (2026-13-45, 2026-09-31, ...) — distinguishable from
 * as-of-missing, which is for no date attempt at all (F3, review hardening
 * 2026-09-28).
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkAsOfMalformed(text) {
  const malformed = stateAsOfMalformed(text);
  if (malformed === null) return [];
  return [
    { tier: 'FAIL', type: 'as-of-malformed', message: `header "as of ${malformed}" is not a real calendar date` },
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
 * Compared on `line.trim()` (F14, review hardening 2026-09-28), so a
 * trailing space or leading indentation doesn't hide a real marker — but
 * otherwise byte-exact: no other variation is tolerated.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkDirtyMarker(text) {
  const standing = text.split('\n').some((line) => line.trim() === DIRTY_MARKER_LINE);
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
 * WARN when the page's HEADER BLOCK (every line before the first `## `
 * heading — see `headerBlock`, ADR 0004's own header/body boundary, reused
 * here rather than a second parser) still carries the pre-amendment
 * "rebuilt whole, never patched" rule. Scoped to the header block, not the
 * whole page (#11 Part 1b, regression from Part 1's widened pattern): a body
 * bullet merely describing or quoting the retired rule in prose is content,
 * not the page's own stale header, and must not trip this. Project grain
 * only — migrates to rebuild-on-close (ADR 0001). See
 * checkRetiredHeaderGlobal for the global-grain counterpart (ADR 0005, #15),
 * which reuses this same RETIRED_HEADER_RE with a different migration
 * message.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkRetiredHeader(text) {
  if (!RETIRED_HEADER_RE.test(headerBlock(text))) return [];
  return [
    {
      tier: 'WARN',
      type: 'retired-header',
      message:
        'header carries the retired "rebuilt whole, never patched" rule — migrate to rebuild-on-close (ADR 0001)',
    },
  ];
}

/**
 * WARN when the GLOBAL page's HEADER BLOCK (see checkRetiredHeader; same
 * `headerBlock` boundary, not the whole page — #11 Part 1b) still carries
 * the pre-amendment "rebuilt whole, never patched" rule (#15, ADR 0005: the
 * global grain moved from whole rebuilds to per-thread edits, 2026-09-29).
 * Reuses RETIRED_HEADER_RE, the same single-sourced regex checkRetiredHeader
 * uses for the project-grain rule — both grains once shared the literal
 * template wording, so one pattern detects either grain's stale header;
 * only the message (and thus the migration it points a reader to) differs.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkRetiredHeaderGlobal(text) {
  if (!RETIRED_HEADER_RE.test(headerBlock(text))) return [];
  return [
    {
      tier: 'WARN',
      type: 'retired-header',
      message: 'header carries the retired whole-rebuild rule; migrate to per-thread edits (ADR 0005)',
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
 * Run every project-mode check and compose the findings. Prepares `raw`
 * itself (normalize line endings/BOM, blank fenced/commented regions — F1)
 * so this function is safe to call directly on real file content, not just
 * through `runStateLint`'s own pipeline — every lower-level check function
 * this composes still documents itself as taking already-prepared text.
 * @param {string} raw STATE.md text, as read from disk (any line-ending style)
 * @param {{ logbookText: string | null, sessionEntries: import('./sessionlog.mjs').LogEntry[] }} sources
 * @returns {Finding[]}
 */
export function lintProjectState(raw, { logbookText, sessionEntries }) {
  const text = prepareText(raw);
  const asOf = stateAsOf(text);
  const newestLogbook = logbookText !== null ? newestLogbookDate(logbookText) : null;
  const newestSession = newestSessionLogDate(sessionEntries);

  return [
    ...checkMissingSections(text, REQUIRED_PROJECT_SECTIONS),
    ...checkOverCap(text),
    ...checkUnownedBullets(text, 'Next', 'unowned-next'),
    // A malformed as-of IS an attempt — as-of-missing (no attempt at all)
    // and as-of-malformed are mutually exclusive, never both reported.
    ...(stateAsOfMalformed(text) !== null
      ? checkAsOfMalformed(text)
      : checkAsOfMissing(text, asOf, newestLogbook !== null)),
    ...checkStaleVsLogbook(asOf, newestLogbook),
    ...checkStaleVsSessionLog(asOf, newestSession),
    ...checkDirtyMarker(text),
    ...checkRetiredHeader(text),
  ];
}

// --- Global mode (#13) ---------------------------------------------------

/**
 * Every `(<keyword> YYYY-MM-DD)`-shaped stamp on a bullet line,
 * case-insensitive (F12), shape only (not yet validated as a real date), in
 * order of appearance. The convention stays exact otherwise: `(as of
 * 2026-09-28, rebuilt)` is not a match (the regex requires the closing
 * paren immediately after the date) — documented in DESIGN.md. `keyword`
 * defaults to the Active-threads freshness stamp's `as of`; #20's
 * Recently-closed `(closed YYYY-MM-DD)` stamp reuses this SAME hardened
 * shape rule with a different keyword instead of re-deriving it (spec:
 * "parsed with the SAME hardened rules... reuse, don't re-derive").
 * @param {string} line
 * @param {string} [keyword]
 * @returns {string[]}
 */
function bulletStampShapes(line, keyword = 'as of') {
  const re = new RegExp(`\\(${escapeRegExp(keyword)} (\\d{4}-\\d{2}-\\d{2})\\)`, 'gi');
  return [...line.matchAll(re)].map((m) => m[1]);
}

/**
 * The pointer target text after one `→`: the first backtick-quoted span,
 * else the first whitespace-delimited token. Null when there is nothing to
 * resolve.
 * @param {string} afterArrow the bullet text after one `→`
 * @returns {string | null}
 */
function extractPointerTarget(afterArrow) {
  const backtick = afterArrow.match(/`([^`]+)`/);
  if (backtick) return backtick[1];
  const trimmed = afterArrow.trim();
  return trimmed === '' ? null : trimmed.split(/\s+/)[0];
}

/** True iff a pointer-target candidate looks like a recognized path prefix. */
function looksLikePath(target) {
  if (target === null) return false;
  return (
    target.startsWith('~/') ||
    target.startsWith('~\\') ||
    /^[A-Za-z]:[\\/]/.test(target) ||
    target.startsWith('/')
  );
}

/**
 * The index of every `→` in `line` that is NOT inside a backtick span — an
 * arrow quoted as example text inside backticks (`` `a → b` ``) is not a
 * structural pointer delimiter (F5).
 * @param {string} line
 * @returns {number[]}
 */
function arrowIndexesOutsideBackticks(line) {
  /** @type {number[]} */
  const indexes = [];
  let inBacktick = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '`') {
      inBacktick = !inBacktick;
      continue;
    }
    if (!inBacktick && line[i] === '→') indexes.push(i);
  }
  return indexes;
}

/**
 * Select the bullet's real pointer target (F5, review hardening
 * 2026-09-28): among every `→` NOT inside a backtick span, take the LAST
 * one whose target candidate looks like a path — a trailing arrow in prose
 * after the real pointer (`(next: draft → review)`) does not win just for
 * being last, since "review" doesn't look like a path. Only when NONE of
 * the candidates look like a path does this fall back to the very last
 * candidate (which then correctly resolves to unverifiable).
 * @param {string} line
 * @returns {{ hasArrow: boolean, target: string | null }}
 */
function selectPointerTarget(line) {
  const arrowIdxs = arrowIndexesOutsideBackticks(line);
  if (arrowIdxs.length === 0) return { hasArrow: false, target: null };
  const candidates = arrowIdxs.map((i) => extractPointerTarget(line.slice(i + 1)));
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (looksLikePath(candidates[i])) return { hasArrow: true, target: candidates[i] };
  }
  return { hasArrow: true, target: candidates[candidates.length - 1] };
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
 * Read and prepare (normalize + blank) a resolved target STATE.md, or null
 * when it does not exist, is not a file, or is unreadable.
 * @param {string} path
 * @returns {string | null}
 */
function readTargetStateMd(path) {
  try {
    if (!existsSync(path) || statSync(path).isDirectory()) return null;
    return prepareText(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * FAIL `thread-unstamped` / `thread-no-pointer` / `thread-stamp-malformed` /
 * `thread-stale`, WARN `thread-unverifiable` / `thread-target-undated` —
 * over every non-placeholder top-level `## Active threads` bullet. A
 * bullet with no `→` (outside backticks) skips pointer resolution entirely
 * (nothing to resolve); a bullet whose stamps are ALL date-shaped-but-real
 * uses the OLDEST one for staleness comparison (F6: conservative — if any
 * reading of a multi-stamped bullet could be stale, treat it as stale);
 * `thread-stale` only fires when both a valid stamp and a resolved, dated
 * target exist (equal dates pass). A bullet is scanned as ONE physical
 * line only — a wrapped bullet (stamp/pointer on a following, differently
 * indented or unmarked line) is not joined into it and FAILs by design
 * (F14; canon: "one line per in-flight project").
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string} home
 * @returns {Finding[]}
 */
export function checkActiveThreads(text, home) {
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, 'Active threads')) {
    if (isPlaceholderBullet(line)) continue;

    const stampShapes = bulletStampShapes(line);
    const validStamps = stampShapes.filter(isRealCalendarDate);
    const malformedStamps = stampShapes.filter((s) => !isRealCalendarDate(s));
    /** @type {string | null} */
    let stamp = null;
    if (stampShapes.length === 0) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-unstamped',
        message: `no "(as of YYYY-MM-DD)" freshness stamp: "${trimLine(line)}"`,
      });
    } else if (malformedStamps.length > 0) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-stamp-malformed',
        message: `stamp "(as of ${malformedStamps[0]})" is not a real calendar date: "${trimLine(line)}"`,
      });
    } else {
      // F6: the OLDEST valid stamp — conservative when a bullet carries more than one.
      stamp = validStamps.reduce((a, b) => (b < a ? b : a));
    }

    const { hasArrow, target: rawTarget } = selectPointerTarget(line);
    if (!hasArrow) {
      findings.push({
        tier: 'FAIL',
        type: 'thread-no-pointer',
        message: `no "→" pointer to a project STATE.md: "${trimLine(line)}"`,
      });
      continue; // nothing to resolve without a pointer
    }

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

// --- #20: line limits, closed-stamp expiry, thread inactivity -----------

/**
 * Per-top-level-bullet character caps, by global-grain section (#20 spec's
 * "Shared constants" — Lane B's `banana state archive` reuses this same
 * object rather than re-deriving the numbers). Keyed by the exact section
 * name `topLevelBulletSpans`/`topLevelBullets` expect.
 */
export const SECTION_LINE_LIMITS = Object.freeze({
  'Active threads': 400,
  'Backlog (owned)': 300,
  Watch: 350,
  'Recently closed (context for next session)': 250,
});

/** A Recently-closed bullet expires this many days after the reference date (#20 spec). */
export const CLOSED_EXPIRY_DAYS = 7;

/** An Active-threads bullet goes inactive this many days after the reference date (#20 spec). */
export const THREAD_INACTIVE_DAYS = 30;

/**
 * Whole days from `olderISO` to `newerISO` (both `YYYY-MM-DD`), via
 * `Date.UTC` on the parsed parts only — never `new Date()` with no
 * arguments and never `Date.now()` (module invariant, ADR 0004: no check in
 * this file may read the clock). Positive when `newerISO` is the later date.
 * @param {string} olderISO
 * @param {string} newerISO
 * @returns {number}
 */
function daysBetween(olderISO, newerISO) {
  const [oy, om, od] = olderISO.split('-').map(Number);
  const [ny, nm, nd] = newerISO.split('-').map(Number);
  return Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(oy, om - 1, od)) / 86400000);
}

/**
 * WARN `line-over-limit` (#20): a non-placeholder top-level bullet's FULL
 * text (own line plus continuation lines — see topLevelBulletSpans) longer
 * than its section's cap (SECTION_LINE_LIMITS). WARN, not FAIL: fixing it
 * needs a model's judgment about what to cut, not a mechanical rewrite —
 * the page-wide `over-cap` check stays the FAIL backstop. The message's
 * bullet preview collapses embedded newlines to spaces (a continuation-line
 * bullet is multi-line internally; the preview itself should not be).
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkLineOverLimit(text) {
  /** @type {Finding[]} */
  const findings = [];
  for (const [name, limit] of Object.entries(SECTION_LINE_LIMITS)) {
    for (const { line, fullText } of topLevelBulletSpans(text, name)) {
      if (isPlaceholderBullet(line)) continue;
      if (fullText.length <= limit) continue;
      const preview = fullText.replace(/\n/g, ' ').slice(0, 60);
      findings.push({
        tier: 'WARN',
        type: 'line-over-limit',
        message:
          `"## ${name}" bullet is ${fullText.length} chars (limit ${limit}): "${preview}" — archive the full ` +
          'text (`banana state archive --global --reason trimmed --match …`), then shorten it in place',
      });
    }
  }
  return findings;
}

/**
 * WARN `closed-undated` (#20): a non-placeholder `## Recently closed
 * (context for next session)` bullet with no valid `(closed YYYY-MM-DD)`
 * stamp — covers both "no stamp at all" and "stamp(s) present but every one
 * is date-shaped-but-impossible" alike (the spec names one WARN for "no
 * valid stamp," not a separate malformed type the way Active-threads does).
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {Finding[]}
 */
export function checkClosedUndated(text) {
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, 'Recently closed (context for next session)')) {
    if (isPlaceholderBullet(line)) continue;
    const validStamps = bulletStampShapes(line, 'closed').filter(isRealCalendarDate);
    if (validStamps.length > 0) continue;
    findings.push({
      tier: 'WARN',
      type: 'closed-undated',
      message: `no valid "(closed YYYY-MM-DD)" stamp: "${trimLine(line)}"`,
    });
  }
  return findings;
}

/**
 * WARN `closed-expired` (#20): a non-placeholder Recently-closed bullet
 * whose `(closed …)` stamp is more than CLOSED_EXPIRY_DAYS before
 * `referenceDate` (equal to the limit passes; one day over warns). Skipped
 * entirely when `referenceDate` is null (no valid stamp anywhere on the
 * page to measure against — spec) or when the bullet itself has no valid
 * stamp (checkClosedUndated's job, not this one's). A bullet carrying more
 * than one valid stamp compares against the OLDEST (conservative — mirrors
 * Active-threads F6: if any reading could be expired, treat it as expired).
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string | null} referenceDate
 * @returns {Finding[]}
 */
export function checkClosedExpired(text, referenceDate) {
  if (referenceDate === null) return [];
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, 'Recently closed (context for next session)')) {
    if (isPlaceholderBullet(line)) continue;
    const validStamps = bulletStampShapes(line, 'closed').filter(isRealCalendarDate);
    if (validStamps.length === 0) continue;
    const closedDate = validStamps.reduce((a, b) => (b < a ? b : a));
    const age = daysBetween(closedDate, referenceDate);
    if (age <= CLOSED_EXPIRY_DAYS) continue;
    findings.push({
      tier: 'WARN',
      type: 'closed-expired',
      message:
        `closed ${closedDate} is ${age} days before the reference date ${referenceDate} (expires after ` +
        `${CLOSED_EXPIRY_DAYS}): "${trimLine(line)}" — archive it (\`banana state archive --global --reason ` +
        'expired --match …`)',
    });
  }
  return findings;
}

/**
 * WARN `thread-inactive` (#20): a non-placeholder Active-threads bullet
 * whose `(as of …)` stamp is more than THREAD_INACTIVE_DAYS before
 * `referenceDate` (equal to the limit passes). Skipped entirely when
 * `referenceDate` is null, or when the bullet has no valid stamp
 * (thread-unstamped/thread-stamp-malformed's job, not this one's — see
 * checkActiveThreads). Multiple valid stamps compare against the OLDEST,
 * same conservative rule as checkClosedExpired/F6.
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @param {string | null} referenceDate
 * @returns {Finding[]}
 */
export function checkThreadInactive(text, referenceDate) {
  if (referenceDate === null) return [];
  /** @type {Finding[]} */
  const findings = [];
  for (const line of topLevelBullets(text, 'Active threads')) {
    if (isPlaceholderBullet(line)) continue;
    const validStamps = bulletStampShapes(line).filter(isRealCalendarDate);
    if (validStamps.length === 0) continue;
    const stamp = validStamps.reduce((a, b) => (b < a ? b : a));
    const age = daysBetween(stamp, referenceDate);
    if (age <= THREAD_INACTIVE_DAYS) continue;
    findings.push({
      tier: 'WARN',
      type: 'thread-inactive',
      message:
        `thread stamped (as of ${stamp}) is ${age} days before the reference date ${referenceDate} (inactive ` +
        `after ${THREAD_INACTIVE_DAYS} days): "${trimLine(line)}" — archive it (\`banana state archive --global ` +
        '--reason inactive --match …`), then add a one-line Backlog item `owner — name: waiting on … → pointer`',
    });
  }
  return findings;
}

/**
 * The #20 clock-free reference date: the newest real calendar date among
 * the page's non-placeholder Active-threads `(as of …)` stamps and
 * Recently-closed `(closed …)` stamps — never the clock (module invariant,
 * ADR 0004) and never just the FIRST stamp found, since per-thread edits
 * (ADR 0005) land bullets in whatever order sessions touch them, not date
 * order. Null when the page carries no valid stamp of either kind;
 * checkClosedExpired/checkThreadInactive both skip their comparison
 * entirely in that case (spec: "with no valid stamp, skip the two date
 * checks").
 * @param {string} text CRLF-normalized, fence/comment-blanked
 * @returns {string | null} YYYY-MM-DD
 */
export function globalReferenceDate(text) {
  /** @type {string[]} */
  const dates = [];
  for (const line of topLevelBullets(text, 'Active threads')) {
    if (isPlaceholderBullet(line)) continue;
    dates.push(...bulletStampShapes(line).filter(isRealCalendarDate));
  }
  for (const line of topLevelBullets(text, 'Recently closed (context for next session)')) {
    if (isPlaceholderBullet(line)) continue;
    dates.push(...bulletStampShapes(line, 'closed').filter(isRealCalendarDate));
  }
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b > a ? b : a));
}

/**
 * Run every global-mode check and compose the findings. Prepares `raw`
 * itself (normalize line endings/BOM, blank fenced/commented regions — F1),
 * same rationale as lintProjectState. Flags the retired "rebuilt whole,
 * never patched" header via checkRetiredHeaderGlobal (#15, ADR 0005: the
 * global grain moved to per-thread edits, 2026-09-29) — still no
 * dirty-marker check, though: ADR 0005 introduced no marker convention for a
 * mid-arc patched global page, so there is no standing-marker state to flag.
 * #20 adds four WARN checks (line limits, closed-stamp expiry, thread
 * inactivity) sharing one clock-free reference date computed once here.
 * @param {string} raw global STATE.md text, as read from disk
 * @param {{ home: string }} sources
 * @returns {Finding[]}
 */
export function lintGlobalState(raw, { home }) {
  const text = prepareText(raw);
  const referenceDate = globalReferenceDate(text);
  return [
    ...checkMissingSections(text, REQUIRED_GLOBAL_SECTIONS),
    ...checkOverCap(text),
    ...checkActiveThreads(text, home),
    ...checkUnownedBullets(text, 'Backlog (owned)', 'backlog-unowned'),
    ...checkRetiredHeaderGlobal(text),
    ...checkLineOverLimit(text),
    ...checkClosedUndated(text),
    ...checkClosedExpired(text, referenceDate),
    ...checkThreadInactive(text, referenceDate),
  ];
}

/**
 * Findings-to-text formatting shared by `emitFindings` and
 * `collectStateLint`'s outcome builder (ticket #14: "one code path" for
 * every consumer of finding text) — FAIL first, then WARN, one line each:
 * `TIER [type] <file>: message`.
 * @param {Finding[]} findings
 * @param {string} file printed as the `<file>` token on every finding line
 * @returns {string[]}
 */
function formatFindingLines(findings, file) {
  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  return [...fails, ...warns].map((f) => `${f.tier} [${f.type}] ${file}: ${f.message}`);
}

/**
 * The summary verdict text WITHOUT the `state lint: ` prefix — `PASS`,
 * `WARN (N warn)`, `FAIL (N fail, M warn)`. Shared by `emitFindings` (which
 * prefixes it for the CLI's own summary line) and `collectStateLint`'s
 * outcome (ticket #14: `banana brief`'s `project: <VERDICT> · global:
 * <VERDICT>` line prints this text with no `state lint: ` prefix at all).
 * @param {Finding[]} findings
 * @returns {string}
 */
function summaryVerdict(findings) {
  const fails = findings.filter((f) => f.tier === 'FAIL').length;
  const warns = findings.filter((f) => f.tier === 'WARN').length;
  if (fails > 0) return `FAIL (${fails} fail, ${warns} warn)`;
  if (warns > 0) return `WARN (${warns} warn)`;
  return 'PASS';
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
  for (const line of formatFindingLines(findings, file)) io.out(line);
  const verdict = summaryVerdict(findings);
  io.out(`state lint: ${verdict}`);
  return { code: verdict.startsWith('FAIL') ? 1 : 0 };
}

/**
 * Read a secondary input file that may or may not exist. Returns null when
 * it's absent (not a finding on its own — LOGBOOK.md/session.log are
 * optional). When it EXISTS but can't be read (permissions, or it's a
 * directory), that's a disk-state precondition failure, same tier as an
 * unreadable target — the caller reports it and exits 2, never silently
 * drops the input (review hardening 2026-09-28, "Unreadable inputs").
 * @param {string} path
 * @returns {{ text: string } | { text: null } | { unreadable: true }}
 */
function readOptionalInput(path) {
  if (!existsSync(path)) return { text: null };
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch {
    return { unreadable: true };
  }
}

/**
 * @typedef {{ verdict: string, findings: string[] }} StateLintFoundOutcome
 *   the target was read and linted; `verdict` is `summaryVerdict`'s text (no
 *   `state lint: ` prefix), `findings` are `formatFindingLines`' lines
 *   (FAILs first) — the same text `state lint` itself prints, ready for a
 *   caller to print verbatim.
 * @typedef {{ none: string }} StateLintNoneOutcome no target file exists;
 *   `none` is a short prose reason (e.g. `no STATE.md here`)
 * @typedef {{ unreadable: string }} StateLintUnreadableOutcome the target
 *   exists but could not be read; `unreadable` is the exact message
 *   `runStateLint` itself prints for that failure (names the file)
 * @typedef {StateLintFoundOutcome | StateLintNoneOutcome | StateLintUnreadableOutcome} StateLintOutcome
 */

/**
 * @typedef {object} StateLintCollected
 * @property {StateLintOutcome} project
 * @property {StateLintOutcome} global
 */

/**
 * Project-mode outcome: `<cwd>/STATE.md`, `<cwd>/LOGBOOK.md` and
 * `<cwd>/.agents/session.log` (both optional, same as `runStateLint`). A
 * missing target is `none`; an existing-but-unreadable target OR secondary
 * input is `unreadable`, carrying the exact `<path> is missing or
 * unreadable` text `runStateLint` itself prints for that failure.
 * @param {string} cwd
 * @returns {StateLintOutcome}
 */
function collectProjectOutcome(cwd) {
  const target = join(cwd, 'STATE.md');
  if (!existsSync(target)) return { none: 'no STATE.md here' };
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    return { unreadable: `${target} is missing or unreadable` };
  }

  const logbookPath = join(cwd, 'LOGBOOK.md');
  const logbookInput = readOptionalInput(logbookPath);
  if ('unreadable' in logbookInput) return { unreadable: `${logbookPath} is missing or unreadable` };
  const logbookText = logbookInput.text !== null ? normalizeCRLF(logbookInput.text) : null;

  const logPath = sessionLogPath(cwd);
  const sessionInput = readOptionalInput(logPath);
  if ('unreadable' in sessionInput) return { unreadable: `${logPath} is missing or unreadable` };
  /** @type {import('./sessionlog.mjs').LogEntry[]} */
  const sessionEntries = sessionInput.text !== null ? parseSessionLog(sessionInput.text) : [];

  const findings = lintProjectState(raw, { logbookText, sessionEntries });
  return { verdict: summaryVerdict(findings), findings: formatFindingLines(findings, 'STATE.md') };
}

/**
 * Global-mode outcome: `<home>/.agents/STATE.md`, no secondary inputs (same
 * rationale as `runStateLint`'s `--global` branch).
 * @param {string} home
 * @returns {StateLintOutcome}
 */
function collectGlobalOutcome(home) {
  const target = join(home, '.agents', 'STATE.md');
  if (!existsSync(target)) return { none: 'no ~/.agents/STATE.md' };
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    return { unreadable: `${target} is missing or unreadable` };
  }
  const findings = lintGlobalState(raw, { home });
  return { verdict: summaryVerdict(findings), findings: formatFindingLines(findings, '~/.agents/STATE.md') };
}

/**
 * Collect BOTH project (`<cwd>/STATE.md`) and global
 * (`<home>/.agents/STATE.md`) lint verdicts without printing — the shared
 * data source `runStateLint` itself now routes through (ticket #14: "one
 * code path"), and the seam any external caller (`banana brief`, `banana
 * log`'s post-close early catch) uses to get the SAME verdict/finding text
 * without going through argv/io. Never throws: every failure mode (missing
 * target, unreadable target or secondary input) is encoded in the return
 * shape instead.
 * @param {{ cwd: string, home: string }} deps
 * @returns {StateLintCollected}
 */
export function collectStateLint({ cwd, home }) {
  return { project: collectProjectOutcome(cwd), global: collectGlobalOutcome(home) };
}

/** The verdict text for one outcome, as printed after `project: `/`global: `. */
function outcomeVerdictText(outcome) {
  if ('none' in outcome) return `none (${outcome.none})`;
  if ('unreadable' in outcome) return `unreadable (${outcome.unreadable})`;
  return outcome.verdict;
}

/** True iff an outcome is PASS or the target doesn't exist — never true for `unreadable` (a real disk-state problem, not "nothing to report"). */
function outcomeCleanOrNone(outcome) {
  if ('none' in outcome) return true;
  if ('unreadable' in outcome) return false;
  return outcome.verdict === 'PASS';
}

/** True iff an outcome's own verdict is FAIL. */
function outcomeIsFail(outcome) {
  return 'verdict' in outcome && outcome.verdict.startsWith('FAIL');
}

/**
 * The printable `## State lint`-content lines (ticket #14): the
 * `project: <VERDICT> · global: <VERDICT>` summary line, then every project
 * finding then every global finding verbatim (state lint's own formatting —
 * `formatFindingLines`), then — iff either side's verdict is FAIL — the
 * fix-it closing line (exact text pinned by the spec). Shared verbatim by
 * `banana brief` (embeds this under its own `## State lint` heading; never
 * passes `quiet`) and `banana log`'s post-close early catch (no heading —
 * log's other output is plain status lines, not a markdown document;
 * `quiet` suppresses ONLY the summary line, and only when BOTH sides are
 * PASS or none — findings and the fix-it line always print regardless).
 * @param {StateLintCollected} collected
 * @param {{ quiet?: boolean }} [opts]
 * @returns {string[]}
 */
export function formatStateLintLines(collected, opts = {}) {
  const { project, global } = collected;
  const quiet = opts.quiet ?? false;
  /** @type {string[]} */
  const lines = [];
  if (!(quiet && outcomeCleanOrNone(project) && outcomeCleanOrNone(global))) {
    lines.push(`project: ${outcomeVerdictText(project)} · global: ${outcomeVerdictText(global)}`);
  }
  if ('findings' in project) lines.push(...project.findings);
  if ('findings' in global) lines.push(...global.findings);
  if (outcomeIsFail(project) || outcomeIsFail(global)) {
    lines.push('Fix these before relying on the page: a FAIL means STATE no longer projects its sources.');
  }
  return lines;
}

/**
 * Run a parsed `banana state lint` invocation: project mode (default) lints
 * `<cwd>/STATE.md`; `--global` (#13) lints `<home>/.agents/STATE.md` instead,
 * with no LOGBOOK.md/session.log inputs (global mode has none). Routes
 * through `collectStateLint` (ticket #14: "one code path") — this function's
 * own job is picking the right side of the collected pair and printing it.
 * @param {StateFlags} flags
 * @param {{ cwd: string, io: StateIo, home: string }} deps
 * @returns {Promise<StateResult>}
 */
export async function runStateLint(flags, deps) {
  const { cwd, io, home } = deps;
  const err = io.err ?? io.out;
  const { project, global } = collectStateLint({ cwd, home });

  if (flags.global) {
    if ('none' in global) {
      err(`banana state lint: ${join(home, '.agents', 'STATE.md')} is missing or unreadable`);
      return { code: 2 };
    }
    if ('unreadable' in global) {
      err(`banana state lint: ${global.unreadable}`);
      return { code: 2 };
    }
    for (const line of global.findings) io.out(line);
    io.out(`state lint: ${global.verdict}`);
    return { code: global.verdict.startsWith('FAIL') ? 1 : 0 };
  }

  if ('none' in project) {
    err(`banana state lint: ${join(cwd, 'STATE.md')} is missing or unreadable`);
    return { code: 2 };
  }
  if ('unreadable' in project) {
    err(`banana state lint: ${project.unreadable}`);
    return { code: 2 };
  }
  for (const line of project.findings) io.out(line);
  io.out(`state lint: ${project.verdict}`);
  return { code: project.verdict.startsWith('FAIL') ? 1 : 0 };
}
