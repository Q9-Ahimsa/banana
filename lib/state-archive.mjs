// `state archive` (ticket #20, Lane B; hardened #20b, Lane 2): moves — or,
// for `--reason trimmed`, copies — exactly one non-placeholder top-level
// bullet off the global page (`<home>/.agents/STATE.md`) into an
// append-only archive (`<home>/.agents/STATE-archive.md`). Canon rule this
// enforces: removal from the global page is a MOVE, never a silent delete.
// Lives in its own module, separate from lib/state.mjs: it reads the clock
// (for the record date AND the D3 safety gate below), so it must stay out
// of the clock-free lint module (ADR 0004 — no check in lib/state.mjs may
// read `now`). `home` and `now` are injected through deps; only `bin/`
// resolves `os.homedir()`/`Date.now()`. Contract: docs/DESIGN.md `state
// archive` — contract, .agents/specs/cli-20b-review-fixes.md.
//
// Reuses lib/state.mjs's exported bullet/section/stamp helpers
// (`prepareText`, `topLevelBullets`, `topLevelBulletRanges`,
// `isPlaceholderBullet`, `REQUIRED_GLOBAL_SECTIONS`, `bulletStampShapes`,
// `daysBetween`, `CLOSED_EXPIRY_DAYS`, `THREAD_INACTIVE_DAYS`, `excerpt60`,
// `oldestValidStamp`, `validateAgentTag`) and doctor.mjs's
// `isRealCalendarDate`/`headerBlock` rather than re-parsing the page or
// re-deriving date logic from scratch — in particular `topLevelBulletRanges`,
// which is the SAME primitive the lint's `bullet-wrapped` WARN measures a
// bullet's continuation lines with (#20c E2 — this module passes its OWN raw
// lines as that function's third argument so the two never disagree about
// what counts as a continuation), and `bulletStampShapes`/`oldestValidStamp`,
// the SAME stamp parser and selection rule the lint's closed/thread-stamp
// checks read through (#20c E10) — the lint and the archive must never
// disagree about a bullet's continuation lines or which stamp governs it.
// (H53 correction: `line-over-limit` measures a bullet's own physical line
// through `topLevelBullets`, never through `topLevelBulletRanges` — that
// primitive is shared for continuation-line counting only.)
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bulletStampShapes,
  CLOSED_EXPIRY_DAYS,
  daysBetween,
  excerpt60,
  isPlaceholderBullet,
  oldestValidStamp,
  prepareText,
  REQUIRED_GLOBAL_SECTIONS,
  THREAD_INACTIVE_DAYS,
  topLevelBulletRanges,
  topLevelBullets,
  validateAgentTag,
} from './state.mjs';
import { headerBlock, isRealCalendarDate } from './doctor.mjs';
import { formatLocalDate } from './sessionlog.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The archive file's header, byte-exact (#20c E6 — names the one exception
 * to "append-only": a pasted secret is deleted outright, here too, on
 * sight) — written once, the first time a page's archive is created.
 * `<term>` is literal instructional text for a human running the suggested
 * `grep`, not a placeholder this module ever substitutes. Matches the
 * by-hand block in canon/CONTINUITY.md byte-for-byte (pinned there and in
 * test/canon.test.mjs) and this module's own header test below.
 */
export const ARCHIVE_HEADER_LINES = [
  '# GLOBAL STATE — archive',
  '> Append-only — except a pasted secret: delete it here too, on sight. Lines moved off',
  '> ~/.agents/STATE.md (or the long form of trimmed ones), verbatim, newest last. Never',
  '> loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md',
];

/**
 * @typedef {import('./state.mjs').StateArchiveFlags} StateArchiveFlags
 */

/**
 * @typedef {object} StateArchiveIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err] defaults to out
 */

/**
 * @typedef {object} StateArchiveDeps
 * @property {string} home
 * @property {number} now epoch ms — the record's date is `formatLocalDate(now)`,
 *   and D3's clock gate compares bullet stamps against this SAME local day
 * @property {StateArchiveIo} io
 * @property {() => void} [onBetweenReads] TEST-ONLY seam: invoked after the
 *   temp file is written (or, for `trimmed`, right after validation — there
 *   is no temp file on that path) and before re-read guard 1's read — lets a
 *   test mutate the page on disk mid-flight to exercise that guard. Never
 *   set outside tests.
 * @property {() => void} [onBeforeGuard2] TEST-ONLY seam: invoked after the
 *   archive record has been appended and before re-read guard 2's read —
 *   lets a test mutate the page in the window the second guard exists to
 *   catch. Never set outside tests; never fires on the `trimmed` path (one
 *   guard only).
 * @property {() => void} [onBeforeRename] TEST-ONLY seam: invoked ONCE,
 *   immediately before the temp-file rename (not re-invoked on a retry); if
 *   it throws, that failure is handled exactly like a real `renameSync`
 *   failure (temp unlinked, exit 2, the archive-already-holds-a-copy
 *   message) — lets a test exercise the rename-failure path without
 *   depending on a real, platform-specific I/O failure. Never set outside
 *   tests.
 * @property {() => void} [onBeforeTempWrite] TEST-ONLY seam (#20c H73):
 *   invoked immediately before the temp file is written; if it throws,
 *   that failure is handled exactly like a real temp-write failure (temp
 *   unlinked — a no-op here, since nothing was written yet — exit 2,
 *   "nothing written") — lets a test exercise that path, which no other
 *   seam reaches. Never set outside tests.
 * @property {(from: string, to: string) => void} [renameSyncOverride]
 *   TEST-ONLY seam (#20c E5/H2): replaces `node:fs`'s `renameSync` inside
 *   the retry loop — lets a test simulate transient `EPERM`/`EACCES`/
 *   `EBUSY` failures (then success, or then exhaustion) without a real
 *   file lock. Never set outside tests.
 * @property {number} [renameRetryBudgetMs] TEST-ONLY seam (#20c E5/H2):
 *   overrides the rename retry loop's total backoff budget (production
 *   default ~2000ms) — lets a test exercise "retries, then gives up"
 *   without a multi-second wait. Never set outside tests.
 */

/**
 * @typedef {object} StateArchiveResult
 * @property {number} code 0 ok, 2 usage or state — unlike `state lint`'s
 *   three-tier PASS/WARN/FAIL, archive moves bytes, it never grades them,
 *   so there is no FAIL/`1` tier here.
 */

/**
 * @typedef {{ start: number, end: number, content: string, eol: string }} RawLine
 */

/**
 * Split raw text into physical lines, each paired with its OWN [start, end)
 * byte range in `raw` (end exclusive, inclusive of the line's own
 * terminator) and its own terminator (`\r\n`, `\r`, `\n`, or `''` for the
 * final line). Deliberately NOT a split+rejoin of the whole document — the
 * write path below only ever slices pieces OUT of the ORIGINAL `raw` string
 * using these offsets, so every byte outside a touched range is untouched by
 * construction, even on a page with mixed line endings — the mechanism
 * behind the spec's "no other byte of the page changes."
 *
 * ALWAYS pushes a final entry, even when `raw` ends exactly on a terminator
 * (integration fix, 2026-10-01): `String.prototype.split` always yields one
 * more token than there are separators (a trailing empty string when the
 * text ends in one), and the bullet line-index ranges this module maps onto
 * these entries come from `topLevelBulletRanges(prepareText(raw), ...)`,
 * which is computed via exactly that `.split('\n')` — so this function's
 * own line count must match `.split`'s, token for token, or the LAST
 * possible index (every real STATE.md page ends in a trailing newline) maps
 * out of bounds. A dropped final entry here previously under-counted by
 * one whenever `raw` ended in a terminator, silently misaligning any
 * bullet range whose end reached the very last line.
 * @param {string} raw
 * @returns {RawLine[]}
 */
function indexLines(raw) {
  /** @type {RawLine[]} */
  const lines = [];
  const re = /\r\n|\r|\n/g;
  let start = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const end = m.index + m[0].length;
    lines.push({ start, end, content: raw.slice(start, m.index), eol: m[0] });
    start = end;
  }
  lines.push({ start, end: raw.length, content: raw.slice(start), eol: '' });
  return lines;
}

/**
 * The dominant line terminator among `lines` — CRLF, lone-CR (#20b review
 * item 4: an old-Mac-style page, every line terminated `\r` alone, previously
 * fell through this function's binary CRLF-vs-LF count to a wrong `'\n'`
 * default, since neither counter was ever incremented for it) or LF,
 * whichever has the most lines, ties broken LF < CRLF < lone-CR (favors the
 * more common modern convention on an exact tie). Used only as the FALLBACK
 * terminator for a freshly inserted placeholder line when the removed line
 * itself carried none (see the removal logic below, which prefers the
 * removed line's OWN terminator first), and to seed a freshly-created
 * archive file's own line ending.
 * @param {RawLine[]} lines
 * @returns {string}
 */
function dominantEol(lines) {
  const counts = { '\r\n': 0, '\n': 0, '\r': 0 };
  for (const l of lines) {
    if (l.eol === '\r\n' || l.eol === '\n' || l.eol === '\r') counts[l.eol]++;
  }
  /** @type {'\r\n' | '\n' | '\r'} */
  let best = '\n';
  let bestCount = counts['\n'];
  for (const eol of /** @type {('\r\n' | '\r')[]} */ (['\r\n', '\r'])) {
    if (counts[eol] > bestCount) {
      best = eol;
      bestCount = counts[eol];
    }
  }
  return best;
}

/**
 * The ONE placeholder bullet line a freshly-bootstrapped section carries,
 * read from templates/global-STATE.md AT RUNTIME on every call — never
 * cached, never hardcoded here: Lane A of this same ticket changes the
 * `Recently closed` placeholder text, so hardcoding any section's
 * placeholder would drift the moment that lands. When `ownerName` is given
 * (#20b review item 4), the literal `__OWNER__` bootstrap token — some
 * placeholders (`Backlog (owned)`'s) carry it as illustrative example text —
 * is substituted with it, the SAME `.replaceAll('__OWNER__', owner)` step
 * `lib/project.mjs`/`lib/init.mjs` apply when a page is first bootstrapped,
 * so a placeholder re-inserted here reads exactly like a freshly-bootstrapped
 * page would for this owner, not the raw template's generic token.
 * @param {string} name exact section name, e.g. 'Watch'
 * @param {string | null} ownerName
 * @returns {string}
 */
function sectionPlaceholderLine(name, ownerName) {
  const templateRaw = readFileSync(join(KIT_ROOT, 'templates', 'global-STATE.md'), 'utf8');
  const bullets = topLevelBullets(prepareText(templateRaw), name);
  const line = bullets[0];
  return ownerName !== null ? line.replaceAll('__OWNER__', ownerName) : line;
}

/**
 * The owner named on the page's own header `Owner: <name>. Protocol:` line
 * (#20c E9, fixing H7/C9), or null when the header carries no such shape.
 * The name is everything between `Owner: ` and the `. Protocol:` that
 * follows it — not just up to the first period — so a name with a period in
 * it (`Owner: Jane Q. Public. Protocol:`) survives whole instead of
 * truncating at the middle initial.
 * @param {string} preparedText CRLF-normalized, fence/comment-blanked
 * @returns {string | null}
 */
function headerOwnerName(preparedText) {
  const m = headerBlock(preparedText).match(/Owner: (.+?)\. Protocol:/);
  return m ? m[1] : null;
}

/**
 * True iff `archiveRaw` carries no real content yet — missing (represented
 * here as `''`, the same value a missing file and a truly empty one share),
 * a lone byte-order-mark, nothing but line breaks, or any mix of those — so
 * it should get the header the SAME way a brand-new file does (#20c H65,
 * generalizing C8's empty-archive half: a file pre-created by `'' >
 * STATE-archive.md` in PowerShell, `echo. > STATE-archive.md` in cmd.exe, or
 * an empty UTF-8-with-BOM save are all "no content" in this sense, even
 * though none of them is the exact string `''`).
 * @param {string} archiveRaw
 * @returns {boolean}
 */
function isBlankArchive(archiveRaw) {
  return archiveRaw.replace(/﻿/g, '').replace(/\r\n|\r|\n/g, '') === '';
}

/**
 * How many trailing line-break terminators `text` ends with, CRLF-tolerant,
 * capped at the 2 this module ever needs to distinguish: 0 (no final
 * newline at all), 1 (terminated, but no blank line before the end yet), or
 * 2 (a blank line already sits at the end). Replaces the #20b-era
 * `endsWithBlankLine` boolean (#20c C8): that check only ever added ONE
 * terminator when none was there at all, so a non-empty archive with no
 * final newline got its last record glued directly under the new one, with
 * no blank-line separator — this function's 3-way result lets the caller
 * add exactly as many terminators as are actually missing.
 * @param {string} text
 * @returns {0 | 1 | 2}
 */
function trailingEolCount(text) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  let i = normalized.length;
  let count = 0;
  while (count < 2 && i > 0 && normalized[i - 1] === '\n') {
    count++;
    i--;
  }
  return /** @type {0 | 1 | 2} */ (count);
}

/**
 * The archive's LAST already-written record (`## [...] ... \n<bullet
 * line>`, EOL-normalized to `\n` and with any trailing blank line(s)
 * stripped), or null when the archive carries no record yet (missing,
 * blank, or header-only) — #20c E5, the primitive behind the "skip the
 * append when it would write a byte-identical duplicate" rule (C48/H38): a
 * retried run, or two concurrent runs issuing the exact same command, must
 * never append the same record twice.
 * @param {string} archiveRaw
 * @returns {string | null}
 */
function lastArchiveRecord(archiveRaw) {
  const normalized = archiveRaw.replace(/\r\n|\r/g, '\n');
  const idx = normalized.lastIndexOf('\n## [');
  if (idx === -1) return null;
  return normalized.slice(idx + 1).replace(/\n+$/, '');
}

/**
 * Every valid (real-calendar-date) stamp dated strictly after `today` among
 * the page's non-placeholder Active-threads `(as of …)` and Recently-closed
 * `(closed …)` bullets — the SAME two stamped sections/keywords
 * `globalReferenceDate` (lib/state.mjs) scans; Watch/Backlog never carry
 * this stamp convention. Returns the FIRST one found (Active threads before
 * Recently closed, each in page order) so a refusal can name exactly one —
 * #20b review D3's "if any stamp on the page is after today, name it."
 * @param {string} preparedText CRLF-normalized, fence/comment-blanked
 * @param {string} today YYYY-MM-DD
 * @returns {{ date: string, line: string } | null}
 */
function findFutureStamp(preparedText, today) {
  /** @type {[string, string][]} */
  const sections = [
    ['Active threads', 'as of'],
    ['Recently closed (context for next session)', 'closed'],
  ];
  for (const [section, keyword] of sections) {
    for (const line of topLevelBullets(preparedText, section)) {
      if (isPlaceholderBullet(line)) continue;
      for (const date of bulletStampShapes(line, keyword).filter(isRealCalendarDate)) {
        if (date > today) return { date, line };
      }
    }
  }
  return null;
}

/**
 * D3 (#20b review, refined #20c E10): the one clock-aware safety gate in
 * this feature. Only `--reason expired`/`inactive` read the clock at all —
 * every other reason returns null (gate passes) unconditionally. Checks, in
 * order: (1) any valid stamp ANYWHERE on the page dated after `today`
 * refuses first, naming it — a mistyped future stamp must be fixed before
 * any comparison here can be trusted; (2) the matched line's OWN stamp (the
 * keyword matching the reason: `closed` for `expired`, `as of` for
 * `inactive`) must exist and be a real calendar date, else refuse
 * suggesting `--reason removed`; (3) its age against `today` (`daysBetween`,
 * the SAME day arithmetic `lib/state.mjs`'s WARN checks use) must exceed the
 * matching limit (`CLOSED_EXPIRY_DAYS`/`THREAD_INACTIVE_DAYS`), else refuse
 * naming the age and the limit. A line carrying more than one valid stamp of
 * the relevant keyword compares against the SAME stamp the lint's own WARN
 * already picked — `oldestValidStamp`, the OLDEST valid one (#20c E10,
 * fixing H12) — rather than a second, independently-invented selection: the
 * gate must never refuse a line the lint has already called expired/inactive
 * using a different stamp than the lint used.
 * @param {StateArchiveFlags} flags
 * @param {string} matchedLinePrepared the matched bullet's own PREPARED
 *   (fence/comment-blanked) physical line — #20c E1/H3: the lint's stamp
 *   parsing and this gate must read the SAME text, never the raw line
 * @param {string} preparedText the whole prepared page text (for the future-stamp scan)
 * @param {string} today YYYY-MM-DD, `formatLocalDate(now)`
 * @returns {string | null} a refusal message (no `banana state archive: ` prefix), or null to proceed
 */
function d3ClockGateRefusal(flags, matchedLinePrepared, preparedText, today) {
  if (flags.reason !== 'expired' && flags.reason !== 'inactive') return null;

  const future = findFutureStamp(preparedText, today);
  if (future !== null) {
    return (
      `a stamp on the page is dated after today (${today}): "${future.date}" on "${excerpt60(future.line)}" — ` +
      'fix that stamp first'
    );
  }

  const keyword = flags.reason === 'expired' ? 'closed' : 'as of';
  const limit = flags.reason === 'expired' ? CLOSED_EXPIRY_DAYS : THREAD_INACTIVE_DAYS;
  const stampDate = oldestValidStamp(matchedLinePrepared, keyword);
  if (stampDate === null) {
    return (
      `--reason ${flags.reason} requires the line's own "(${keyword} YYYY-MM-DD)" stamp; none found — ` +
      'use --reason removed instead'
    );
  }
  const age = daysBetween(stampDate, today);
  if (age > limit) return null;
  return (
    `(${keyword} ${stampDate}) is only ${age} day(s) before today (${today}) — not yet ${flags.reason} ` +
    `(needs more than ${limit}); use --reason removed if it should go anyway`
  );
}

/**
 * The one section each clock-aware reason is defined against (#20c item 2,
 * closing C37's remaining gap): `expired` is "a closed line past its
 * expiry" — it only ever makes sense on a `Recently closed` bullet.
 * `inactive` and `closed` are both about an `Active threads` bullet (an
 * idle thread becoming a Backlog item, or a finished thread being archived
 * before its own Recently-closed line is added by hand) — neither reads a
 * clock-aware stamp from any other section. `trimmed` and `removed` carry
 * no section restriction; they work on a bullet in any of the four.
 * @type {{ [key: string]: string }}
 */
const REASON_HOME_SECTION = {
  expired: 'Recently closed (context for next session)',
  inactive: 'Active threads',
  closed: 'Active threads',
};

/**
 * Refuse, exit 2, when `reason` targets a bullet outside the one section it
 * is defined for (#20c item 2) — e.g. `--reason expired` on a Watch or
 * Backlog line, or `--reason closed`/`inactive` on a Recently-closed line.
 * `trimmed` and `removed` have no home section and always pass (return
 * null). This is independent of, and runs before, the D3 clock gate: a
 * Watch/Backlog bullet that happens to contain stamp-shaped text would
 * otherwise slip past D3's "no stamp found" refusal by accident.
 * @param {StateArchiveFlags['reason']} reason
 * @param {string} section the matched bullet's own section (REQUIRED_GLOBAL_SECTIONS member)
 * @returns {string | null} a refusal message (no `banana state archive: ` prefix), or null to proceed
 */
function reasonSectionRefusal(reason, section) {
  const homeSection = REASON_HOME_SECTION[reason];
  if (homeSection === undefined || section === homeSection) return null;
  return (
    `--reason ${reason} only applies to a bullet in "${homeSection}" — this bullet is in "${section}"; ` +
    'use --reason removed instead'
  );
}

/**
 * Final `inComment` state after scanning `line` from `line, entering with
 * `inComment` — the same open/close walk `stripCommentsFromLine`
 * (lib/state.mjs) does, kept as its own small copy here rather than an
 * export: this module only ever needs the boolean end-state, never the
 * blanked text (#20c E1/C1).
 * @param {string} line
 * @param {boolean} inComment
 * @returns {boolean}
 */
function lineEndsInComment(line, inComment) {
  let state = inComment;
  let rest = line;
  for (;;) {
    if (state) {
      const closeIdx = rest.indexOf('-->');
      if (closeIdx === -1) return true;
      rest = rest.slice(closeIdx + 3);
      state = false;
      continue;
    }
    const openIdx = rest.indexOf('<!--');
    if (openIdx === -1) return false;
    rest = rest.slice(openIdx + 4);
    state = true;
  }
}

/**
 * True iff `rawLinesContent[lineIndex]` opens a multi-line HTML comment it
 * does not close on the same line, OR closes one with no `<!--` earlier on
 * that SAME line — meaning the opener sat on an earlier line (#20c E1/C1).
 * Either shape means archiving just this one physical line would either
 * leave an orphaned, now-meaningless closing `-->` behind (re-exposing
 * nothing, but corrupting the comment the line below depended on) or
 * remove the ONLY `-->` that closes a comment opened earlier, silently
 * extending that comment over everything that follows (swallowing real
 * content). A comment that both opens and closes on the same line is
 * ordinary and is not flagged. Walks every line from the top of the
 * document so a comment opened several lines above is tracked correctly —
 * cheap enough at this module's 10k-char page cap.
 * @param {string[]} rawLinesContent raw lines (terminators already split out), in document order
 * @param {number} lineIndex
 * @returns {boolean}
 */
function lineCrossesCommentBoundary(rawLinesContent, lineIndex) {
  let inComment = false;
  for (let i = 0; i < lineIndex; i++) {
    inComment = lineEndsInComment(rawLinesContent[i], inComment);
  }
  const enteringInComment = inComment;
  const leavingInComment = lineEndsInComment(rawLinesContent[lineIndex], enteringInComment);
  return leavingInComment || enteringInComment;
}

/** Best-effort unlink of a single file — never throws (the file may already be gone). */
function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone, or never created — nothing to clean up
  }
}

/**
 * Block the calling thread for `ms` milliseconds via `Atomics.wait` on a
 * throwaway `SharedArrayBuffer` — a true sleep, not a CPU-spinning busy
 * loop, with no async plumbing needed in this otherwise fully synchronous
 * write path (#20c E5/H2).
 * @param {number} ms
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  const flag = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(flag, 0, 0, ms);
}

/** `renameSync` error codes worth retrying — all three are transient-hold shapes, not "this will never work." */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Rename `from` over `to` via `renameFn`, retrying on `EPERM`/`EACCES`/
 * `EBUSY` with short exponential backoff (50ms, 100ms, 200ms, 400ms, then
 * capped) for up to `budgetMs` total (#20c E5/H2 — on Windows, an
 * antivirus scanner or search indexer can hold the page open just long
 * enough to make an un-retried rename flaky; the pre-#20c in-place
 * `writeFileSync` never hit this because it writes THROUGH an open handle
 * rather than replacing the directory entry). Any other error code, or a
 * retryable one once the budget is spent, is rethrown as-is — the caller
 * handles it exactly like today's single-shot failure.
 * @param {string} from
 * @param {string} to
 * @param {(from: string, to: string) => void} renameFn
 * @param {number} budgetMs
 */
function renameWithRetry(from, to, renameFn, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let delay = 50;
  for (;;) {
    try {
      renameFn(from, to);
      return;
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
      if (typeof code !== 'string' || !RETRYABLE_RENAME_CODES.has(code) || Date.now() >= deadline) throw error;
      sleepSync(Math.max(0, Math.min(delay, deadline - Date.now())));
      delay = Math.min(delay * 2, 400);
    }
  }
}

/**
 * Read-only: what a prospective archive append would write, WITHOUT writing
 * anything (#20b review: dry-run previews this same computation; the real
 * write path calls this again, at the right pipeline position, immediately
 * before the actual `appendFileSync`). Edge cases (#20c C8/H65, generalizing
 * #20b item 5): an archive that doesn't exist, or carries no real content
 * yet (empty, a lone BOM, or nothing but line breaks), gets the header
 * first; one that exists with real content but ends with no final newline
 * at all gets TWO terminators inserted before the record (one to end its
 * own last line, one to open the blank-line separator); one that ends with
 * exactly one newline but no blank line gets ONE more; one that already
 * ends in a blank line gets none. The archive's own line ending wins once
 * it has one, else `pageEol` (the page's dominant ending) seeds it.
 * `isDuplicate` is true when the archive's LAST record already equals this
 * exact record (#20c E5) — the caller skips the real `appendFileSync` in
 * that case, so a retried run or two concurrent identical runs never write
 * the same record twice.
 * @param {string} archivePath
 * @param {string} pageEol
 * @param {string} recordHeading
 * @param {string} bulletLine
 * @returns {{ appendText: string, recordText: string, isDuplicate: boolean } | { error: string }}
 */
function composeArchiveAppend(archivePath, pageEol, recordHeading, bulletLine) {
  let archiveEol = pageEol === '' ? '\n' : pageEol;
  let archivePrefix = '';
  let archiveRaw = '';
  try {
    if (existsSync(archivePath)) {
      archiveRaw = readFileSync(archivePath, 'utf8');
      if (isBlankArchive(archiveRaw)) {
        archivePrefix = ARCHIVE_HEADER_LINES.join(archiveEol) + archiveEol + archiveEol;
      } else {
        archiveEol = dominantEol(indexLines(archiveRaw));
        const trailing = trailingEolCount(archiveRaw);
        archivePrefix = trailing === 0 ? archiveEol + archiveEol : trailing === 1 ? archiveEol : '';
      }
    } else {
      archivePrefix = ARCHIVE_HEADER_LINES.join(archiveEol) + archiveEol + archiveEol;
    }
  } catch (error) {
    return { error: `${archivePath} exists but could not be read: ${error instanceof Error ? error.message : error}` };
  }
  const recordText = [recordHeading, bulletLine].join(archiveEol);
  const appendText = archivePrefix + recordText + archiveEol + archiveEol;
  const isDuplicate = lastArchiveRecord(archiveRaw) === recordText.replace(/\r\n|\r/g, '\n');
  return { appendText, recordText, isDuplicate };
}

/**
 * Run a parsed `banana state archive` invocation (ticket #20, Lane B;
 * hardened #20b, Lane 2): move (or, for `trimmed`, copy) exactly one matched
 * top-level bullet off the global page into the append-only archive — see
 * docs/DESIGN.md `state archive` — contract. Never throws: every failure
 * mode is caught and returned as `{ code: 2 }` with a message on `io.err`,
 * the same convention `runStateLint` uses (bin/banana.mjs wires neither call
 * in a try/catch).
 * @param {StateArchiveFlags} flags
 * @param {StateArchiveDeps} deps
 * @returns {Promise<StateArchiveResult>}
 */
export async function runStateArchive(flags, deps) {
  const { home, now, io } = deps;
  const err = io.err ?? io.out;
  const pagePath = join(home, '.agents', 'STATE.md');
  const archivePath = join(home, '.agents', 'STATE-archive.md');

  /** @type {Buffer} */
  let rawBuffer;
  try {
    rawBuffer = readFileSync(pagePath);
  } catch {
    err(`banana state archive: ${pagePath} is missing or unreadable`);
    return { code: 2 };
  }

  // #20c E5/H1: resolve the page's real path (following a symlink) before
  // any write planning — the temp file and the rename target both belong
  // next to the REAL file, never the symlink's own directory entry, so a
  // symlinked page's link survives the move intact. A page with more than
  // one hard link is refused outright, before any other validation below:
  // a rename there would silently detach one copy from the other, which no
  // caller expects.
  let realPagePath = pagePath;
  try {
    realPagePath = realpathSync(pagePath);
  } catch {
    // readFileSync above already proved the path resolves to a readable
    // file; a realpath failure here would be bizarre (e.g. deleted between
    // the two calls) — fall back to the given path rather than block on it.
  }
  try {
    const pageStat = statSync(realPagePath);
    if (pageStat.nlink > 1) {
      err(
        `banana state archive: ${pagePath} has more than one hard link (${pageStat.nlink}) — refusing to ` +
          'replace it; edit the file directly instead',
      );
      return { code: 2 };
    }
  } catch {
    // again, readFileSync already proved the file is there and readable.
  }

  const raw1 = rawBuffer.toString('utf8');

  const preparedText = prepareText(raw1);
  const rawLines = indexLines(raw1);
  // #20c E2: the SAME raw-line array, index-aligned with
  // `preparedText.split('\n')`, that `topLevelBulletRanges` needs as its
  // third argument for the refined continuation-line rule — an indented
  // tail (a fence, a comment, plain wrapped prose) must count the SAME way
  // here as it does for the lint's `bullet-wrapped` WARN.
  const rawLinesContent = rawLines.map((l) => l.content);

  /** @type {{ section: string, firstLine: string, start: number, continuationLines: number }[]} */
  const candidates = [];
  for (const section of REQUIRED_GLOBAL_SECTIONS) {
    for (const g of topLevelBulletRanges(preparedText, section, rawLinesContent)) {
      const firstLine = rawLines[g.start].content;
      if (isPlaceholderBullet(firstLine)) continue;
      if (!firstLine.includes(flags.match)) continue;
      candidates.push({ section, firstLine, start: g.start, continuationLines: g.continuationLines });
    }
  }

  if (candidates.length === 0) {
    err(`banana state archive: no line matches "${flags.match}"`);
    return { code: 2 };
  }
  if (candidates.length > 1 && !candidates.every((c) => c.firstLine === candidates[0].firstLine)) {
    err(`banana state archive: "${flags.match}" matches ${candidates.length} lines — be more specific:`);
    for (const c of candidates) err(`  ${c.section} · "${excerpt60(c.firstLine)}"`);
    return { code: 2 };
  }

  const match = candidates[0];
  // #20b review item 6: several matches that remained (the guard above only
  // returns early on a REAL distinction) are byte-identical lines — not a
  // real ambiguity. Move the first occurrence and say so.
  const duplicateNote =
    candidates.length > 1
      ? `"${flags.match}" matched ${candidates.length} byte-identical lines — archiving the first occurrence (${match.section})`
      : null;

  // D1 (#20b review): the archive only ever moves one physical line. A
  // bullet with continuation lines refuses rather than guessing how much
  // trailing text belongs to it.
  if (match.continuationLines > 0) {
    const totalLines = match.continuationLines + 1;
    err(`banana state archive: bullet spans ${totalLines} lines; join it into one line first`);
    return { code: 2 };
  }

  // #20c E1/C1: a matched line that opens or closes a multi-line HTML
  // comment is refused outright — archiving just this one physical line
  // would corrupt the comment structure around it (see
  // lineCrossesCommentBoundary's own doc for the two shapes this covers).
  if (lineCrossesCommentBoundary(rawLinesContent, match.start)) {
    err(
      `banana state archive: the matched line opens or closes a multi-line HTML comment — archiving it ` +
        'would corrupt the comment; join the comment onto one line first',
    );
    return { code: 2 };
  }

  // #20c item 2 (closing C37's remaining gap): `expired` only ever targets
  // a Recently-closed bullet; `inactive`/`closed` only ever target an
  // Active-threads bullet. Runs before D3 so a Watch/Backlog line that
  // happens to contain stamp-shaped text can't slip past D3's "no stamp"
  // refusal by accident.
  const sectionRefusal = reasonSectionRefusal(flags.reason, match.section);
  if (sectionRefusal !== null) {
    err(`banana state archive: ${sectionRefusal}`);
    return { code: 2 };
  }

  const today = formatLocalDate(now);
  // #20c E1/H3: the D3 gate reads the matched bullet's PREPARED line (the
  // SAME text the lint's own stamp parsing reads), never the raw one.
  const matchedLinePrepared = preparedText.split('\n')[match.start];
  const gateRefusal = d3ClockGateRefusal(flags, matchedLinePrepared, preparedText, today);
  if (gateRefusal !== null) {
    err(`banana state archive: ${gateRefusal}`);
    return { code: 2 };
  }

  // #20b review item 3: bytes that don't round-trip through UTF-8 refuse
  // outright — `Buffer#toString('utf8')` never throws, it silently replaces
  // invalid sequences with U+FFFD, so the only way to detect this is a
  // round-trip comparison against the ORIGINAL bytes read above.
  if (!Buffer.from(raw1, 'utf8').equals(rawBuffer)) {
    err(`banana state archive: ${pagePath} is not valid UTF-8 (bytes do not round-trip) — fix the file's encoding first`);
    return { code: 2 };
  }

  const bulletLine = rawLines[match.start].content;
  const pageEol = dominantEol(rawLines);
  const recordHeading = `## [${today}] ${flags.tag} — ${flags.reason} · ${match.section}`;
  const actionLine = `archived (${flags.reason}): ${match.section} · "${excerpt60(match.firstLine)}" → ${archivePath}`;
  /** @type {string[]} */
  const reminderLines = [];
  if (flags.reason === 'inactive') {
    reminderLines.push(
      'reminder: add a one-line Backlog (owned) item for this thread — `owner — name: waiting on … → pointer`',
    );
  }
  if (flags.reason === 'trimmed') {
    reminderLines.push(`reminder: ${pagePath} was not modified — shorten this line in place`);
  }
  if (flags.reason === 'closed') {
    // #20c H16: `closed` is a two-step move (canon "The archive move" —
    // archive the Active-threads line, then add a Recently-closed line by
    // hand); without this reminder, nothing on the page or in the command's
    // own output ever prompts that second step.
    reminderLines.push(
      'reminder: add a one-line Recently-closed entry for this thread — ' +
        '`- **name** (closed YYYY-MM-DD) — outcome → pointer`',
    );
  }

  if (flags.dryRun) {
    const composed = composeArchiveAppend(archivePath, pageEol, recordHeading, bulletLine);
    if ('error' in composed) {
      err(`banana state archive: ${composed.error}`);
      return { code: 2 };
    }
    const dry = (/** @type {string} */ line) => io.out(`dry run — ${line}`);
    dry('nothing written. Record that would be appended:');
    if (duplicateNote) dry(duplicateNote);
    for (const line of composed.recordText.split(/\r\n|\r|\n/)) dry(line);
    dry(actionLine);
    for (const line of reminderLines) dry(line);
    return { code: 0 };
  }

  if (duplicateNote) io.out(duplicateNote);

  // `trimmed` never touches the page — compute nothing more than what the
  // single guard and the append need.
  if (flags.reason === 'trimmed') {
    if (deps.onBetweenReads) deps.onBetweenReads();
    /** @type {string} */
    let raw2;
    try {
      raw2 = readFileSync(pagePath, 'utf8');
    } catch {
      err(`banana state archive: ${pagePath} is missing or unreadable`);
      return { code: 2 };
    }
    if (raw2 !== raw1) {
      err(`banana state archive: ${pagePath} changed between read and write — nothing written, retry`);
      return { code: 2 };
    }
    const composed = composeArchiveAppend(archivePath, pageEol, recordHeading, bulletLine);
    if ('error' in composed) {
      err(`banana state archive: ${composed.error}`);
      return { code: 2 };
    }
    // #20c E5: skip the append entirely when the archive's last record is
    // already this exact record — a retry or a concurrent identical run
    // must never write the same record twice.
    if (!composed.isDuplicate) {
      try {
        appendFileSync(archivePath, composed.appendText, 'utf8');
      } catch (error) {
        err(`banana state archive: could not write ${archivePath}: ${error instanceof Error ? error.message : error} — nothing written`);
        return { code: 2 };
      }
    }
    io.out(actionLine);
    for (const line of reminderLines) io.out(line);
    return { code: 0 };
  }

  // --- Every other reason removes the matched bullet from the page. Compute
  // the new page text from raw1 (#20b review item 4: the removed line's OWN
  // terminator for an inserted placeholder, page-dominant fallback only when
  // it had none).
  const removeStart = rawLines[match.start].start;
  const removeEnd = rawLines[match.start].end;
  const bulletsInSection = topLevelBulletRanges(preparedText, match.section).length;
  let newRaw;
  if (bulletsInSection === 1) {
    const placeholder = sectionPlaceholderLine(match.section, headerOwnerName(preparedText));
    const removedEol = rawLines[match.start].eol;
    const insertEol = removedEol !== '' ? removedEol : pageEol;
    newRaw = raw1.slice(0, removeStart) + placeholder + insertEol + raw1.slice(removeEnd);
  } else {
    newRaw = raw1.slice(0, removeStart) + raw1.slice(removeEnd);
  }

  // --- Atomic page write (#20b review item 2): write the new page to a
  // temp file in the SAME directory, then rename it over the page. Order:
  // write temp -> re-read guard 1 (page unchanged since raw1, else unlink
  // temp, exit 2, nothing appended) -> append the archive record -> re-read
  // guard 2 (page unchanged since raw1, else unlink temp, exit 2, say the
  // archive holds a copy and the line is still on the page) -> rename.
  const tempPath = join(
    dirname(realPagePath),
    `${basename(realPagePath)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  try {
    if (deps.onBeforeTempWrite) deps.onBeforeTempWrite();
    writeFileSync(tempPath, newRaw, 'utf8');
  } catch (error) {
    safeUnlink(tempPath);
    err(`banana state archive: could not write a temp file next to ${pagePath}: ${error instanceof Error ? error.message : error} — nothing written`);
    return { code: 2 };
  }

  if (deps.onBetweenReads) deps.onBetweenReads();

  /** @type {string} */
  let raw2;
  try {
    raw2 = readFileSync(pagePath, 'utf8');
  } catch {
    safeUnlink(tempPath);
    err(`banana state archive: ${pagePath} is missing or unreadable`);
    return { code: 2 };
  }
  if (raw2 !== raw1) {
    safeUnlink(tempPath);
    err(`banana state archive: ${pagePath} changed between read and write — nothing written, retry`);
    return { code: 2 };
  }

  const composed = composeArchiveAppend(archivePath, pageEol, recordHeading, bulletLine);
  if ('error' in composed) {
    safeUnlink(tempPath);
    err(`banana state archive: ${composed.error}`);
    return { code: 2 };
  }
  // #20c E5: skip the append entirely when the archive's last record is
  // already this exact record — a retried run that got this far before
  // (its earlier rename having failed) must not write the line twice.
  if (!composed.isDuplicate) {
    try {
      appendFileSync(archivePath, composed.appendText, 'utf8');
    } catch (error) {
      safeUnlink(tempPath);
      err(`banana state archive: could not write ${archivePath}: ${error instanceof Error ? error.message : error} — nothing written`);
      return { code: 2 };
    }
  }

  if (deps.onBeforeGuard2) deps.onBeforeGuard2();

  /** @type {string} */
  let raw3;
  try {
    raw3 = readFileSync(pagePath, 'utf8');
  } catch {
    safeUnlink(tempPath);
    err(
      `banana state archive: ${pagePath} is missing or unreadable after archiving — the archive at ${archivePath} ` +
        'already holds a copy of the line; remove it from the page by hand',
    );
    return { code: 2 };
  }
  if (raw3 !== raw1) {
    safeUnlink(tempPath);
    err(
      `banana state archive: ${pagePath} changed after archiving — the archive at ${archivePath} already holds a ` +
        'copy of the line, but it is still on the page too; remove it from the page by hand',
    );
    return { code: 2 };
  }

  try {
    if (deps.onBeforeRename) deps.onBeforeRename();
    // #20c E5/H2: retry on EPERM/EACCES/EBUSY (a transient hold, e.g. a
    // Windows antivirus scanner or search indexer) with short backoff;
    // rename onto the REAL path so a symlinked page's link itself survives.
    renameWithRetry(tempPath, realPagePath, deps.renameSyncOverride ?? renameSync, deps.renameRetryBudgetMs ?? 2000);
  } catch (error) {
    safeUnlink(tempPath);
    err(
      `banana state archive: archived, but could not rename the temp file over ${pagePath}: ` +
        `${error instanceof Error ? error.message : error} — the archive already holds a copy of the line; ` +
        'remove it from the page by hand',
    );
    return { code: 2 };
  }

  io.out(actionLine);
  for (const line of reminderLines) io.out(line);
  return { code: 0 };
}
