# Spec — #21 global page v1.8: threads and backlog leave by date, watch gets a due date (canon v1.8, release 0.5.0)

Session entry: `.agents/session.log` cli.23. Issue: #21 (opened 2026-10-12 with the owner's ratification). Replaces the design stub at this path. Public repo: synthetic fixtures and text only (alpha, gamma, widget, gizmo, testagent); no real names, handles or local paths. The private design record (outside the repo) holds the full fork list, model and migration plan.

Conventions in this file:
- **Line numbers are at `e5b71cc` (main HEAD, 0.4.0).** Lanes branch from the A0 commit, which shifts some numbers. Find code by symbol name and tests by title; numbers are hints only.
- **[P]** = pinned verbatim in `test/canon.test.mjs` through `flatten` (so the canon may wrap it freely). **[P-raw]** = a raw header-line pin: one physical line, at most 100 chars, byte-identical in canon and template.
- `F1`–`F13` are owner-fork labels from the private design record. They appear only in the Rulings section of this spec; "#20d F7"-style ids elsewhere name existing test findings. Workers never put them in code, comments, test titles or docs, because they collide with finding ids the repo already uses (e.g. "F12" in the `bulletStampShapes` JSDoc, "F13" in test titles).

## Why

Numbers come from the owner page. Tags: VERIFIED = re-measured from files; SNAPSHOT = from page snapshots, not reproducible from this repo; INFERRED = a judgment.

- Size on 10-10, counted the way lint counts (`prepareText(raw).length`) (VERIFIED): 9,968 of 10,000 chars. Header 789 · Active 4,171 (13 lines) · Backlog 2,965 (17) · Watch 1,346 (6) · Recently closed 697 (3).
- 0.4.0's cleanup took the page from 9,912 to 7,289 on 10-03 (SNAPSHOT): net +2,679 in about 6.8 days, about +394/day, Active about 70% of it (SNAPSHOT).
- New Active threads arrive at 0.88/day and average 364 chars (SNAPSHOT). 11 of the 13 live threads wait on someone: the owner's review, ruling or action, or an outside party (INFERRED from each line's next step). Nothing re-stamps a waiting thread.
- The oldest live Active stamp is 2026-09-30, so no Active line can leave by rule before 10-31 (VERIFIED). Under v1.7, idle threads would then pile into Backlog as demotions start, and Backlog has no outflow (INFERRED).
- Backlog and Watch have no outflow: 3 Backlog lines left in 45 days, each only when someone resolved it (SNAPSHOT); no Watch line has ever left by rule.
- The only outflow by rule in the 0.4.0 week was 4 expired closed lines, archived on 10-09 (VERIFIED), 2-3 days after they became eligible (SNAPSHOT).
- Projection (model: stock = inflow × residence × line length per section; INFERRED): v1.7 rules head for about 14,000 and rising. v1.8: **about 7,530 central**, assuming waiting threads use the waiting form (0.85 waiting share), a 1-day lag under writer-pays, and the 0.88/day arrival rate holding beyond the 7-day burst it was measured in. **With no waiting-form use, about 10,300 (over the cap).** The correlated high case reaches about 10,900. The near-cap WARN and its escalation exist for exactly this risk.

## Rulings

Owner, 2026-10-10 (option labels verbatim):
- **F1+F2 "Any session, first"** — any session moves lines lint flags `closed-expired`, `thread-inactive` or `backlog-dormant` on sight, before it adds its own line (writer pays). Idle threads leave whole; no Backlog line is written. The canon frames the move as filing, not initiative (rule 5's text stays; one framing sentence, as v1.7 framed expired lines).
- **F3+F4 "Threads 14d, Backlog 21d"** — inactive at 15+ days, dormant at 22+ (strict `>`).
- **F5 "Date added; you renew"** — `(queued …)` = the day the item was added; edits never change it; only a re-queue on the owner's word writes a new date; agent items go dormant too unless the owner renews.
- **F7 "Due date, warn only"** — every Watch line carries `(validate-by: …)`; WARN `watch-undated`/`watch-due`; the owner or a session working on what it names re-dates a due line; dropping it is the owner's call; never moved on sight; no owner field.

Technical calls (decided by the orchestrator; ratified only with the v1.8 text): F6 waiting form — a marker after the Active stamp selects a 160 cap, for any wait; residence never depends on it; lint cannot enforce it. F8 no roll-up line; the mover names moved items in its reply. F9 five header lines. F10 near-cap at 9,000 plus escalation (canon text). F11 working names (the owner may rename before release). F12 stale-aware inactive gate. F13 session-log re-stamp source.

Unchanged (ratified): no cap raise; lint clock-free, same reference date (`queued`/`validate-by:` stamps never feed it); `state archive` the only clock-aware gate; per-thread edits; the kit removes only one named line (+ placeholder); removal is a move; one line per bullet; no new section or placeholder; wiring v3.

## Shared constants and grammar

- `THREAD_INACTIVE_DAYS = 14` (was 30) · `BACKLOG_DORMANT_DAYS = 21` · `WAITING_LINE_LIMIT = 160` (NOT in `SECTION_LINE_LIMITS`) · `STATE_NEAR_CAP_CHARS = 9000`. Other limits unchanged.
- Stamps reuse `oldestValidStamp(line, keyword)` / `bulletStampShapes` (lib/state.mjs:1610, :1336): backtick-masked, keyword case-insensitive, real dates only, oldest wins. Because the oldest wins, a renewal or re-date must REPLACE the old stamp; an added second stamp changes nothing (the canon says so).
- Backlog keyword `'queued'`, canonical `{owner} — name (queued YYYY-MM-DD): action → pointer`.
- Watch keyword `'validate-by:'`. The colon is part of the keyword, so `escapeRegExp` yields `\(validate-by: (\d{4}-\d{2}-\d{2})\)`; a colon-less `(validate-by 2026-…)` is undated.
- A queued stamp before the owner dash makes `classifyOwnerBullet` (:769) see a multi-word owner, so the line FAILs `backlog-unowned`; the stamp is still read (verified: `- testagent (queued 2026-09-01) — sweep` → `unowned`). Pin it; no code.
- `WAITING_MARKER_RE = /\(as of \d{4}-\d{2}-\d{2}\) — waiting on [^:]{1,40}: \S/`, tested on the backtick-masked prepared line, case-SENSITIVE (`(As of …)` gets 400). Any line it matches also has an `(as of …)` stamp shape, so a marked line can never FAIL `thread-unstamped` (verified).
- Example waiting line for fixtures (107 chars, matches the marker): ``- **widget** (as of 2026-10-01) — waiting on owner: review the release notes → `~/projects/widget/STATE.md` ``.
- Reasons, in order: `expired | inactive | dormant | trimmed | closed | removed`.
- Clock gates (lib/state-archive.mjs; no row = not gated):

| reason | section | keyword | refuses unless days before today > | also refuses |
|---|---|---|---|---|
| expired | Recently closed | closed | 7 | — |
| inactive | Active threads | as of | 14 | `bulletIsThreadStale(line, home)` |
| dormant | Backlog (owned) | queued | 21 | — |

### Name carriers (working names)

A rename before release is mechanical only if it touches every carrier below. The names are `queued`, `validate-by:`, ` — waiting on {who}:`, `dormant`, `near-cap`, "waiting form", and the finding types `backlog-undated`, `backlog-dormant`, `watch-undated`, `watch-due`, `near-cap`.
- Code strings: `WAITING_MARKER_RE`; the keyword arguments `'queued'`/`'validate-by:'`; `ARCHIVE_REASONS` + the `StateArchiveFlags.reason` typedef; `REASON_HOME_SECTION`; `CLOCK_GATES`; the lint messages; the two reminders; the usage text; the archive strings built from `flags.reason` (the refusal `not yet ${flags.reason}`, the section refusal `--reason ${reason} only applies…`, the action line `archived (${flags.reason})`, and the record heading `## [date] tag — ${flags.reason} · section`).
- Exported identifiers: `isWaitingThread`, `WAITING_LINE_LIMIT`, `BACKLOG_DORMANT_DAYS`, `STATE_NEAR_CAP_CHARS`, `checkBacklogUndated`, `checkBacklogDormant`, `checkWatchUndated`, `checkWatchDue`, `checkNearCap`. They are listed so a rename can include them.
- Comments and JSDoc in lib/state.mjs and lib/state-archive.mjs edited by this spec.
- Text: header lines 1-3 (canon + template); the canon bullets edited in Lane D and changelog item 18; ADR 0007 (headings AND body); docs/DESIGN.md; CONTEXT.md.
- Tests: test titles and pins in state, state-archive, bin.e2e, canon, templates, brief and state-agreement tests.
- After release, a rename cannot rewrite record headings already appended to users' `STATE-archive.md` files (`— dormant · Backlog (owned)`). So rename before Lane R or not at all.

## Lint findings (global mode; all WARN; non-placeholder bullets; excerpt = `excerpt60(rawLines[idx])`; interpolate the constants)

- `line-over-limit` (changed): an Active line with `isWaitingThread` uses 160: `"## Active threads" bullet in the waiting form is {n} chars (limit 160): "{excerpt}" — archive the full text (\`banana state archive --global --reason trimmed --match …\`), then shorten it in place`.
- `thread-inactive` (changed): 14; the tail after the excerpt becomes ` — archive it (\`banana state archive --global --reason inactive --match …\`); its next step stays at its pointer`.
- `backlog-undated`: `no valid "(queued YYYY-MM-DD)" stamp: "{excerpt}" — add one after the owner's " — "`.
- `backlog-dormant` (`age > 21`; skip a null ref / unstamped line): `queued {date} is {n} days before the reference date {ref} (dormant after 21): "{excerpt}" — archive it (\`banana state archive --global --reason dormant --match …\`)`. It names no renewal: renewing is the owner's word only.
- `watch-undated`: `no valid "(validate-by: YYYY-MM-DD)" stamp: "{excerpt}" — add the date it will next be checked`.
- `watch-due` (`age > 0`; skip a null ref / unstamped line): `validate-by {date} is {n} days before the reference date {ref}: "{excerpt}" — the owner, or a session working on what it names, checks it and writes a new date in place of this one; dropping it (\`banana state archive --global --reason removed --match …\`) is the owner's call`.
- `near-cap` (`9000 < len <= 10000` on the text `checkOverCap` measures): `{n} chars is past the 9000-char warning line (cap 10000) — archive every line lint flags expired, inactive or dormant, then write your own waiting threads in the waiting form`.

Every message keeps the existing excerpt shape `: "{excerpt}" —`, which the raw-excerpt tests extract with `/: "([^"]*)" —/`.

## Lane A0 — shared exports (sequential, first; main commits it on `cli-23`)

Files: lib/state.mjs; test/state.test.mjs and test/state-archive.test.mjs only for the pins these edits break. Ends with the full suite GREEN.
- :1571 `THREAD_INACTIVE_DAYS` → 14; add the three new exported constants beside it, each with a JSDoc line in the house style.
- :103 `ARCHIVE_REASONS` and the :122 typedef gain `'dormant'` after `'inactive'`.
- :1795 `export` `bulletIsThreadStale`, body unchanged; its JSDoc names the archive gate as its second caller.
- Pins: state.test `checkThreadInactive: the exact boundary — 30 days…` (:2327-2338) → 14/15 (`(as of 2026-01-01)` passes at ref 2026-01-15, warns at 01-16; retitle). :2618 title "31+" → "15+". Constants pin (:2649-2658) adds the three constants and 14 (retitle). state-archive.test parser regex (:243-246) → `expired\|inactive\|dormant\|trimmed\|closed\|removed`; `D3 — \`inactive\` not yet past the 30-day limit…` (:654-667) → `needs more than 14`, title "14-day"; `D3 — \`inactive\` at EXACTLY the 30-day limit…` (:2185-2206) → `(as of 2026-09-17)` refuses, `(as of 2026-09-16)` proceeds (retitle). List any other test you fix.
- **Known intermediate state:** from the A0 commit until Lane A merges, `--reason dormant` parses but is neither clock-gated nor section-restricted. `cli-23` is never pushed, released or bisected as a release before the merge; Lane A closes the gap. (Moving the `ARCHIVE_REASONS` edit to Lane A would make Lane A edit lib/state.mjs and break the no-shared-files rule.)

Then L ∥ A ∥ D run in worktrees from the A0 commit, with no shared files. Lane A imports `BACKLOG_DORMANT_DAYS`, `THREAD_INACTIVE_DAYS` and `bulletIsThreadStale`, and edits no line of state.mjs.

## Lane L — lint (lib/state.mjs, test/state.test.mjs, test/brief.test.mjs; test/log.test.mjs only if red)

1. Exported `isWaitingThread(preparedLine)` = `WAITING_MARKER_RE.test(maskBacktickSpans(preparedLine))` (`maskBacktickSpans` :1278).
2. `checkLineOverLimit` (:1642): the waiting cap + message, for `Active threads` only.
3. `checkThreadInactive` (:1834): the new tail.
4. `checkBacklogUndated(text, rawLines)` / `checkBacklogDormant(text, ref, rawLines)`: clones of `checkClosedUndated` (:1715) / `checkClosedExpired` (:1753); section `'Backlog (owned)'`, keyword `'queued'`, `if (age <= BACKLOG_DORMANT_DAYS) continue;`.
5. `checkWatchUndated` / `checkWatchDue` (`if (age <= 0) continue;`); section `'Watch'`, keyword `'validate-by:'`.
6. `checkNearCap(text)` beside `checkOverCap` (:1058).
7. `lintGlobalState` (:1908): `checkNearCap` right after `checkOverCap`; the four bullet checks right after `checkThreadInactive`. Update these JSDoc blocks: `lintGlobalState` (check count, :1888-1907); `excerpt60` (:507-520 — its list of WARNs whose remedy names `--match` gains `backlog-dormant` and `watch-due`); `globalReferenceDate` (:1862-1872 — "checkClosedExpired/checkThreadInactive both skip" becomes the four date checks; Backlog/Watch stamps never feed it); `bulletStampShapes` (:1316-1335 — name the `queued` and `validate-by:` keywords). Never touch `globalReferenceDate`'s code or project mode. Brief/log need no code (`findingTypeCounts` :2126 counts any `[\w-]+` type).

Tests (red first, literal values):
- Waiting: marked 160 passes, 161 warns with the waiting message; the same 161 unmarked passes; the 400 cap applies when the marker is not directly after the stamp, sits in backticks, has no colon within 40 chars (`— waiting on build; then ship`), or follows `(As of …)`. A marked line with no `→` still FAILs `thread-no-pointer`. A marked line stamped `(as of 2026-02-30) — waiting on x: y → \`~/projects/alpha/STATE.md\`` still FAILs `thread-stamp-malformed`.
- Inactive: rewrite `checkThreadInactive: the message names the remedy…` (:2340-2346) to pin `--reason inactive --match` and `its next step stays at its pointer`, with `then add a one-line Backlog item` absent. The stale-wins test (H55, :3539-3562) stays green.
- Backlog: undated for an unstamped line, `(queued 2026-02-30)`, a backticked stamp, and the prose `(idle since 2026-01-05)`; the placeholder and a post-dash stamp pass; a pre-dash stamp → `backlog-unowned`, no undated, and dormant at 22+; 21 passes / 22 warns; a null ref is skipped; the oldest of two stamps decides.
- Watch: the same day passes, the next day warns, a future date passes; colon-less is undated; the placeholder passes.
- Near-cap: 9,000 passes / 9,001 warns; at 10,001 only `over-cap`; never on a project page; the brief summary counts it.
- Raw-excerpt rule (pattern :2920-3035): one test per new bullet WARN (`backlog-undated`, `backlog-dormant`, `watch-undated`, `watch-due`). Extend C44 (:3250): `(queued 2099-01-01)` and `(validate-by: 2099-01-01)` leave `globalReferenceDate` unchanged. `CLEAN_GLOBAL` lints clean in LF and CRLF.

Fixtures (~10-15 edits; let a red run name the rest; report each with its reason):
- `CLEAN_GLOBAL` (:920) → `'- testagent — sweep the backlog (queued 2026-09-01)',`.
- **Rule: every replacement of the CLEAN_GLOBAL Backlog line targets the WHOLE new line, and its replacement text also carries `(queued 2026-09-01)`.** For a `bulletOfLength` built from it, the stamp goes inside the prefix: `bulletOfLength('- testagent — sweep the backlog (queued 2026-09-01) ', n)`. Sites: :1223 → replace the whole line with `'- unowned — nobody claimed this yet (queued 2026-09-01)'` (keeps exactly 1 finding, `backlog-unowned`; verified it still classifies unowned); :2157-2158; :2638-2639; :3191 (its `\n` form would otherwise silently match nothing); :3223-3224 (C28 "exactly at the limit": a trailing stamp would push it over); :3236-3237; :3674-3675.
- Two tests that assert an exact result and go red:
  - H42, `runStateLint --global: H42 — a home bootstrapped with a spaced owner…` (:2742): `'- Jane Doe — review the draft proposal'` → `'- Jane Doe — review the draft proposal (queued 2026-09-01)'` (exact `['state lint: PASS']`; the reference date is null there, so only `backlog-undated` would fire).
  - E3/H67, `lintGlobalState: E3/H67 — a page whose only Active/Backlog/Closed content is a commented-out bullet lints clean` (:2784): `'- x'` → `'- x (validate-by: 2026-09-01)'` (exact `[]`; the reference date is null there, so `watch-due` never runs and the date's value does not matter).
- The inline global pages at :2932, :2962, :2991, :3020, :3303 and :3550 assert with `find`/`some`/`ok` only: no edit.
- A moved reference date now also surfaces `backlog-dormant` (ref ≥ 2026-09-23 with CLEAN_GLOBAL), `watch-due` (ref > 2026-10-01) or `thread-inactive` (an Active stamp 15-30 days before ref). Adjust dates, not assertions.
- brief.test :263 → `'- testagent — sweep GLOBAL_ONLY_MARKER backlog item (queued 2026-07-01)',` (this also drops the real owner handle from that fixture); STALE_GLOBAL's Backlog line (:689) → `'- testagent — sweep the backlog (queued 2026-07-01)',`, still exactly `1 fail, 0 warn`. Near-cap needs no fixture edit: the only padded page, state.test :1040, pads to 10,001, where near-cap must not fire.

## Lane A — archive (lib/state-archive.mjs, bin/banana.mjs, test/state-archive.test.mjs, test/bin.e2e.test.mjs)

1. `d3ClockGateRefusal` (:348) → `(flags, matchedLinePrepared, today, home)` over `CLOCK_GATES = { expired: { keyword: 'closed', limit: CLOSED_EXPIRY_DAYS }, inactive: { keyword: 'as of', limit: THREAD_INACTIVE_DAYS, staleAware: true }, dormant: { keyword: 'queued', limit: BACKLOG_DORMANT_DAYS } }`. The early return becomes "no own row → null" (`Object.hasOwn(CLOCK_GATES, flags.reason)`). Order: missing stamp → future stamp → age ≤ limit (existing texts, e.g. `not yet dormant (needs more than 21)`) → stale: `this thread's project page is newer than its (as of {stamp}) stamp (thread-stale) — refresh the stamp instead of archiving it`. The caller (:752) passes `home` (from `const { home, now, io } = deps`, :621).
2. `futureElsewhere` (:761-764): compute when `Object.hasOwn(CLOCK_GATES, flags.reason)`; scan scope unchanged (Active `as of`, Recently-closed `closed`).
3. `REASON_HOME_SECTION` (:423-427) + `dormant: 'Backlog (owned)'`. Fix every comment v1.8 makes false:
   - :13-17 (the reused-helpers import list): add `BACKLOG_DORMANT_DAYS`, `bulletIsThreadStale`.
   - :320-347 (gate JSDoc): three gated reasons via `CLOCK_GATES`; the stale refusal; the verdict reads the matched line and, for `inactive`, its own pointer target.
   - :372-393 (`futureStampElsewhereNote` JSDoc): :379 "Watch/Backlog never carry this stamp convention" → "Backlog `(queued …)` and Watch `(validate-by: …)` stamps are never read for this note"; :384-386 "the same two reasons" → "any reason with a `CLOCK_GATES` row".
   - :412-422 (`REASON_HOME_SECTION` JSDoc): "an idle thread becoming a Backlog item" → "an idle thread leaving the page"; add `dormant` (a Backlog (owned) line past its dormancy, the one reason that reads a Backlog stamp); "neither reads a clock-aware stamp from any other section" → "no clock-gated reason reads a stamp outside its own section".
   - :429-440 (`reasonSectionRefusal` JSDoc) and :737-741 (caller comment): list `dormant` → Backlog (owned); replace the "Watch/Backlog line that happens to contain stamp-shaped text" rationale with "a line outside the reason's own section that happens to contain stamp-shaped text".
   - :757-760 (futureElsewhere comment): "the two reasons" → "the reasons with a `CLOCK_GATES` row".
4. Reminders (:785-802; dry run too): `inactive` → `reminder: this thread is off the page now — name it to the owner in your reply; its next step stays at its pointer, and only the owner re-queues it as a Backlog item`; new `dormant` → `reminder: this item is off the page now — name it to the owner in your reply; reviving it means a fresh line with today's (queued …) stamp, on the owner's word`.
5. bin `STATE_ARCHIVE_USAGE` (:143-199):
   - reasons (:179) → `one of: expired | inactive | dormant | trimmed | closed | removed`;
   - section paragraph (:157-161) adds `` `dormant` only applies to a Backlog (owned) line ``;
   - clock paragraph (:163-168): `expired`/`inactive` → `expired`/`inactive`/`dormant`; thresholds `` (`(closed YYYY-MM-DD)`, 7 days; `(as of YYYY-MM-DD)`, 14 days; `(queued YYYY-MM-DD)`, 21 days) ``; then add `` `--reason inactive` also refuses a thread whose project page is newer than its stamp — refresh the stamp instead. ``;
   - :170 `Watch and Backlog never carry this stamp convention` → ``Backlog `(queued …)` and Watch `(validate-by: …)` stamps are never read for this note``;
   - the three examples (:187-194): slug `stale-thread-name` → `idle-thread-name` (the inactive gate now refuses a stale thread, so the old slug teaches the wrong case);
   - both exit-code paragraphs (`STATE_USAGE` :119-126 and :196-199): `expiry/inactivity` → `expiry/inactivity/dormancy`; insert `a thread whose project page is newer than its stamp,` before `a future-dated stamp`.
   - **Each pinned phrase stays on one physical line of the usage string:** `spans more than one physical line`, `own section doesn't support`, `not yet past its` (STATE_USAGE) / `not yet past` (archive), `future-dated stamp`, `UTF-8`, `mid-write`, `wrapped bullet`, `A future-dated stamp on a DIFFERENT Active-threads or Recently-closed line`, ``Backlog `(queued …)` and Watch `(validate-by: …)` stamps are``, `unless every match is byte-identical`, `two-step`, `the command prints a reminder`, `deleted outright, never`. Keep the line break in ``no quotes, `$`, `%` or`` / `backtick` exactly as it is (bin.e2e :166 pins the `\n`).

Tests (`buildPage`/`makeHome`/`archive`, LOCAL_NOW 2026-10-01; a local `makeTargetState` copied from state.test :974-982 — `runStateArchive` resolves `~/` pointers against the injected sandbox `home`):
- dormant: `(queued 2026-09-10)` refuses `not yet dormant`, page byte-identical, no archive file; `(queued 2026-09-09)` removes exactly that line (byte-exact); unstamped → `use --reason removed`; a future stamp on the line refuses; `dormant` on an Active, Watch or Recently-closed line → section refusal; moving the last Backlog line writes the placeholder back; dry run writes nothing and prints the record + reminder; a future `(as of …)` on another line → the existing note.
- stale: `(as of 2026-09-01)` with its target dated 2026-09-05 refuses as stale, nothing written; it proceeds when the target is missing, undated, or dated 2026-09-01.
- Re-pin: `\`inactive\` also prints a Backlog-line reminder` (:555-564) → the exact new inactive reminder line (retitle); `--dry-run prefixes the REMINDER line too (#20c H32)` (:1882-1894) → `dry run — ` + the new inactive reminder; the C46 negatives (the `trimmed` block :2130-2137 and the `closed` test :2150-2160) test absence of `only the owner re-queues it` and `reviving it means a fresh line` (the old `Backlog (owned) item` string no longer exists, so the old negatives would pass vacuously); exclusivity incl. dormant (`dormant` prints only its own reminder; `inactive` never prints the dormant one; `removed`/`expired`/`trimmed`/`closed` print neither); both reminders byte-exact.
- bin.e2e: H52 test (:148-156) keeps the DIFFERENT-line pin and moves the other to ``Backlog `(queued …)` and Watch `(validate-by: …)` stamps are``; the slug test (:160-170) pins `--match idle-thread-name` for all three shells. One sandboxed `--reason dormant` e2e on `(queued 2020-01-01)` (`HOME`/`USERPROFILE` = temp dir; the record date computed as at :479-485, never through `formatLocalDate`).

## Lane D — canon, template, docs

Files: canon/CONTINUITY.md, templates/global-STATE.md, docs/adr/0007-global-page-outflow.md (new), docs/adr/0006-global-page-limits-and-archive.md (one paragraph), docs/DESIGN.md, CONTEXT.md, test/canon.test.mjs, test/templates.test.mjs.

Edit (never Write) canon and template; keep their CRLF working tree (index is LF). Every canon edit below is old text → new text, anchored on sentences, never on line ranges. The sentences are quoted flattened; in the file they wrap across CRLF lines with two-space indentation. Read the bullet first, build each `old_string` from the actual wrapped lines, then re-wrap the new text at the file's existing width.

### Header (template lines 6-9 and canon :95-98 → five lines, byte-identical in both files)

```
> One line per bullet: thread 400 (waiting form 160) · backlog 300 · watch 350 · closed 250 chars.
> Against the newest (as of)/(closed) stamp: closed lines expire at 8+ days, threads idle 15+ days
> and backlog lines (queued …) 22+ days leave; a watch past its (validate-by: …) date is checked.
> Never delete a line — except a pasted secret, deleted outright. Before adding a line, any session
> archives the lines lint flags to leave (`banana state archive`), keeping them in STATE-archive.md.
```
Each line is [P-raw] (measured 98/98/97/99/100; +144 chars over v1.7). Pin that `RETIRED_HEADER_RE` does not match them (verified). Header lines 1-5 above them and every placeholder stay unchanged.

### canon/CONTINUITY.md

Marker `<!-- banana:canon rev 1.8 -->`; title `… — v1.8`.

**Session close** bullet. After "re-stamping each touched thread's `(as of)` from its source." insert:
> Before adding a line, first archive every line lint flags to leave (see "The archive move" below). When your thread's next step becomes someone else's, write it in the waiting form.

**Session lifecycle CLOSE** step. Leave the pinned clause "global STATE.md: never rebuilt — edit only the threads and items this session owns or changed" byte-identical. After "per the Global-grain per-thread-edits rule above" insert ", after first archiving the lines lint flags to leave" (before the closing parenthesis).

**Freshness stamp** bullet. Append [P]:
> "At session close, right after the fresh read, a session that worked a thread may re-stamp its `(as of)` to the heading date of its own newest session-log entry for that work, in that project's `.agents/session.log`; a stamp never moves forward without such a source."

**Limits and the one-line rule** bullet. Append: "A thread in the waiting form caps at 160 (see "Waiting form" below)."

**New bullets after Limits, before Closed stamp:**
> - **Waiting form** (v1.8) — a thread whose next step is someone else's (the owner's review, ruling or action, or an outside party) is written in the waiting form, at most 160 chars: `**name** (as of YYYY-MM-DD) — waiting on {who}: {the ask} → pointer`. The marker is the exact lower-case text ` — waiting on ` directly after the `(as of …)` stamp, then `{who}` (1-40 chars, no colon), `: ` and the ask. It only selects the cap (lint cannot tell a waiting thread from a live one); every other Active-threads rule still applies, and its stamp still counts toward the reference date. When the wait ends, the session that picks the thread up rewrites it in the full form.
> - **Near-cap** (v1.8) — `banana state lint --global` WARNs `near-cap` past 9,000 chars: archive the flagged lines first, then write your own waiting threads in the waiting form. If it fires in two different weeks in a row, the session that sees it proposes lowering the thread limit to 10 days and the owner rules; per-section budgets are a later option, also the owner's. No session changes a limit on its own.

[P]: "The marker is the exact lower-case text ` — waiting on ` directly after the `(as of …)` stamp" · "When the wait ends, the session that picks the thread up rewrites it in the full form" · the whole Near-cap text from "WARNs `near-cap` past 9,000 chars" to "No session changes a limit on its own."

**Closed stamp and expiry** bullet. Old "(Watch and Backlog never carry this stamp convention, so they are never counted)" → new [P] "(Backlog `(queued …)` and Watch `(validate-by: …)` stamps are measured against it but never feed it, so they are never counted)".

**Thread inactivity** bullet. Replace the whole bullet with:
> - **Thread inactivity** — an Active-threads bullet, in either form, whose `(as of)` stamp is more than 14 days before that same reference date — 15 or more — leaves the page: archive it (`--reason inactive`); nothing replaces it, because its next step already lives at its pointer. Only the owner re-queues it as a Backlog item; a session that works the thread again re-adds its Active line at that session's close, stamped from a real source. A bullet that already FAILs `thread-stale` skips `thread-inactive` until its stamp is refreshed: the two remedies contradict (refresh the stamp vs. archive the thread). `banana state lint --global` WARNs `closed-expired`, `thread-inactive` and `backlog-dormant` (advice, not defects — the page-wide cap stays the FAIL backstop).

[P]: "more than 14 days before that same reference date — 15 or more — leaves the page" · "Only the owner re-queues it as a Backlog item; a session that works the thread again re-adds its Active line at that session's close" · "A bullet that already FAILs `thread-stale` skips `thread-inactive` until its stamp is refreshed".

**New bullets after Thread inactivity, before The archive move:**
> - **Queued stamp** (v1.8) — every Backlog (owned) bullet carries `(queued YYYY-MM-DD)`, the day it was added, after the owner's ` — `: `{owner} — name (queued YYYY-MM-DD): action → pointer`. Editing never changes it; only a re-queue on the owner's word writes a new date, in place of the old one — with two stamps the oldest counts, so an added stamp renews nothing. An item goes dormant when its stamp is more than 21 days before the page's reference date — 22 or more — agent items too, unless the owner renews it; it leaves with `--reason dormant` and nothing replaces it. A stamp before the owner's ` — ` FAILs `backlog-unowned` and still counts. `banana state lint --global` WARNs `backlog-undated` and `backlog-dormant`.
> - **Watch date** (v1.8) — every Watch bullet carries `(validate-by: YYYY-MM-DD)`, the date it is next checked; a watch that waits on an event still gets the date it will next be checked, keeping the event in its text. Once the page's reference date is past it, `banana state lint --global` WARNs `watch-due`: the owner, or a session working on what the line names, checks it and writes a new date in place of the old one; dropping it (`--reason removed`) is the owner's call. A due Watch line is never moved on sight. No valid stamp WARNs `watch-undated`.

[P]: "more than 21 days before the page's reference date — 22 or more" · "in place of the old one — with two stamps the oldest counts, so an added stamp renews nothing" · "the owner, or a session working on what the line names, checks it and writes a new date in place of the old one" · "A due Watch line is never moved on sight".

**The archive move** bullet (sentence anchors):
- `<expired|inactive|trimmed|closed|removed>` → `<expired|inactive|dormant|trimmed|closed|removed>`.
- "The five reasons: `expired` (a closed line past its expiry), `inactive` (an idle thread becoming a one-line Backlog item), `trimmed`" → "The six reasons: `expired` (a closed line past its expiry), `inactive` (an idle thread leaving the page), `dormant` (a Backlog item past its dormancy), `trimmed`" (the trimmed/closed/removed definitions stay). [P] "`inactive` (an idle thread leaving the page)" · [P] "`dormant` (a Backlog item past its dormancy)".
- "`inactive` and `closed` only target an Active-threads line;" → "`inactive` and `closed` only target an Active-threads line; `dormant` only targets a Backlog (owned) line;".
- Replace exactly the sentence `Exception to "edit only your own threads" above: any session may archive an \`expired\` closed line on sight — no judgment is needed to recognize one.` (it starts mid-line, after the word "trimmed." that ends the E11 sentence; "trimmed." stays) with:
> Exception to "edit only your own threads" above: any session may archive, on sight, a line that `banana state lint --global` WARNs `closed-expired`, `thread-inactive` or `backlog-dormant` — a date comparison that authors nothing, re-checked by the archive against the real clock — and a session about to add a line to the page first archives every such line. This is a filing step, not initiative under rule 5: the dates have already decided, and nothing is re-planned. If the archive reports no match and a fresh read shows the line gone, another session moved it first — a normal outcome, not an error. After the archive exits 0, name each moved line to the owner in your reply. Nothing else about another session's line is on sight: trimming, closing, rewriting into the waiting form, re-queuing a Backlog item or re-stamping a thread stays with its owning session or the owner, and a due Watch line is re-dated only as "Watch date" above allows.

[P each]: "above: any session may archive, on sight, a line that `banana state lint --global` WARNs `closed-expired`, `thread-inactive` or `backlog-dormant`" · "and a session about to add a line to the page first archives every such line" · "This is a filing step, not initiative under rule 5" · "another session moved it first — a normal outcome, not an error" · "After the archive exits 0, name each moved line to the owner in your reply" · "a due Watch line is re-dated only as "Watch date" above allows".

**The archive command is the clock-aware gate** bullet:
- "its `expired`/`inactive` gate can disagree with lint's own `closed-expired`/`thread-inactive` WARNs:" → "its `expired`/`inactive`/`dormant` gate can disagree with lint's own `closed-expired`/`thread-inactive`/`backlog-dormant` WARNs:". The pinned clause "lint compares a stamp against the page's reference date, the gate compares the same stamp against today" stays byte-identical.
- "for `--reason inactive` it refuses unless the `(as of …)` stamp is more than 30 days before today." → [P] "for `--reason inactive` it refuses unless the `(as of …)` stamp is more than 14 days before today, and it also refuses a thread whose project page is newer than that stamp — refresh the stamp instead; for `--reason dormant` it refuses unless the `(queued …)` stamp is more than 21 days before today." (The expired half before it stays.)
- "the gate's own verdict is decided entirely by the matched line's own stamp against the real clock" → [P] "the gate's own verdict is decided by the matched line alone — its own stamp against the real clock and, for `--reason inactive`, its own pointer's project page". The note-scope sentence ("…so Watch and Backlog are never scanned for it either") stays unchanged.

**No edit:** the "Rules that keep this working" section, rule 5, Upstream and sync, item 17 (v1.7's record stays as written, including its item-17 on-sight and thirty-one-day text).

**Changelog.** After item 17, add:
> v1.8 amends the **global-grain outflow** rules (ADR 0007 in the kit repo). Nothing else changes.
>
> 18. **Threads and Backlog leave by date; Watch gets a due date** — an Active-threads bullet whose `(as of)` stamp trails the page's reference date by fifteen days or more leaves the page whole (`--reason inactive`); nothing replaces it, because its next step lives at its pointer. A thread whose next step is someone else's is written in the waiting form, ` — waiting on {who}: ` directly after its stamp, capped at 160 chars. Every Backlog (owned) bullet carries `(queued YYYY-MM-DD)`, the day it was added, which only a re-queue on the owner's word replaces; it goes dormant at twenty-two days or more and leaves with `--reason dormant`. Every Watch bullet carries `(validate-by: YYYY-MM-DD)`; a due line WARNs `watch-due` and is re-dated by the owner or a session working on what it names, never moved on sight. Neither new stamp feeds the reference date. `banana state lint --global` WARNs `near-cap` past 9,000 chars. Exception to item 16's "edit only your own threads", widened from item 17: any session may archive, on sight, a line lint WARNs `closed-expired`, `thread-inactive` or `backlog-dormant`, and a session about to add a line first archives every such line — a filing step, not initiative under rule 5. `banana state archive --reason inactive` also refuses a thread whose project page is newer than its stamp. At close, a session that worked a thread may re-stamp it from the heading date of its own newest session-log entry for that work. Counter-failure: the page refilled to its cap within a week of v1.7's cleanup, because only one section had an outflow.

[P]: "v1.8 amends the **global-grain outflow** rules (ADR 0007 in the kit repo)" · "Threads and Backlog leave by date; Watch gets a due date" · "Exception to item 16's "edit only your own threads", widened from item 17" · "Counter-failure: the page refilled to its cap within a week of v1.7's cleanup, because only one section had an outflow." The changelog carries no ratification provenance (v1.7's does not), so ratification changes nothing here.

### ADR 0007 (docs/adr/0007-global-page-outflow.md, format of 0006, no names)

- Title: `# Global page gets an outflow for threads and backlog, and a due date for watch`.
- Decided line, written now: `Decided (2026-10-10). Decisions 1, 3, 4 and 5 follow owner rulings; decisions 2, 6, 7 and 8, the no-roll-up call and the header text are technical calls, pending the owner's ratification of the v1.8 text.` Lane R replaces it (see Lane R). Not pinned.
- Context: the Why numbers with their VERIFIED/SNAPSHOT/INFERRED tags, plus this sensitivity table (INFERRED; one input moved at a time from the ~7,530 central case):

| Case | Projected chars |
|---|---|
| 75% of waiting threads use the waiting form | 8,220 |
| 50% use it | 8,920 |
| None use it | 10,300 (thread limit 10 → 9,020) |
| Lag 2.5 days | 7,970 |
| Arrivals 1.2/day | 8,390 |
| Backlog inflow 0.45/day | 8,430 |
| 5 live full-form threads | 8,470 |
| Backlog limit 30 | 7,970 |
| Thread limit 21 | 8,560 |
| Calm (0.5/day, Backlog 0.13/day) | 5,590 |
| Correlated high (1.2/day, Backlog 0.45/day, lag 2.5, 75% form use) | 10,900 (thread limit 10 → 9,860) |
| v1.7 rules | ~14,000 and rising |

- Decision headings [P each]: `## 1. Threads leave at 15+ days, whole` · `## 2. The waiting form` · `## 3. Backlog items carry (queued) and go dormant` · `## 4. Watch lines carry (validate-by:) and warn when due` · `## 5. Flagged lines move on sight, writer pays` · `## 6. near-cap at 9,000, and its escalation` · `## 7. The inactive gate refuses a stale thread` · `## 8. A mid-arc re-stamp source`. Decision 5 also records the no-roll-up call (the mover names moved lines in its reply; the archive is searched with grep) and the five header lines. Decision 6 says "write your own waiting threads".
- Considered options (rejected), each with its reason:
  - A fifth section: if required, every unmigrated page FAILs `missing-section` and about 59 fixture headings change; if optional, `state archive` cannot reach it and its stamps leave the reference date.
  - A kit-written names-only roll-up line: extends the kit's one-line write scope, and the 300-char cap fills after about 12-15 names, so it would need its own aging rule. A hand-written sweep line per session in Recently closed: its `(closed)` stamp moves the reference date, and unfinished items sit in Recently closed. One append-only dormant line per agent tag: concurrent sessions with the same tag fight over it.
  - Residence that depends on the marker: lint cannot enforce the marker, so a missing marker would keep a thread on the page (projected 9,600-10,050).
  - A 7-day thread limit: a mid-arc thread reads 8+ days idle, because project pages are rebuilt only at session close. 10 days: about -600 chars, more risk for mid-arc threads (kept as the near-cap escalation lever). 21 days: about +1,000 chars, a thin margin. 30 days (keep): about 9,900 chars even with full waiting-form use.
  - A 14-day Backlog limit: about -340 chars, but owner items vanish after two weeks, which invites renewals. 30 days: about +440 chars; stress cases pass 85% of the cap.
  - A stamp any edit renews ("date last changed"): any edit restarts the clock, so Backlog has no limit again. An agent renewing its own item with a changed action: a keep-alive leak nothing can detect.
  - Waiting form for owner-review waits only: threads waiting on outside parties stay full length, about +150-300 chars. A 150 cap: about -60 chars, one more trim at migration. No waiting form: about 10,300, over the cap, unless the thread limit drops to 10.
  - On-sight Watch removal through a gated reason: any session could archive an unchecked standing guard (a "must stay off" setting) days after an artificial date. Only the owner acts on a due Watch line: due lines pile up in briefs between owner reviews. An owner prefix on Watch lines: a new owner-check class plus churn on every live Watch line. Deferring Watch: lines that name an event instead of a date never leave.
  - On sight for expired + dormant only: idle threads wait for owner-ordered cleanups (Active about +1,000, page near 8,500-9,000). Expired only (keep): the measured failure, a refill in 7 days. Amending rule 5's own text: the same behavior, one more canon change, and the rules preamble would have to list v1.8.
  - v1.7's Backlog demotion of idle threads: about +1,800 chars at steady state, and writing the line needs judgment, which rules out on-sight moves. A standing owner-written Backlog line for every moved thread: not adopted as a rule; the owner may already re-queue any moved thread.
  - Backlog or Watch stamps in the reference date: a far-future item stamp would age every other line (settled in ADR 0006). A cap raise (rejected in ADR 0006).
  - near-cap at 8,500: fires near the high end of normal swings. near-cap with no escalation: a page sitting near the cap for weeks has no agreed next step. No near-cap: the FAIL lands on whoever writes last.
  - No stale check in the gate: a session archiving by hand without a fresh lint can move a thread whose project has moved on, recorded as inactive.
  - No new re-stamp source: a mid-arc thread reads idle at 15 days and can be moved on sight. Today's date at close: unverifiable, so any session could keep any thread alive forever.
  - A header with numbers and stamps but no duty line: harnesses that read only the page never learn who moves flagged lines. An unchanged header: it keeps teaching "31+ days, move to Backlog".
- Consequences: amends ADR 0006's 30-day inactivity limit (0006:23, :137 — now 14), its on-sight scope (0006:160-163), its two-step inactive remedy (0006:157-159) and its D3 verdict sentence (0006:141-143). 0006's "Watch and Backlog never carry this stamp convention" no longer holds literally: both sections carry stamps now, and those stamps still never feed the reference date or the future-stamp note. 0006's text stays as written (its pins stay green).
- Known limits (below).

ADR 0006: one new paragraph between the title and "Decided", nothing else [P]: `Amended by ADR 0007 (canon v1.8): the 30-day inactivity limit (now 14), the on-sight scope, the inactive remedy, and the D3 gate's inactive verdict.`

### docs/DESIGN.md

- :10-12 → "Seven commands: `init` (machine wiring), `project` (repo init), `brief` (per-intent context compiler), `doctor` (audits), `sync` (propagates upstream canon and wiring changes), `log` (stamps session-log entries), `state` (lints a STATE page; archives a global-page line) — plus a bare `version` subcommand."
- :14 heading → `## The architecture being shipped (canon v1.3 baseline; later revisions in the canon changelog)`.
- :81 "(rebuilt whole, never patched)" → "(rebuilt whole, never patched — true at v1.3; replaced by per-thread edits in v1.6, ADR 0005)".
- Global-mode table (:599-603): `line-over-limit` row appends "; an Active-threads line carrying the waiting-form marker (`isWaitingThread`) caps at `WAITING_LINE_LIMIT` (160) instead"; `thread-inactive` row 30 → 14 (both mentions); add rows `backlog-undated`, `backlog-dormant` (`BACKLOG_DORMANT_DAYS` (21), equal passes), `watch-undated` (the colon is part of the keyword), `watch-due` (the same day passes; never moved on sight), `near-cap` (`STATE_NEAR_CAP_CHARS` (9,000) < length ≤ 10,000; global only; above the cap only `over-cap`).
- :614-626: "the five WARNs" → the ten WARNs, named; "Four of the five need judgment…" → "Most need judgment to fix (what to cut, whether a due watch still holds); the date-driven moves (`closed-expired`, `thread-inactive`, `backlog-dormant`) need none and may be done on sight (canon v1.8, ADR 0007)".
- :655-680 (reference date): "Watch and Backlog never carry this stamp convention, so they are never counted either" → "Backlog `(queued …)` and Watch `(validate-by: …)` stamps are measured against it but never counted toward it"; "both date checks are skipped" → "every date check is skipped"; thresholds: `THREAD_INACTIVE_DAYS` (14), "8 and 31 days" → "8 and 15 days", plus `backlog-dormant` at 22 and `watch-due` one day past its date.
- :727 enumerator and :744-749 reasons → six, with the canon's new `inactive`/`dormant` definitions; :755 "five-value vocabulary" → "six-value".
- :787-795 (section restriction): add `dormant` → Backlog (owned); replace the Watch/Backlog stamp rationale as in Lane A item 3.
- :797-827 (gate): the disagreement sentence names `expired`/`inactive`/`dormant` and the three WARNs; thresholds 14 and 21 + the stale refusal; "the gate's whole verdict is decided by the matched line's own stamp" → "decided by the matched line alone (and, for `inactive`, its own pointer's project page)"; :825-826 "Watch and Backlog never carry this stamp convention" → "Backlog and Watch stamps are never read for the note".
- :903-907 "Every other reason (`expired`, `inactive`, `closed`, `removed`)" → add `dormant`.
- :928-933 (Output): the two reminder texts.
- Must stay byte-identical (canon.test pins inside DESIGN.md): the H47 sentence "lint compares a stamp against the page's reference date, the gate compares the same stamp against today"; the `#20d F8` pins "is ALWAYS a continuation line — whatever it itself holds (an indented heading" and "with no blank line required first"; the `#20d F9` pins (canon.test :510-535).

### CONTEXT.md

- New terms (literal):
  - **Waiting form** — an Active-threads bullet written `**name** (as of YYYY-MM-DD) — waiting on {who}: {the ask} → pointer` (canon v1.8, ADR 0007): the exact marker ` — waiting on ` right after the stamp selects a 160-char cap instead of 400. It changes only the cap; residence and every other thread rule stay the same, and lint cannot tell whether a thread should use it.
  - **Queued stamp / dormant** — the `(queued YYYY-MM-DD)` every Backlog (owned) bullet carries after the owner's ` — `: the day the item was added, replaced only by a re-queue on the owner's word. More than 21 days before the reference date the item is dormant: `backlog-dormant` WARNs, and `banana state archive --reason dormant` moves it off the page.
  - **Watch date / due** — the `(validate-by: YYYY-MM-DD)` every Watch bullet carries: the date it is next checked. Once the reference date is past it, `watch-due` WARNs; the owner, or a session working on what it names, writes a new date in place of the old one; dropping it is the owner's call; it is never moved on sight.
  - **Near-cap** — `banana state lint --global`'s WARN past 9,000 of the 10,000 chars: archive the flagged lines, then write your own waiting threads in the waiting form; two weeks in a row → the session proposes a 10-day thread limit and the owner rules.
- Per-thread edit (:36-44): the exception becomes "Exception (canon v1.8, ADR 0007, widening v1.7's): any session may archive, on sight, a line lint WARNs `closed-expired`, `thread-inactive` or `backlog-dormant`, and a session about to add a line archives every such line first — a filing step that authors nothing."
- Reference date (:45-50): "`closed-expired`, `thread-inactive`, `backlog-dormant` and `watch-due` compare stamps against it; Backlog `(queued …)` and Watch `(validate-by: …)` stamps never feed it; with no valid stamp anywhere, those checks are skipped."
- Archive move (:51-59): the six-reason enumerator.

README: no change (no thresholds, reasons or stamps; its kit-exception paragraph stays true).

### Pins that move

- canon.test: `EXPECTED_REVS` (:39-43) → `'1.8'`; the v1.7 test (:193-211) drops its `— v1.7` title assert (a new v1.8 test owns `— v1.8`, item 18's title, the ADR 0007 pointer and the counter-failure); the header test (:252-278) and templates.test (:202-220) → the five [P-raw] lines, ≤100 each, both files, with `31+ days`, `idle 30+ days`, `expire after 7 days` and `move to Backlog` absent; the direction test (:280-293) → `more than 14 days before that same reference date — 15 or more` (the closed half unchanged); the reasons test (:339-354) → six definitions, retitled; the gate test (:356-380) → inactive 14 + stale clause + dormant 21 (the expired and LINE-SCOPED pins unchanged); H17 (:537-555) body half → the new on-sight [P] (item-17 half and the reverted-exception negative unchanged); H17 note (:557-577) → the new verdict [P]; H52 (:644-660) body half → the new closed-stamp parenthetical (item-17 half unchanged).
- New: one test per [P] group above, the ADR 0007 headings, the ADR 0006 Amended-by line, `RETIRED_HEADER_RE` not matching the five lines.
- Stay green: the `#20d F7` CLOSE pin (:468-480), H47 (:631-642), note scope (:579-587), every ADR 0006 pin (:662-701), the canon ↔ template placeholder pins, the fifth record-heading pin (:703+), no-machine-strings.

## Lane I — agreement (new test/state-agreement.test.mjs, on `cli-23` after the merge)

- Copy `makeTargetState` from test/state.test.mjs :974-982 (it is module-private there). Flags/io shaped like test/state-archive.test.mjs's `archive` helper.
- Each case: a full four-section page whose newest Active stamp is `(as of 2026-10-01)` (reference date = the day of `now = new Date(2026, 9, 1, 12).getTime()`); run `lintGlobalState` and `runStateArchive` on it in sandbox homes. dormant `(queued 2026-09-09)` WARN + proceeds, `2026-09-10` neither; inactive `2026-09-16` WARN + proceeds, `2026-09-17` neither; expired `(closed 2026-09-23)` / `2026-09-24`; `(as of 2026-09-01)` pointing at `~/projects/alpha/STATE.md` dated 2026-09-05 → `thread-stale`, no `thread-inactive`, gate refuses as stale.
- Canon ↔ code tie (house "fifth pin" pattern): read canon/CONTINUITY.md, extract the literal `**name** (as of YYYY-MM-DD) — waiting on {who}: {the ask} → pointer`, substitute `2026-10-01` / `owner` / `review the notes` / `` `~/projects/alpha/STATE.md` ``, prefix `- `, and assert `isWaitingThread` is true; with `(As of` it is false.

## Order and merges

Baseline on main HEAD (946 pass + 2 skipped at 0.4.0) → A0 committed on `cli-23` → L ∥ A ∥ D from it (main re-runs gates, commits `cli-23-l/-a/-d`) → rebase onto `cli-23` (a conflict = a lane left its file list: stop, report) → Lane I + full suite → review round(s) → owner ratifies the v1.8 text → Lane R → fast-forward local main. Lanes never commit or push; every edit goes to a task-worker as exact edit specs; main validates and commits.

## Lane R — after ratification (docs/adr/0007-global-page-outflow.md, package.json, package-lock.json)

1. ADR 0007's Decided line → `Decided (2026-10-10, ratified by the owner on <ratification date>).` (task-worker edit).
2. `npm version 0.5.0 --no-git-tag-version` (the lock keeps `banana-brain` at :2 and :8; `test/readme.test.mjs:62-65` already reads `pkg.version`). Gates; `node bin/banana.mjs version` prints `0.5.0`.
3. Main commits `chore(release): 0.5.0` locally. Doctor origin check: `checkOriginAhead` (lib/doctor.mjs:431-450) compares local with origin's package.json, so after the owner-approved push a 0.4.0 install prints `kit v0.4.0 is behind origin v0.5.0 — run banana sync`.
4. Push, sync and home verification are a follow-on release spec, owner go, carrying the design record's steps 4-9: push main only; verify that origin and npx serve 0.5.0; back up the home files (global STATE and archive, the canon directory, the wiring files, the session-start hook); run `banana sync` through the installed command; expect the kit update and CONTINUITY rev 1.8 with wiring still v3; while #19 (sync line endings) is open, STANDARD.md and SESSION-LOG.md may report "refreshed" for a CRLF-only change, so compare their hashes after normalizing line endings; hash-check every other home file against its backup; doctor clean and the global lint WARN-only.

## Gates and DoD (each lane, then the merged tree)

- `npm run check` clean; `timeout 300 npm test` green against the baseline (`RTK_DISABLED=1` for full output, never `rtk proxy`); one file: `node --test test/<name>.test.mjs`. Expect about +80 tests (L ~45, A ~20, D ~12, I ~8).
- Red first; expected values literal, never computed by the code under test.
- Mutations, each turning a named test red: inactive `<=`→`<`; limit back to 30; dormant `<=`→`<`; gate `>`→`>=`; no `dormant` gate row; no `dormant` home section; no `staleAware`; unanchored marker; no masking in `isWaitingThread`; `WAITING_LINE_LIMIT` ignored; `queued` fed into `globalReferenceDate`; watch-due `<= 0`→`< 0`; near-cap bound off by one / firing above the cap; `checkBacklogUndated` not called; two-reason `futureElsewhere`; inactive reminder on `trimmed`; case-insensitive marker.
- Synthetic fixtures; every CLI test sets `HOME` and `USERPROFILE` to a temp dir; never touch the real `~/.agents/`.
- `node bin/banana.mjs state lint` on the repo exits 0.
- Privacy gate on ADDED lines only (removed lines and context lines legitimately hold the real handle, e.g. brief.test :263 and ADR 0006's Decided line): `git diff main...cli-23 | grep '^+' | grep -iE '<owner name>|<machine name>|[A-Z]:[\\/]'` → nothing.
- Report: files changed, test counts before/after, each fixture edit + reason, each mutation + the test that caught it.

## Out of scope

The owner-page migration (private, after release); pushing and `banana sync` (follow-on release spec, owner go); CLAUDE.md/AGENTS.md; the wiring roster; any new kit write, section or reference-date change; rule 5's text; README's stale command table and the real handles left in state/archive test fixtures (file separately).

## Known limits (into ADR 0007)

- The waiting form is a convention: lint cannot tell a waiting thread from a live one; a missing marker costs about 230 extra chars for the thread's 15 days; `(As of …)` gets 400 because the marker is case-sensitive while stamps are not.
- On-sight moves drop an unreviewed ask after 15 idle days; it lives on at its pointer and in the archive.
- A finished, never-closed thread leaves as `inactive`, never `closed`, so it gets no Recently-closed line.
- When nobody stamps, nothing ages; then the WARNs land at once.
- A far-future `queued`/`validate-by:` date keeps a line forever; nothing limits how far ahead a date can be.
- Unsourced re-stamps and unchecked re-dates are undetectable.
- The stale gate reads the pointer target at archive time; a page edited between lint and archive can change the verdict (lint has the same gap).
- Watch has no owner field; "a session working on what the line names" is a convention.
- The Backlog placeholder shows no stamp, so a fresh page's first Backlog line WARNs `backlog-undated` until its writer follows header line 3.
- Installed pages keep the v1.7 header until hand-edited.
- near-cap streaks are tracked by sessions, not by the kit.
- A mid-arc session that skipped the re-stamp can see its thread moved on sight after 15 days; it re-adds the thread at close, which costs one extra archive record.

## Amendments after lane review (2026-10-12)

The lane D reviewer found canon and ADR 0007 sentences that were spec-verbatim but weaker or less precise than the rulings. These replace the spec text above; the canon and ADR 0007 carry the new wording, and the canon pins follow it.
- Lint finding note: "(advice, not defects — …)" → "(WARNs, not FAILs — …)", since writer-pays makes acting on them a duty.
- On-sight exception: re-queuing a Backlog item takes the owner's word (it no longer reads as the owning session's call).
- Re-stamp source: "without such a source" → "without a real source: the project STATE's as-of, or that session-log heading date".
- Clock-free note: a mistyped future stamp can WARN a page "expired, inactive, dormant or due".
- ADR 0007: ADR 0004 set the 10,000 cap; Watch lines never leave "by rule"; the placeholder Known limit names the `(queued …)` stamp.

## Amendments after the final review (2026-10-12)

A blind case walk of the v1.8 canon (two reviewers) and a final merged-tree review found these; the canon, CLI and ADR 0007 carry the new wording.
- Stale refusal: the CLI and canon now say only the thread's owning session refreshes the stamp; any other session leaves the line and names it to the owner. A FAIL on another session's line never blocks your own edit.
- "The owner" who renews or re-queues is the page's `Owner:`, a human; an agent never renews its own item.
- Close order: re-stamp your own threads first, then lint the fresh read, then archive the flagged lines, then add your line.
- Reviving a moved item: a fresh line on the owner's word, today's `(queued …)` date; the archive record stays.
- The canon shows the full archive invocation (`--global --match <text> --tag <agent> --reason …`).
- Near-cap: the session names it to the owner with the char count and asks whether it fired the week before.
- Watch: a session working on what the line names may update its text; if the check settles it, it re-dates the line and proposes the drop.
- Header line 3: "a due watch (validate-by: …) is re-dated, not moved."
- CLI: the no-match error and the changed-after-archiving message tell the caller to re-read the page (another session may have moved the line); ADR 0007 adds the duplicate-record known limit.
- Test: the waiting marker's `: ` + ask tail; JSDoc: near-cap is "a WARN, not a FAIL".
