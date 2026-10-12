# Global page gets an outflow for threads and backlog, and a due date for watch

Decided (2026-10-10). Decisions 1, 3, 4 and 5 follow owner rulings; decisions 2, 6, 7 and 8, the no-roll-up call and the header text are technical calls, pending the owner's ratification of the v1.8 text.

ADR 0006 gave the global page (`~/.agents/STATE.md`), already capped at 10,000 chars by ADR 0004, per-section line limits and an archive, but only one section got an outflow by rule: Recently-closed lines expire. Active threads and Backlog lines never leave unless someone resolves them, and Watch lines never leave by rule. This ADR gives threads and Backlog a date-driven exit, gives Watch a due date, and moves the duty to file flagged lines onto whoever is about to add a line. It amends ADR 0006 in four places (see Consequences).

## Context

Numbers come from the owner page. Tags: VERIFIED = re-measured from files; SNAPSHOT = from page snapshots, not reproducible from this repo; INFERRED = a judgment.

- Size on 10-10, counted the way lint counts (`prepareText(raw).length`) (VERIFIED): 9,968 of 10,000 chars. Header 789 · Active 4,171 (13 lines) · Backlog 2,965 (17) · Watch 1,346 (6) · Recently closed 697 (3).
- The 0.4.0 cleanup took the page from 9,912 to 7,289 on 10-03 (SNAPSHOT): net +2,679 in about 6.8 days, about +394/day, Active about 70% of it (SNAPSHOT).
- New Active threads arrive at 0.88/day and average 364 chars (SNAPSHOT). 11 of the 13 live threads wait on someone: the owner's review, ruling or action, or an outside party (INFERRED from each line's next step). Nothing re-stamps a waiting thread.
- The oldest live Active stamp is 2026-09-30, so no Active line can leave by rule before 10-31 (VERIFIED). Under v1.7, idle threads would then pile into Backlog as demotions start, and Backlog has no outflow (INFERRED).
- Backlog and Watch have no outflow: 3 Backlog lines left in 45 days, each only when someone resolved it (SNAPSHOT); no Watch line has ever left by rule.
- The only outflow by rule in the 0.4.0 week was 4 expired closed lines, archived on 10-09 (VERIFIED), 2-3 days after they became eligible (SNAPSHOT).
- Projection (model: stock = inflow × residence × line length per section; INFERRED): v1.7 rules head for about 14,000 and rising. v1.8: **about 7,530 central**, assuming waiting threads use the waiting form (0.85 waiting share), a 1-day lag under writer-pays, and the 0.88/day arrival rate holding beyond the 7-day burst it was measured in. **With no waiting-form use, about 10,300 (over the cap).** The correlated high case reaches about 10,900. The near-cap WARN and its escalation exist for exactly this risk.

Sensitivity (INFERRED; one input moved at a time from the ~7,530 central case):

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

## 1. Threads leave at 15+ days, whole

An Active-threads bullet, in either form, whose `(as of)` stamp is more than 14 days before the page's reference date (15 or more) leaves the page: `banana state archive --reason inactive` copies it to `STATE-archive.md` and removes it, and nothing replaces it. Its next step already lives at its pointer. v1.7 turned an idle thread into a one-line Backlog item; that costs about +1,800 chars at steady state and needs judgment to write, which rules out moving it on sight. Only the owner re-queues a moved thread as a Backlog item; a session that works the thread again re-adds its Active line at that session's close, stamped from a real source.

The limit drops from 30 to 14 days (`THREAD_INACTIVE_DAYS`). A bullet that already FAILs `thread-stale` still skips `thread-inactive` until its stamp is refreshed (decision 7 makes the gate agree).

## 2. The waiting form

A thread whose next step is someone else's is written `**name** (as of YYYY-MM-DD) — waiting on {who}: {the ask} → pointer`, at most 160 chars (`WAITING_LINE_LIMIT`, not part of the per-section limits). The marker is the exact lower-case text ` — waiting on ` directly after the stamp, then 1-40 chars without a colon, `: ` and the ask. It is case-sensitive and tested on the backtick-masked line, so `(As of …)` gets the full 400 cap.

The marker only selects the cap. Residence never depends on it, because lint cannot tell a waiting thread from a live one: a missing marker costs extra chars, never a stuck line. Every other Active-threads rule still applies, and the stamp still counts toward the reference date. When the wait ends, the session that picks the thread up rewrites it in the full form.

## 3. Backlog items carry (queued) and go dormant

Every Backlog (owned) bullet carries `(queued YYYY-MM-DD)` after the owner's ` — `: the day the item was added. Editing never changes it; only a re-queue on the owner's word writes a new date, in place of the old one. Because the oldest stamp wins, an added second stamp renews nothing. An item whose stamp is more than 21 days before the reference date (22 or more) is dormant: `backlog-dormant` WARNs and `--reason dormant` moves it, nothing replaces it. Agent-owned items go dormant too unless the owner renews them. `backlog-undated` WARNs on a line with no valid stamp.

A stamp placed before the owner's ` — ` makes the owner read as multi-word, so the line FAILs `backlog-unowned`; the stamp is still read and counts.

## 4. Watch lines carry (validate-by:) and warn when due

Every Watch bullet carries `(validate-by: YYYY-MM-DD)`, the date it is next checked; a watch that waits on an event still gets the date it will next be checked, keeping the event in its text. The colon is part of the keyword, so a colon-less `(validate-by 2026-…)` is undated. When the reference date is past it, `watch-due` WARNs; the same day passes. The owner, or a session working on what the line names, checks it and writes a new date in place of the old one. Dropping it (`--reason removed`) is the owner's call. A due Watch line is never moved on sight, and Watch has no owner field.

## 5. Flagged lines move on sight, writer pays

Any session may archive, on sight, a line that `banana state lint --global` WARNs `closed-expired`, `thread-inactive` or `backlog-dormant`, and a session about to add a line first archives every such line. The canon frames this as a filing step, not initiative under rule 5: the dates have already decided, the archive re-checks them against the real clock, and the move authors nothing. Rule 5's text is unchanged; one framing sentence is added, as v1.7 framed expired lines.

If the archive reports no match and a fresh read shows the line gone, another session moved it first, which is a normal outcome. After the archive exits 0, the mover names each moved line to the owner in its reply. There is no roll-up line on the page: the mover names moved lines in its reply, and the archive is searched with `grep`. Nothing else about another session's line is on sight.

The header grows from four to five lines (+146 chars) so that harnesses which read only the page learn the thresholds, the watch date and who moves flagged lines. Each line stays at or under 100 chars and is byte-identical in `templates/global-STATE.md` and the canon's embedded template.

## 6. near-cap at 9,000, and its escalation

`banana state lint --global` WARNs `near-cap` when the page is past 9,000 chars and not over the cap (`STATE_NEAR_CAP_CHARS`); above 10,000 only `over-cap` fires, and project pages never get it. The message tells the writer to archive every flagged line, then "write your own waiting threads in the waiting form". If it fires in two different weeks in a row, the session that sees it proposes lowering the thread limit to 10 days and the owner rules; per-section budgets are a later option, also the owner's. No session changes a limit on its own. Streaks are tracked by sessions, not by the kit.

## 7. The inactive gate refuses a stale thread

`banana state archive --reason inactive` refuses a thread whose project page is newer than its `(as of)` stamp (`bulletIsThreadStale`, the same test lint's `thread-stale` uses), telling the caller to refresh the stamp instead. Without this, a session archiving by hand without a fresh lint could move a thread whose project has moved on and record it as inactive. The gate's verdict is now decided by the matched line alone: its own stamp against the real clock and, for `inactive`, its own pointer's project page. `dormant` is gated at 21 days by the same table, with no stale check.

## 8. A mid-arc re-stamp source

At session close, right after the fresh read, a session that worked a thread may re-stamp its `(as of)` to the heading date of its own newest session-log entry for that work, in that project's `.agents/session.log`. A stamp never moves forward without a real source: the project STATE's as-of, or that session-log heading date. Project pages are rebuilt only at session close, so without a source a thread in the middle of a long arc reads idle at 15 days and can be moved on sight.

## Considered options

Rejected, each with its reason.

- **A fifth section.** If required, every unmigrated page FAILs `missing-section` and about 59 fixture headings change; if optional, `state archive` cannot reach it and its stamps leave the reference date.
- **A kit-written names-only roll-up line.** It extends the kit's one-line write scope, and the 300-char cap fills after about 12-15 names, so it would need its own aging rule. A hand-written sweep line per session in Recently closed: its `(closed)` stamp moves the reference date, and unfinished items sit in Recently closed. One append-only dormant line per agent tag: concurrent sessions with the same tag fight over it.
- **Residence that depends on the marker.** Lint cannot enforce the marker, so a missing marker would keep a thread on the page (projected 9,600-10,050).
- **A 7-day thread limit.** A mid-arc thread reads 8+ days idle, because project pages are rebuilt only at session close. 10 days: about -600 chars, more risk for mid-arc threads (kept as the near-cap escalation lever). 21 days: about +1,000 chars, a thin margin. 30 days (keep): about 9,900 chars even with full waiting-form use.
- **A 14-day Backlog limit.** About -340 chars, but owner items vanish after two weeks, which invites renewals. 30 days: about +440 chars; stress cases pass 85% of the cap.
- **A stamp any edit renews ("date last changed").** Any edit restarts the clock, so Backlog has no limit again. An agent renewing its own item with a changed action: a keep-alive leak nothing can detect.
- **Waiting form for owner-review waits only.** Threads waiting on outside parties stay full length, about +150-300 chars. A 150 cap: about -60 chars, one more trim at migration. No waiting form: about 10,300, over the cap, unless the thread limit drops to 10.
- **On-sight Watch removal through a gated reason.** Any session could archive an unchecked standing guard (a "must stay off" setting) days after an artificial date. Only the owner acts on a due Watch line: due lines pile up in briefs between owner reviews. An owner prefix on Watch lines: a new owner-check class plus churn on every live Watch line. Deferring Watch: lines that name an event instead of a date never leave.
- **On sight for expired and dormant only.** Idle threads wait for owner-ordered cleanups (Active about +1,000, page near 8,500-9,000). Expired only (keep): the measured failure, a refill in 7 days. Amending rule 5's own text: the same behavior, one more canon change, and the rules preamble would have to list v1.8.
- **v1.7's Backlog demotion of idle threads.** About +1,800 chars at steady state, and writing the line needs judgment, which rules out on-sight moves. A standing owner-written Backlog line for every moved thread: not adopted as a rule; the owner may already re-queue any moved thread.
- **Backlog or Watch stamps in the reference date.** A far-future item stamp would age every other line (settled in ADR 0006). A cap raise (rejected in ADR 0006).
- **near-cap at 8,500.** It fires near the high end of normal swings. near-cap with no escalation: a page sitting near the cap for weeks has no agreed next step. No near-cap: the FAIL lands on whoever writes last.
- **No stale check in the gate.** A session archiving by hand without a fresh lint can move a thread whose project has moved on, recorded as inactive.
- **No new re-stamp source.** A mid-arc thread reads idle at 15 days and can be moved on sight. Today's date at close: unverifiable, so any session could keep any thread alive forever.
- **A header with numbers and stamps but no duty line.** Harnesses that read only the page never learn who moves flagged lines. An unchanged header: it keeps teaching "31+ days, move to Backlog".

## Consequences

- Amends ADR 0006's 30-day inactivity limit (now 14), its on-sight scope (now the three date-flagged reasons, not only expired lines), its two-step inactive remedy (archive, then add a one-line Backlog item: now archive only, nothing replaces the thread) and its D3 verdict sentence (the inactive verdict now also reads the thread's own pointer). ADR 0006 carries a one-line Amended-by pointer here; its text stays as written and its pins stay green.
- ADR 0006's "Watch and Backlog never carry this stamp convention" no longer holds literally: both sections carry stamps now. Those stamps still never feed the reference date or the future-stamp note.
- `ARCHIVE_REASONS` gains `dormant`; the clock gates become a table (`expired` 7, `inactive` 14 with the stale refusal, `dormant` 21).
- Every existing Backlog and Watch line WARNs `backlog-undated` or `watch-undated` until it gets its stamp. The migration of a live page is separate from this change.

## Known limits

- The waiting form is a convention: lint cannot tell a waiting thread from a live one; a missing marker costs about 230 extra chars for the thread's 15 days; `(As of …)` gets 400 because the marker is case-sensitive while stamps are not.
- On-sight moves drop an unreviewed ask after 15 idle days; it lives on at its pointer and in the archive.
- A finished, never-closed thread leaves as `inactive`, never `closed`, so it gets no Recently-closed line.
- When nobody stamps, nothing ages; then the WARNs land at once.
- A far-future `queued`/`validate-by:` date keeps a line forever; nothing limits how far ahead a date can be.
- Unsourced re-stamps and unchecked re-dates are undetectable.
- The stale gate reads the pointer target at archive time; a page edited between lint and archive can change the verdict (lint has the same gap).
- Two sessions with different tags that archive the same line at the same moment can each append a record; the archive then holds one line twice, and nothing is lost.
- Watch has no owner field; "a session working on what the line names" is a convention.
- The Backlog placeholder shows no stamp, so a fresh page's first Backlog line WARNs `backlog-undated` until its writer adds a `(queued …)` stamp.
- Installed pages keep the v1.7 header until hand-edited.
- near-cap streaks are tracked by sessions, not by the kit.
- A mid-arc session that skipped the re-stamp can see its thread moved on sight after 15 days; it re-adds the thread at close, which costs one extra archive record.
