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
// `daysBetween`, `CLOSED_EXPIRY_DAYS`, `THREAD_INACTIVE_DAYS`) and
// doctor.mjs's `isRealCalendarDate`/`headerBlock` rather than re-parsing the
// page or re-deriving date logic from scratch — in particular
// `topLevelBulletRanges`, which is the SAME primitive the lint's
// `line-over-limit` check measures a bullet's length with, and
// `bulletStampShapes`, the SAME stamp parser the lint's closed/thread-stamp
// checks read through — the lint and the archive must never disagree about
// what counts as a bullet's extent or its stamp.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
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
  isPlaceholderBullet,
  prepareText,
  REQUIRED_GLOBAL_SECTIONS,
  THREAD_INACTIVE_DAYS,
  topLevelBulletRanges,
  topLevelBullets,
} from './state.mjs';
import { headerBlock, isRealCalendarDate } from './doctor.mjs';
import { formatLocalDate } from './sessionlog.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The archive file's header, byte-exact (spec cli-20-global-page-limits.md,
 * Lane B) — written once, the first time a page's archive is created.
 * `<term>` is literal instructional text for a human running the suggested
 * `grep`, not a placeholder this module ever substitutes.
 */
export const ARCHIVE_HEADER_LINES = [
  '# GLOBAL STATE — archive',
  '> Append-only. Lines moved off ~/.agents/STATE.md (or the long form of trimmed ones), verbatim,',
  '> newest last. Never loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md',
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
 * @property {() => void} [onBeforeRename] TEST-ONLY seam: invoked
 *   immediately before the temp-file rename; if it throws, that failure is
 *   handled exactly like a real `renameSync` failure (temp unlinked, exit 2,
 *   the archive-already-holds-a-copy message) — lets a test exercise the
 *   rename-failure path without depending on a real, platform-specific I/O
 *   failure. Never set outside tests.
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
 * The owner named on the page's own header `Owner: <name>.` line (#20b
 * review item 4), or null when the header carries no such line. Non-greedy
 * up to the first `.` after `Owner: ` so a multi-word owner (`Owner: Jane
 * Doe.`) still extracts whole, not just its first token.
 * @param {string} preparedText CRLF-normalized, fence/comment-blanked
 * @returns {string | null}
 */
function headerOwnerName(preparedText) {
  const m = headerBlock(preparedText).match(/Owner: (.+?)\./);
  return m ? m[1] : null;
}

/** The first 60 chars of a line, for a candidate/success/refusal message excerpt. */
function first60(line) {
  return line.length > 60 ? line.slice(0, 60) : line;
}

/** True iff `text` (a file's content) already ends with exactly one blank line (CRLF-tolerant). */
function endsWithBlankLine(text) {
  return text.replace(/\r/g, '').endsWith('\n\n');
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
 * D3 (#20b review): the one clock-aware safety gate in this feature. Only
 * `--reason expired`/`inactive` read the clock at all — every other reason
 * returns null (gate passes) unconditionally. Checks, in order: (1) any
 * valid stamp ANYWHERE on the page dated after `today` refuses first, naming
 * it — a mistyped future stamp must be fixed before any comparison here can
 * be trusted; (2) the matched line's OWN stamp (the keyword matching the
 * reason: `closed` for `expired`, `as of` for `inactive`) must exist and be a
 * real calendar date, else refuse suggesting `--reason removed`; (3) its age
 * against `today` (`daysBetween`, the SAME day arithmetic `lib/state.mjs`'s
 * WARN checks use) must exceed the matching limit (`CLOSED_EXPIRY_DAYS`/
 * `THREAD_INACTIVE_DAYS`), else refuse naming the age and the limit. A line
 * carrying more than one valid stamp of the relevant keyword compares
 * against the NEWEST — the opposite conservatism from the lint's own
 * oldest-wins WARN rule (lib/state.mjs's F6): there, warning early on an
 * ambiguous reading is the safe default; here, the gate exists to PREVENT a
 * premature removal, so it only passes when even the freshest reading
 * already clears the limit.
 * @param {StateArchiveFlags} flags
 * @param {string} matchedLine the matched bullet's own physical line
 * @param {string} preparedText the whole prepared page text (for the future-stamp scan)
 * @param {string} today YYYY-MM-DD, `formatLocalDate(now)`
 * @returns {string | null} a refusal message (no `banana state archive: ` prefix), or null to proceed
 */
function d3ClockGateRefusal(flags, matchedLine, preparedText, today) {
  if (flags.reason !== 'expired' && flags.reason !== 'inactive') return null;

  const future = findFutureStamp(preparedText, today);
  if (future !== null) {
    return (
      `a stamp on the page is dated after today (${today}): "${future.date}" on "${first60(future.line)}" — ` +
      'fix that stamp first'
    );
  }

  const keyword = flags.reason === 'expired' ? 'closed' : 'as of';
  const limit = flags.reason === 'expired' ? CLOSED_EXPIRY_DAYS : THREAD_INACTIVE_DAYS;
  const validStamps = bulletStampShapes(matchedLine, keyword).filter(isRealCalendarDate);
  if (validStamps.length === 0) {
    return (
      `--reason ${flags.reason} requires the line's own "(${keyword} YYYY-MM-DD)" stamp; none found — ` +
      'use --reason removed instead'
    );
  }
  const stampDate = validStamps.reduce((a, b) => (b > a ? b : a));
  const age = daysBetween(stampDate, today);
  if (age > limit) return null;
  return (
    `(${keyword} ${stampDate}) is only ${age} day(s) before today (${today}) — not yet ${flags.reason} ` +
    `(needs more than ${limit}); use --reason removed if it should go anyway`
  );
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
 * Read-only: what a prospective archive append would write, WITHOUT writing
 * anything (#20b review: dry-run previews this same computation; the real
 * write path calls this again, at the right pipeline position, immediately
 * before the actual `appendFileSync`). Item 5's edge cases: an archive that
 * doesn't exist, or exists but is empty, gets the header first; one that
 * exists with content but no trailing blank line gets one more terminator
 * inserted before the record; the archive's own line ending wins once it
 * has one, else `pageEol` (the page's dominant ending) seeds it.
 * @param {string} archivePath
 * @param {string} pageEol
 * @param {string} recordHeading
 * @param {string} bulletLine
 * @returns {{ appendText: string, recordText: string } | { error: string }}
 */
function composeArchiveAppend(archivePath, pageEol, recordHeading, bulletLine) {
  let archiveEol = pageEol === '' ? '\n' : pageEol;
  let archivePrefix = '';
  try {
    if (existsSync(archivePath)) {
      const archiveRaw = readFileSync(archivePath, 'utf8');
      if (archiveRaw === '') {
        archivePrefix = ARCHIVE_HEADER_LINES.join(archiveEol) + archiveEol + archiveEol;
      } else {
        archiveEol = dominantEol(indexLines(archiveRaw));
        if (!endsWithBlankLine(archiveRaw)) archivePrefix = archiveEol;
      }
    } else {
      archivePrefix = ARCHIVE_HEADER_LINES.join(archiveEol) + archiveEol + archiveEol;
    }
  } catch (error) {
    return { error: `${archivePath} exists but could not be read: ${error instanceof Error ? error.message : error}` };
  }
  const recordText = [recordHeading, bulletLine].join(archiveEol);
  const appendText = archivePrefix + recordText + archiveEol + archiveEol;
  return { appendText, recordText };
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
  const raw1 = rawBuffer.toString('utf8');

  const preparedText = prepareText(raw1);
  const rawLines = indexLines(raw1);

  /** @type {{ section: string, firstLine: string, start: number, continuationLines: number }[]} */
  const candidates = [];
  for (const section of REQUIRED_GLOBAL_SECTIONS) {
    for (const g of topLevelBulletRanges(preparedText, section)) {
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
    for (const c of candidates) err(`  ${c.section} · "${first60(c.firstLine)}"`);
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

  const today = formatLocalDate(now);
  const gateRefusal = d3ClockGateRefusal(flags, match.firstLine, preparedText, today);
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
  const actionLine = `archived (${flags.reason}): ${match.section} · "${first60(match.firstLine)}" → ${archivePath}`;
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
    try {
      appendFileSync(archivePath, composed.appendText, 'utf8');
    } catch (error) {
      err(`banana state archive: could not write ${archivePath}: ${error instanceof Error ? error.message : error} — nothing written`);
      return { code: 2 };
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
  const tempPath = join(dirname(pagePath), `${basename(pagePath)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
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
  try {
    appendFileSync(archivePath, composed.appendText, 'utf8');
  } catch (error) {
    safeUnlink(tempPath);
    err(`banana state archive: could not write ${archivePath}: ${error instanceof Error ? error.message : error} — nothing written`);
    return { code: 2 };
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
    renameSync(tempPath, pagePath);
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
