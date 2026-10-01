# Global page gets line limits, closed-stamp expiry, thread inactivity, and an archive

Decided (2026-10-01, ratified by Ahimsa). The global page (`~/.agents/STATE.md`) has a
10,000-char cap (FAIL, ADR 0004) but no rule that ever shrinks it: sessions may edit only
their own threads (ADR 0005), nothing expires, so the page only ever grows. The over-cap
FAIL lands on whoever writes last, usually not the line that bloated it. A real page
measured 9,908 chars: one thread line 1,325 chars, four threads idle 49–69 days
(~1,600 chars), one Recently-closed item 946 chars. Unlike every other record on this
machine — `.agents/session.log` and `LOGBOOK.md` are append-only with ids, project STATE
lines cite logbook ids — a line removed from the global page used to leave no trace
at all.

Three new WARN-tier checks (`lib/state.mjs`, `banana state lint --global`) target the
three measured bloat sources, plus a fourth for the line-cap itself: `line-over-limit`
(a per-section char cap: `## Active threads` 400 · `## Backlog (owned)` 300 · `## Watch`
350 · `## Recently closed` 250), `closed-undated` (a Recently-closed bullet with no valid
`(closed YYYY-MM-DD)` stamp), `closed-expired` (a closed stamp more than 7 days before the
reference date), and `thread-inactive` (an Active-threads stamp more than 30 days before
the reference date). None of the four FAILs — the page-wide `over-cap` check stays the
mechanical backstop; these four are judgment calls (what to cut, what a Backlog line should
say), same tier reasoning as the dirty-marker/retired-header WARNs (ADR 0004).

A companion command, `banana state archive --global --match <text> --reason
<expired|inactive|trimmed|closed|removed> --tag <agent>`, is how a line actually leaves the
page: every removal (or the long form of a trimmed line) is copied verbatim into
`~/.agents/STATE-archive.md` — append-only, never loaded at session start, searched with
`grep` — before the bullet is removed from the live page. "Removal is a move" restores the
same append-only-with-a-trace guarantee session.log and LOGBOOK.md already have; the global
page is the one surface on this machine where lines used to simply vanish.

## The clock-free reference date

Every other check in `lib/state.mjs` is reproducible from file bytes alone — no check reads
the clock (ADR 0004's module invariant) — and `closed-expired`/`thread-inactive` keep that
property by never consulting `now`. Instead, the **reference date** is the newest real
calendar date among the page's own non-placeholder `(as of …)` and `(closed …)` stamps. This
makes "is X stale relative to the rest of this page" a self-contained, deterministic
question: the page ages against its own freshest edit, not against whatever day `state lint`
happens to run. The alternative — inject `now` — was rejected (see below).

The reference date is deliberately the **newest** stamp, not the first one encountered in
document order. Per-thread edits (ADR 0005) mean a session edits only the bullet it touches
and leaves every other bullet's position untouched — bullets land in whatever order sessions
happened to touch them, not date order. Using "the first stamp found" would make the
reference date depend on accidental bullet ordering rather than on what is actually most
recent.

## WARN, not FAIL, for all four

Fixing any of the four needs a model's judgment: which words to cut from an over-limit
bullet, whether an idle thread is genuinely done or just quiet, what a new Backlog line
should say once a thread moves there. A FAIL here would either block automation on a
judgment call (`state lint`'s other FAILs are all mechanically unambiguous) or get silently
suppressed the way #9's survey showed session-log lag would (ADR 0004's logbook-FAIL vs
session-log-WARN precedent). The page-wide `over-cap` FAIL remains the actual backstop: it
still fires regardless of these four, so a page can never silently exceed the one hard limit
this canon has always had.

## `(closed YYYY-MM-DD)` reuses the Active-threads stamp machinery

Rather than re-deriving shape/case/real-date validation for a second stamp convention, the
Recently-closed `(closed …)` stamp is parsed by the exact same hardened regex shape and
`isRealCalendarDate` round-trip the Active-threads `(as of …)` stamp already uses — only the
keyword differs. A bullet carrying more than one valid stamp of either kind compares against
the OLDEST one (conservative — mirrors the Active-threads F6 rule: if any reading of a
multi-stamped bullet could be expired/inactive, treat it as such).

## The Recently-closed placeholder's wording changes; the old text stays recognized

The bootstrap placeholder for `## Recently closed` changes from a bare pointer-only phrase to
one naming the new `(closed YYYY-MM-DD)` convention. Placeholder detection
(`loadPlaceholderPatterns`) dynamically reads the shipped templates at runtime, so without
further action an already-installed page still carrying the OLD placeholder text would stop
being recognized the moment the template changes underneath it — a false `closed-undated`
WARN on a page that never had anything to report. A small, hardcoded
`LEGACY_PLACEHOLDER_PATTERNS` list (just the one retired bullet, byte-exact) is checked
alongside the dynamically-loaded current set, so an un-migrated page keeps linting clean.

## Consequences

- A session doing `banana state archive` after a `line-over-limit`/`closed-expired`/
  `thread-inactive` WARN leaves a permanent, greppable trace of what left the page and why —
  the counter-failure this whole ticket exists to fix.
- `thread-inactive`'s remedy is two steps, not one: archive the thread bullet, then add a
  one-line Backlog item naming what it's waiting on. The check only flags the first half;
  a model does the second.
- Exception to ADR 0005's "edit only your own threads" rule: any session may archive an
  `expired` Recently-closed line on sight, since recognizing one needs no judgment (a date
  comparison, not a content decision) — unlike `trimmed`/`inactive`/`closed`/`removed`, which
  still want the touching session's own judgment about what to keep.

## Considered options

- **Raise the cap** — rejected: only defers the problem, and a bigger page costs every
  session that reads it at BEGIN (the entry ritual's hot-surface read, canon v1.1) even when
  most of it is stale residue nobody needs.
- **A page-rewriting `trim` command** — rejected: a command that reads the whole page,
  shortens several lines, and writes it back is exactly the whole-page-write failure mode
  ADR 0005 already retired (two sessions writing in the same window silently drop each
  other's edits). Per-bullet archive, matched by exact text and guarded by a
  read-unchanged-before-write check, keeps the same per-thread-edit safety ADR 0005
  established.
- **Pointers-only provenance** (cite a session.log/LOGBOOK id instead of copying the bullet's
  text) — rejected: machine-grain Backlog/Watch items and quick Recently-closed notes often
  have no project logbook to point into at all; copying the verbatim text into the archive
  needs no such pointer to exist.
- **Inject `now` for the reference date instead of deriving it from the page's own stamps** —
  rejected: every other check in this module is a pure function of file bytes (ADR 0004); a
  clock-dependent check would make `state lint --global`'s verdict depend on the moment it
  happened to run, not on the page's own content, and would need `now` threaded through a
  module that otherwise never needs it.
