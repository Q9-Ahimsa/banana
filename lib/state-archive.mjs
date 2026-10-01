// `state archive` (ticket #20, Lane B): moves — or, for `--reason trimmed`,
// copies — exactly one non-placeholder top-level bullet off the global page
// (`<home>/.agents/STATE.md`) into an append-only archive
// (`<home>/.agents/STATE-archive.md`). Canon rule this enforces: removal
// from the global page is a MOVE, never a silent delete. Lives in its own
// module, separate from lib/state.mjs: it reads the clock for the record
// date, so it must stay out of the clock-free lint module (ADR 0004 — no
// check in lib/state.mjs may read `now`). `home` and `now` are injected
// through deps; only `bin/` resolves `os.homedir()`/`Date.now()`. Contract:
// docs/DESIGN.md `state archive` — contract, .agents/specs/cli-20-global-page-limits.md.
//
// Reuses lib/state.mjs's exported bullet/section helpers (`prepareText`,
// `topLevelBullets`, `topLevelBulletRanges`, `isPlaceholderBullet`,
// `REQUIRED_GLOBAL_SECTIONS`) rather than re-parsing the page from scratch —
// in particular `topLevelBulletRanges`, which is the SAME primitive the
// lint's `line-over-limit` check measures a bullet's length with
// (integration fix, 2026-10-01): a hand-mirrored bullet-group scan here
// previously defined a bullet's extent as "stops at the first blank line,"
// which disagreed with the lint's "runs to the next bullet/heading, trailing
// blanks trimmed" — this module must move exactly what the lint measures, so
// it now computes ranges the same way the lint does and only maps those
// LINE INDEXES onto the RAW text's byte offsets (`indexLines`, below) for
// the byte-exact splice.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPlaceholderBullet,
  prepareText,
  REQUIRED_GLOBAL_SECTIONS,
  topLevelBulletRanges,
  topLevelBullets,
} from './state.mjs';
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
 * @property {number} now epoch ms — the record's date is `formatLocalDate(now)`
 * @property {StateArchiveIo} io
 * @property {() => void} [onBetweenReads] TEST-ONLY seam: invoked after the
 *   first page read (used to compute the new page text) and before the
 *   re-read guard's second read — lets a test mutate the page on disk
 *   mid-flight to exercise the guard itself. Never set outside tests.
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
 * The dominant line terminator among `lines` (CRLF only if it strictly
 * outnumbers LF, else LF) — used to pick the terminator for a freshly
 * inserted placeholder line, and to seed a freshly-created archive file's
 * own line ending.
 * @param {RawLine[]} lines
 * @returns {string}
 */
function dominantEol(lines) {
  let crlf = 0;
  let lf = 0;
  for (const l of lines) {
    if (l.eol === '\r\n') crlf++;
    else if (l.eol === '\n') lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * The ONE placeholder bullet line a freshly-bootstrapped section carries,
 * read from templates/global-STATE.md AT RUNTIME on every call — never
 * cached, never hardcoded here: Lane A of this same ticket changes the
 * `Recently closed` placeholder text, so hardcoding any section's
 * placeholder would drift the moment that lands.
 * @param {string} name exact section name, e.g. 'Watch'
 * @returns {string}
 */
function sectionPlaceholderLine(name) {
  const templateRaw = readFileSync(join(KIT_ROOT, 'templates', 'global-STATE.md'), 'utf8');
  const bullets = topLevelBullets(prepareText(templateRaw), name);
  return bullets[0];
}

/** The first 60 chars of a line, for a candidate/success message excerpt. */
function first60(line) {
  return line.length > 60 ? line.slice(0, 60) : line;
}

/** True iff `text` (a file's content) already ends with exactly one blank line (CRLF-tolerant). */
function endsWithBlankLine(text) {
  return text.replace(/\r/g, '').endsWith('\n\n');
}

/**
 * Run a parsed `banana state archive` invocation (ticket #20, Lane B): move
 * (or, for `trimmed`, copy) exactly one matched top-level bullet off the
 * global page into the append-only archive — see docs/DESIGN.md `state
 * archive` — contract. Never throws: every failure mode is caught and
 * returned as `{ code: 2 }` with a message on `io.err`, the same convention
 * `runStateLint` uses (bin/banana.mjs wires neither call in a try/catch).
 * @param {StateArchiveFlags} flags
 * @param {StateArchiveDeps} deps
 * @returns {Promise<StateArchiveResult>}
 */
export async function runStateArchive(flags, deps) {
  const { home, now, io } = deps;
  const err = io.err ?? io.out;
  const pagePath = join(home, '.agents', 'STATE.md');
  const archivePath = join(home, '.agents', 'STATE-archive.md');

  /** @type {string} */
  let raw1;
  try {
    raw1 = readFileSync(pagePath, 'utf8');
  } catch {
    err(`banana state archive: ${pagePath} is missing or unreadable`);
    return { code: 2 };
  }

  const preparedText = prepareText(raw1);
  const rawLines = indexLines(raw1);

  /** @type {{ section: string, start: number, end: number, firstLine: string, soleBulletInSection: boolean }[]} */
  const candidates = [];
  for (const section of REQUIRED_GLOBAL_SECTIONS) {
    const groups = topLevelBulletRanges(preparedText, section);
    for (const g of groups) {
      const firstLine = rawLines[g.start].content;
      if (isPlaceholderBullet(firstLine)) continue;
      const fullText = rawLines
        .slice(g.start, g.end)
        .map((l) => l.content)
        .join('\n');
      if (!fullText.includes(flags.match)) continue;
      candidates.push({ section, start: g.start, end: g.end, firstLine, soleBulletInSection: groups.length === 1 });
    }
  }

  if (candidates.length === 0) {
    err(`banana state archive: no line matches "${flags.match}"`);
    return { code: 2 };
  }
  if (candidates.length > 1) {
    err(`banana state archive: "${flags.match}" matches ${candidates.length} lines — be more specific:`);
    for (const c of candidates) err(`  ${c.section} · "${first60(c.firstLine)}"`);
    return { code: 2 };
  }

  const match = candidates[0];
  const bulletLines = rawLines.slice(match.start, match.end).map((l) => l.content);
  const pageEol = dominantEol(rawLines);
  const date = formatLocalDate(now);
  const recordHeading = `## [${date}] ${flags.tag} — ${flags.reason} · ${match.section}`;

  // Compute the new page text from raw1 — `trimmed` never touches the page.
  const pageModified = flags.reason !== 'trimmed';
  let newRaw = raw1;
  if (pageModified) {
    const removeStart = rawLines[match.start].start;
    const removeEnd = rawLines[match.end - 1].end;
    if (match.soleBulletInSection) {
      const placeholder = sectionPlaceholderLine(match.section);
      newRaw = raw1.slice(0, removeStart) + placeholder + pageEol + raw1.slice(removeEnd);
    } else {
      newRaw = raw1.slice(0, removeStart) + raw1.slice(removeEnd);
    }
  }

  // Test-only seam, then the re-read guard — spec order: read, compute,
  // re-read-and-abort-if-changed, append the archive, write the page.
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

  // Compose the archive append: create-with-header iff the file is missing,
  // else append using the archive's OWN existing line ending.
  let archiveEol = pageEol;
  let archivePrefix = '';
  try {
    if (existsSync(archivePath)) {
      const archiveRaw = readFileSync(archivePath, 'utf8');
      archiveEol = dominantEol(indexLines(archiveRaw));
      if (!endsWithBlankLine(archiveRaw)) archivePrefix = archiveEol;
    } else {
      archivePrefix = ARCHIVE_HEADER_LINES.join(archiveEol) + archiveEol + archiveEol;
    }
  } catch (error) {
    err(`banana state archive: ${archivePath} exists but could not be read: ${error instanceof Error ? error.message : error}`);
    return { code: 2 };
  }
  const recordText = [recordHeading, ...bulletLines].join(archiveEol);
  const appendText = archivePrefix + recordText + archiveEol + archiveEol;

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
    io.out('--dry-run: nothing written. Record that would be appended:');
    for (const line of recordText.split(archiveEol)) io.out(line);
    io.out(actionLine);
    for (const line of reminderLines) io.out(line);
    return { code: 0 };
  }

  try {
    appendFileSync(archivePath, appendText, 'utf8');
  } catch (error) {
    err(`banana state archive: could not write ${archivePath}: ${error instanceof Error ? error.message : error}`);
    return { code: 2 };
  }
  if (pageModified) {
    try {
      writeFileSync(pagePath, newRaw, 'utf8');
    } catch (error) {
      err(
        `banana state archive: archived, but could not write ${pagePath}: ` +
          `${error instanceof Error ? error.message : error} — the line is now duplicated on both the page and ` +
          'the archive; remove it from the page by hand',
      );
      return { code: 2 };
    }
  }

  io.out(actionLine);
  for (const line of reminderLines) io.out(line);
  return { code: 0 };
}
