# Spec — #20 global page: line limits, expiry, inactivity, archive

Session entry: `.agents/session.log` cli.20. Owner rulings (2026-10-01): all three rules below;
inactive threshold 30 days; Recently closed expires after 7 days; removal from the global page
becomes a MOVE into an append-only archive, done by a `banana state archive` command.

## Why

The global page (`~/.agents/STATE.md`) has a 10,000-char cap (FAIL) but no rule that ever
shrinks it: sessions may edit only their own lines, nothing expires, so the page only grows. The
over-cap FAIL lands on whoever writes last, usually not the line that bloated. A real page measured
9,908 chars: one thread line 1,325 chars, four threads idle 49–69 days (~1,600 chars), one
Recently closed item 946 chars. And unlike every other record, a line removed from the global page
leaves no trace (session.log and LOGBOOK are append-only with ids; project STATE lines cite logbook
ids). Simulating the rules below on that page: 9,908 → ~6,800.

## Shared constants (both lanes use these exact values)

- Line limits, per top-level bullet, by section: `Active threads` 400 · `Backlog (owned)` 300 ·
  `Watch` 350 · `Recently closed (context for next session)` 250.
- `CLOSED_EXPIRY_DAYS = 7`, `THREAD_INACTIVE_DAYS = 30`.
- Archive file: `STATE-archive.md`, next to the global page (`<home>/.agents/STATE-archive.md`).
- Closed stamp grammar: `(closed YYYY-MM-DD)`, parsed with the SAME hardened rules as the existing
  `(as of YYYY-MM-DD)` stamp (case, multiple stamps, real calendar date — reuse, don't re-derive).
- Archive reasons: `expired | inactive | trimmed | closed | removed`.

## Lane A — lint checks + canon + template (lib/state.mjs, global mode only)

`lintGlobalState` gains four WARN checks. All stay clock-free (module invariant, ADR 0004): the
**reference date** is the newest real calendar date among the page's Active-thread `(as of)` and
Recently-closed `(closed)` stamps; with no valid stamp, skip the two date checks. Day differences
via `Date.UTC` on the parsed parts — never `new Date()` without arguments.

1. `line-over-limit` — a non-placeholder top-level bullet (its full text: the bullet line plus any
   continuation lines, CRLF-normalized, JS string length including the `- ` marker) longer than
   its section's limit. Message names section, length, limit, the bullet's first 60 chars, and the
   remedy: archive the full text (`banana state archive --global --reason trimmed --match …`), then
   shorten it in place.
2. `closed-undated` — a non-placeholder Recently closed bullet with no valid `(closed …)` stamp.
3. `closed-expired` — closed date more than 7 days before the reference date (7 = not expired,
   8 = expired). Remedy: `banana state archive --global --reason expired --match …`.
4. `thread-inactive` — Active thread `(as of)` more than 30 days before the reference date (30 = not
   inactive, 31 = inactive). Remedy: archive it (`--reason inactive`), then add a one-line Backlog
   item `owner — name: waiting on … → pointer`.

WARN, not FAIL, for all four: each fix needs a model's judgment (what to cut, what the backlog line
says); the page cap stays FAIL as the backstop. Project mode is unchanged.

Template + canon:
- `templates/global-STATE.md`: add one header blockquote line after the existing ones:
  `> Line limits: thread 400 · backlog 300 · watch 350 · closed 250 chars. Closed lines carry`
  `> \`(closed YYYY-MM-DD)\` and expire after 7 days; a thread idle 30+ days becomes a Backlog line.`
  `> Never delete a line: \`banana state archive\` moves it to STATE-archive.md.`
  and change the Recently closed placeholder to
  `- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)`.
- Placeholder detection must keep recognizing the PREVIOUS Recently closed placeholder
  (`- (last few finished threads, one line each, with pointers)`) — installed pages carry it; add
  it as a legacy pattern, with a test that an old-template page raises no `closed-undated`.
- `canon/CONTINUITY.md` → v1.7: keep its literal global template identical to
  `templates/global-STATE.md` (existing tests enforce this); in the Global grain rules add the
  limits, the closed stamp, expiry, inactivity → Backlog, and "removal is a move": any line leaving
  the page (or the long form of a trimmed line) goes to `STATE-archive.md` via
  `banana state archive`, copy before delete; the archive is append-only, never loaded at session
  start, searched with grep. Exception to "edit only your own lines": any session may archive an
  `expired` line (no judgment involved). Add a v1.7 changelog entry mirroring v1.6's.
- `docs/adr/0006-global-page-limits-and-archive.md` (format of 0005): decision, the clock-free
  reference-date choice, WARN-not-FAIL, rejected options (raise the cap — it only defers and the
  page costs every session; a page-rewriting `trim` — a whole-page write, ADR 0005's failure mode;
  pointers-only provenance — machine-level items have no project logbook).
- `docs/DESIGN.md` `state lint` verdict contract: the four new finding types.

Tests (`test/state.test.mjs`, red first): each check fires and stays quiet on its boundary
(400/401 chars, 7/8 days, 30/31 days); reference date = newest stamp, not the first; no stamps →
date checks skipped; placeholders exempt (new AND legacy); continuation lines count toward length;
CRLF page measures the same as LF. Fixtures synthetic only (no real names or paths).

## Lane B — `banana state archive` (new lib/state-archive.mjs + parse/bin wiring)

```
banana state archive --global --match <text> --reason <expired|inactive|trimmed|closed|removed>
                     --tag <agent> [--dry-run]
```

- `--global` required (project pages keep history in LOGBOOK.md): without it exit 2 with that
  reason. `--match`, `--reason`, `--tag` required; unknown flag/reason → exit 2 (the `state` arm's
  usage convention).
- Lives in a NEW module `lib/state-archive.mjs` (it reads the clock for the record date — keep
  lib/state.mjs clock-free). Inject `home` and `now` via deps; only bin resolves `os.homedir()`.
  Extend `parseStateArgs` (lib/state.mjs) to return a discriminated union
  (`{verb:'lint',global}` | `{verb:'archive',global,match,reason,tag,dryRun}`); reuse state.mjs's
  bullet/section helpers rather than re-parsing.
- Match: case-sensitive substring of a non-placeholder top-level bullet's full text in any of the
  four sections. Exactly one → proceed. Zero → exit 2 `no line matches`. Several → exit 2 listing
  each candidate's section + first 60 chars.
- Record appended to the archive (create the file with this header if missing):
  ```
  # GLOBAL STATE — archive
  > Append-only. Lines moved off ~/.agents/STATE.md (or the long form of trimmed ones), verbatim,
  > newest last. Never loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md
  ```
  each record:
  ```
  ## [YYYY-MM-DD] <tag> — <reason> · <section name>
  <the bullet's lines, byte-verbatim>
  ```
  with one blank line between records. Date = local calendar date from injected `now`.
- Order, so a crash can duplicate but never lose: read page → compute new page → re-read page and
  abort (exit 2, nothing written) if its bytes changed → append the archive record → write the page.
- `trimmed` copies only: the page is not modified; print a reminder to shorten the line in place.
  Every other reason removes the bullet (with its continuation lines). If the section is left
  with no bullet, insert that section's placeholder line from `templates/global-STATE.md` (read
  at runtime — Lane A changes the Recently closed placeholder).
- Line endings: the page keeps its own (CRLF stays CRLF); the archive matches its existing file,
  or the page's when created. No other byte of the page changes (test this byte-exactly).
- Output: `archived (<reason>): <section> · "<first 60 chars>" → <archive path>`; `inactive` also
  prints the Backlog-line reminder. `--dry-run` prints the record + action, writes nothing.
- bin: `STATE_USAGE` lists `<lint|archive>`; add `banana state archive --help` text in bin
  (state.mjs owns zero help text — keep that contract). Exit codes 0 ok / 2 usage or state.
- `docs/DESIGN.md`: a `state archive` contract section. README command list, if it enumerates
  `state lint`, adds `state archive`.

Tests (new `test/state-archive.test.mjs` + an e2e in `test/bin.e2e.test.mjs`, sandbox temp dirs
only, red first): move removes exactly the bullet and nothing else (byte-exact); trimmed leaves the
page byte-identical; record format exact; archive created with header, then appended; CRLF page
stays CRLF; zero/multiple matches exit 2 with nothing written; placeholders never match; the
page-changed-between-reads guard aborts with nothing written (inject a read hook); last bullet
removed → placeholder inserted; continuation lines move with their bullet.

## Not in scope

The wiring block roster (`… · state lint`) stays as is — changing it bumps wiring to v4 and
re-fences every installed block; agents learn `state archive` from the page header and the canon.
No version bump in either lane (release step after merge).

## Gates (each lane)

`npm run check`; `timeout 300 rtk proxy npm test` (baseline 605 pass + 1 skipped); mutation-check
each new boundary (flip `>` to `>=`, drop the legacy placeholder, skip the re-read guard: a test
must go red). Report: files changed, test count before/after, each mutation and the test that
caught it. No commits.
