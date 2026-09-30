// brief command: compile a per-intent context brief to stdout. The brief is
// the closed-allowlist entry ritual from canon v1.1 — a session reads its
// compiled brief, nothing else by default. Include/exclude contract
// (docs/DESIGN.md): target feature's session-log entries — most recent
// closed entry and every non-closed entry in full (closedness by
// TERMINAL_STATUSES, not isOpen's exact match — F4), older closed (and any
// SAME-STREAM SUPERSEDES-retired — F3) entries heading only (#8, follow-up
// 2); headings only of the last 5 entries from other features; the target
// feature's own NEXT lines whenever shown in full (F1), and every OTHER
// feature stream's LATEST entry's NEXT lines (by log position over ALL
// entries, then skipped if retired — F5), owned by --tag or unowned (#8
// follow-up 3 — live, not historical); project STATE.md verbatim; ghosts
// flagged (stream-agnostic suppression — F9). Every section carries a ref
// line — the brief is an index into the record, not a replacement for it.
// Deterministic text processing only; project root and clock are
// injectable so tests run against fixture dirs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SESSION_LOG_REF,
  GHOST_THRESHOLD_HOURS,
  TERMINAL_STATUSES,
  loadSessionLog,
  nextOwner,
  isGhost,
  entriesForFeature,
  latestEntryDates,
  supersessionSources,
} from './sessionlog.mjs';
import { collectStateLint, formatStateLintLines, checkDirtyMarker, prepareText } from './state.mjs';
import { KIT_ROOT, readKitVersion } from './version.mjs';

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
 * @param {{ cwd: string, now: number, home: string, kitRoot?: string }} deps
 *   project root, clock (epoch ms), home dir (state lint's global-page side,
 *   #14), and kit root (kit-version line, #8; defaults to the bundled kit)
 * @returns {string}
 * @throws when the project has no .agents/session.log
 */
export function compileBrief(flags, deps) {
  const { feature, tag } = flags;
  const { cwd, now, home, kitRoot = KIT_ROOT } = deps;

  const logRef = SESSION_LOG_REF;
  const entries = loadSessionLog(cwd);
  // Supersession-aware ghosts, per CONTINUITY.md's 48h ghost rule (v1.4
  // supersession carve-out; ADR 0003): a continuation/abandon supersede
  // retires the entry it points at, so a ghost id in this set is a
  // resolved claim, not a dead one — both ghost surfaces below skip it.
  // `superseded` (the FULL, stream-agnostic id set) is what ghost
  // suppression uses throughout (F9: the canon's ghost retirement doesn't
  // care which feature did the retiring). `supersessionSrc` additionally
  // carries WHICH entry (and which feature) retired each id — the grain
  // below (F3) needs that to tell a same-stream retirement (hide the body)
  // from a cross-stream rename/move (keep it).
  const supersessionSrc = supersessionSources(entries);
  const superseded = new Set(supersessionSrc.keys());

  // Read project STATE.md once, up front (#8): the kit-version/dirty-status
  // header lines below need the dirty-marker verdict before the header is
  // composed, and the `## Project state` section further down needs the
  // same bytes — one read serves both, rather than each computing its own.
  const statePath = join(cwd, 'STATE.md');
  const stateExists = existsSync(statePath);
  /** @type {string | null} */
  let stateRaw = null;
  if (stateExists) {
    // Same file the `## State lint` section below already reads via
    // collectStateLint (which handles an existing-but-unreadable target
    // gracefully, #14) — an unguarded read here would otherwise throw and
    // crash the whole brief on exactly the case that section reports as
    // `unreadable`, undermining "lint never stops the rest of the brief
    // from printing."
    try {
      stateRaw = readFileSync(statePath, 'utf8');
    } catch {
      stateRaw = null;
    }
  }

  // Dirty-status line (#8): reuses lib/state.mjs's own marker detection
  // (DIRTY_MARKER_LINE / checkDirtyMarker) over the same fence/comment-
  // blanked text lintProjectState prepares — never a second parser.
  // Existing-but-unreadable is its own outcome (follow-up 4), distinct from
  // missing: the `## State lint` section above already says `unreadable`
  // for this same file, and folding it into `none` would contradict that
  // line right above it in the same brief.
  let stateStatusLine;
  if (!stateExists) {
    stateStatusLine = 'STATE: none';
  } else if (stateRaw === null) {
    stateStatusLine = 'STATE: unreadable';
  } else if (checkDirtyMarker(prepareText(stateRaw)).length > 0) {
    stateStatusLine = 'STATE: dirty (patched since last rebuild; the log is authority)';
  } else {
    stateStatusLine = 'STATE: clean';
  }

  /** @type {string[]} */
  const lines = [];
  lines.push(`# brief — ${feature} (agent: ${tag})`);
  lines.push('> Snapshot for one session (BEGIN). Do not re-read shared state mid-flight;');
  lines.push('> your own open log entry is the cohesion anchor. Refs point into the record.');
  // Kit-version line (#8): under the title blockquote, before `## State
  // lint` — sourced from the installed package metadata, never the network.
  const kitVersion = readKitVersion(kitRoot);
  lines.push(kitVersion !== null ? `kit: v${kitVersion}` : 'kit: unknown');
  lines.push(stateStatusLine);
  lines.push('');

  // State lint verdict (#14): a lint nobody runs catches nothing — the brief
  // is the session-start guarantee, so it carries both pages' verdicts up
  // front, before any other section. Never gates the brief: printed
  // regardless of FAIL/WARN/PASS, and never changes this function's return.
  lines.push('## State lint');
  lines.push(...formatStateLintLines(collectStateLint({ cwd, home })));
  lines.push('');

  // Project STATE.md verbatim — the hot projection, one page by contract.
  // Global STATE is machine grain and deliberately excluded.
  lines.push('## Project state');
  lines.push('ref: STATE.md');
  if (stateRaw !== null) {
    lines.push(stateRaw.trimEnd());
  } else if (stateExists) {
    lines.push('(STATE.md exists but could not be read)');
  } else {
    lines.push('(no STATE.md found — run `banana project` to create it)');
  }
  lines.push('');

  // Target feature (#8 grain tightening, follow-up 2, adversarial-review
  // F3/F4): full body for every entry whose own STATUS isn't terminal
  // (open, missing, or off-vocabulary — F4: classify by CLOSEDNESS, not by
  // `isOpen`'s exact 'in-progress' match, or a malformed/missing STATUS
  // silently loses its body) plus the single most-recent CLOSED entry;
  // every older closed entry shows as its heading line only. Log order is
  // kept — the array is walked once, forward, deciding full-vs-heading per
  // entry rather than reordering. A SUPERSEDES-retired entry is heading
  // only regardless of its own STATUS (follow-up 2) — BUT only when the
  // superseder is in the SAME feature stream (F3): a cross-stream supersede
  // (a rename/move, e.g. `SUPERSEDES: old-slug.1` written by a different
  // feature's entry) keeps the full body, or briefing the renamed-away
  // feature directly would carry no content at all. `shownFull` (F1) is
  // read by Handoffs below: the target feature's own NEXT eligibility
  // follows exactly which entries this loop rendered in full, not a
  // separate "is it the stream's latest" rule (that rule is for OTHER
  // features only, in Handoffs below).
  lines.push(`## Feature history — ${feature} (last close + open entries in full)`);
  lines.push(`ref: ${logRef}`);
  const mine = entriesForFeature(entries, feature);
  if (mine.length === 0) {
    lines.push(`(no entries for '${feature}' yet — this session opens the record)`);
  }
  // Same-stream only (F3): a cross-stream superseder retires the id
  // globally (ghosts, Handoffs-F5 still use the full `superseded` set
  // above) but must not hide this feature's own body.
  const isRetired = (entry) =>
    (supersessionSrc.get(`${entry.feature}.${entry.n}`) ?? []).some((s) => s.feature === entry.feature);
  const isClosed = (entry) => TERMINAL_STATUSES.includes(entry.status);
  let lastClosedIndex = -1;
  for (let i = 0; i < mine.length; i++) {
    if (!isRetired(mine[i]) && isClosed(mine[i])) lastClosedIndex = i;
  }
  /** @type {Set<LogEntry>} */
  const shownFull = new Set();
  for (let i = 0; i < mine.length; i++) {
    const entry = mine[i];
    const showFull = !isRetired(entry) && (!isClosed(entry) || i === lastClosedIndex);
    if (!showFull) {
      // Older closed entry, or any same-stream-retired entry regardless of
      // its own STATUS: heading only, no body, no ghost flag (isGhost
      // requires isOpen, and a same-stream-retired entry never enters the
      // full branch anyway).
      lines.push(entry.heading);
      continue;
    }
    shownFull.add(entry);
    lines.push(entry.heading);
    // F9 (re-checked after F3): this clause is now reachable and correct.
    // Before F3, `isRetired` was the FULL id set, so `!isRetired(entry)`
    // already implied `!superseded.has(...)` — this check was dead code.
    // After F3, `isRetired` is same-stream-only, so a cross-stream-retired
    // entry (F3, kept full) CAN reach here with `superseded.has(...)` true
    // — the canon's ghost retirement is stream-agnostic (a rename/move
    // resolves the ghost even though the body stays visible under the old
    // slug), so this clause must stay to suppress the flag in that case.
    if (isGhost(entry, now) && !superseded.has(`${entry.feature}.${entry.n}`)) {
      lines.push(
        `[GHOST — in-progress since ${entry.date}, older than ${GHOST_THRESHOLD_HOURS}h; ` +
          'close as abandoned via a SUPERSEDES entry]'
      );
    }
    lines.push(...entry.body);
    lines.push('');
  }
  // Exactly one trailing blank line, however the loop above ended: a full
  // entry already pushed its own ('' is the last line already); an empty
  // `mine` or a heading-only LAST entry (reachable via a duplicate-id
  // collision, F6) did not, so add it here.
  if (lines[lines.length - 1] !== '') lines.push('');

  // Other features: awareness that work exists, zero exposure to approach.
  lines.push(`## Other work in flight — headings only (last ${OTHER_HEADINGS_WINDOW})`);
  lines.push(`ref: ${logRef}`);
  const others = entries.filter((e) => e.feature !== feature).slice(-OTHER_HEADINGS_WINDOW);
  if (others.length === 0) lines.push('(none)');
  for (const entry of others) {
    lines.push(`- ${entry.heading.slice(3)}`);
  }
  lines.push('');

  // Handoffs (#8 follow-up 3, adversarial-review F1/F5): live, not
  // historical, but not uniformly so. Per canon entry-ritual item 5, NEXT
  // lines are drawn from surfaces the brief already exposes — and the
  // target feature's full bodies (Feature history above) are one of them,
  // so the TARGET feature's own entries are eligible here whenever they
  // were shown in full there (`shownFull`, F1) — NOT gated on being the
  // stream's positional-latest entry, which would wrongly hide a "last
  // close" NEXT behind a newer open entry that has none yet (canon rule 3:
  // unowned NEXTs are surfaced too).
  //
  // For every OTHER feature, canon's resume rule ("read the latest
  // STATUS/NEXT") still applies: take the stream's LATEST entry BY LOG
  // POSITION (not by id — F6: a SUPERSEDES line retires every entry
  // sharing that id, and two entries can share one after a hand-mangled
  // heading; see GitHub #18) over ALL entries first (F5 — building the map
  // only from non-retired entries let an OLDER NEXT resurface when the
  // stream's true latest was itself retired), THEN skip a retired winner
  // using the FULL, stream-agnostic id set (a retired entry's NEXT is dead
  // whoever retired it) — the whole stream then contributes nothing; a
  // same-stream continuation is unaffected, since it's the last entry by
  // position and therefore not itself retired.
  lines.push(`## Handoffs — NEXT for ${tag} or unowned`);
  lines.push(`ref: ${logRef}`);
  /** @type {Map<string, LogEntry>} */
  const lastByFeature = new Map();
  for (const entry of entries) lastByFeature.set(entry.feature, entry); // last write per feature wins = latest by log position
  /** @type {string[]} */
  const handoffs = [];
  for (const entry of entries) {
    if (entry.feature !== feature) {
      if (lastByFeature.get(entry.feature) !== entry) continue; // not this stream's latest entry
      if (superseded.has(`${entry.feature}.${entry.n}`)) continue; // F5: latest winner retired -> stream contributes nothing
    } else if (!shownFull.has(entry)) {
      continue; // F1: target feature — eligible iff Feature history rendered it in full
    }
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
 * - no feature: print the active-slug listing to stdout, exit 0 (discovery —
 *   also carries the `## State lint` section, #14, ahead of the listing);
 * - unknown slug: print the listing to stderr, exit 1;
 * - known slug: compile and print the brief to stdout (contract unchanged).
 * @param {BriefArgs} flags
 * @param {{ cwd: string, io: BriefIo, home: string, now?: number, kitRoot?: string }} deps
 *   `kitRoot` (#8) is forwarded to `compileBrief`, defaulting there to the
 *   bundled kit — a test seam, `bin/` never passes it.
 * @returns {Promise<BriefResult>}
 */
export async function runBrief(flags, deps) {
  const { cwd, io, home, now = Date.now(), kitRoot } = deps;
  const err = io.err ?? io.out;
  try {
    const { feature, tag } = flags;
    if (feature === null) {
      const entries = loadSessionLog(cwd);
      const lintLines = ['## State lint', ...formatStateLintLines(collectStateLint({ cwd, home })), ''];
      io.out([...lintLines, slugListing(entries)].join('\n'));
      return { code: 0 };
    }
    const entries = loadSessionLog(cwd);
    if (entriesForFeature(entries, feature).length === 0) {
      err(`banana brief: no entries for feature '${feature}'`);
      err(slugListing(entries));
      return { code: 1 };
    }
    io.out(compileBrief({ feature, tag: /** @type {string} */ (tag) }, { cwd, now, home, kitRoot }));
    return { code: 0 };
  } catch (error) {
    err(`banana brief: ${error instanceof Error ? error.message : error}`);
    return { code: 1 };
  }
}
