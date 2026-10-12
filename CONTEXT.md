# CONTEXT.md — banana

> Build-process glossary for developing banana. Banana's own *protocol* vocabulary is
> defined by the canon (`canon/*.md`) — on any conflict, canon wins. Terms land here
> the moment a design session resolves them.

## Terms

- **Kit** — the installable distribution of banana: CLI, canon, templates. Distinct
  from the canon it carries; the kit is a vehicle, the canon is the authority.
- **Rebuild-on-close** — the STATE maintenance discipline: surgical section patches
  are allowed mid-arc; one mandatory full rebuild happens at session close. Replaces
  the older "rebuilt whole, never patched" rule.
- **Dirty marker** — the visible line a patched STATE carries until its next full
  rebuild. Announces to any reader that the log is the authority right now. A crashed
  session leaves it standing, so a skipped close is self-announcing.
- **Brief** — the computed session-start digest for one feature in one project.
  Fast path, never a gate: raw file reads remain legal, and machine-grain global
  state is deliberately excluded.
- **Supersede** — correcting the record by writing a *new* entry that names the entry
  it replaces and why. The record is never edited; a correction is content, added.
- **Shim** — the once-installed local copy of the kit that makes `banana` instant and
  offline-safe. It never updates itself; **sync** is the explicit updater, and drift
  between machines is surfaced (version in every brief, doctor's best-effort remote
  check), never silently prevented.
- **Continuation entry** — the canon §3 answer to a heading landing below your open entry:
  a new entry (same feature, next `n`, copied phase/title) whose first body line
  `SUPERSEDES:` the one left open above. Born open for checkpoints, born closed for closes.
  Distinct from a correction supersede: it continues the same work rather than fixing the
  record. `banana log` writes it automatically (ADR 0003).
- **Freshness stamp** — the `(as of YYYY-MM-DD)` every global-STATE `## Active threads`
  bullet carries (canon CONTINUITY v1.5): the date of the newest source the bullet was
  rebuilt from, normally its project STATE's own as-of. A project STATE dated later than the
  stamp means the thread is stale; `banana state lint --global` FAILs it as `thread-stale`
  (#13).
- **Per-thread edit** — the global-STATE maintenance discipline replacing whole-page
  rebuilds (canon CONTINUITY v1.6, ADR 0005): a session closes by editing only the
  Active-threads bullets and Backlog items it owns or changed, right after a fresh read,
  re-stamping each touched thread's `(as of)` from its own source, never rewriting the whole
  page. Drift is caught, not prevented: the freshness stamp and `banana state lint --global`
  (`thread-stale`, and now `retired-header` for a page still carrying the old rule) are the
  backstop (#15). Exception (canon v1.8, ADR 0007, widening v1.7's): any session may
  archive, on sight, a line lint WARNs `closed-expired`, `thread-inactive` or
  `backlog-dormant`, and a session about to add a line archives every such line first — a
  filing step that authors nothing.
- **Reference date** — the newest real calendar date among a global-STATE page's own
  `(as of YYYY-MM-DD)` and `(closed YYYY-MM-DD)` stamps (canon CONTINUITY v1.7, ADR 0006):
  never the clock, since `lib/state.mjs` stays clock-free (ADR 0004), and never just the
  first stamp found, since per-thread edits land bullets out of date order. `closed-expired`,
  `thread-inactive`, `backlog-dormant` and `watch-due` compare stamps against it; Backlog
  `(queued …)` and Watch `(validate-by: …)` stamps never feed it; with no valid stamp
  anywhere, those checks are skipped.
- **Waiting form** — an Active-threads bullet written `**name** (as of YYYY-MM-DD) — waiting
  on {who}: {the ask} → pointer` (canon v1.8, ADR 0007): the exact marker ` — waiting on `
  right after the stamp selects a 160-char cap instead of 400. It changes only the cap;
  residence and every other thread rule stay the same, and lint cannot tell whether a thread
  should use it.
- **Queued stamp / dormant** — the `(queued YYYY-MM-DD)` every Backlog (owned) bullet carries
  after the owner's ` — `: the day the item was added, replaced only by a re-queue on the
  owner's word. More than 21 days before the reference date the item is dormant:
  `backlog-dormant` WARNs, and `banana state archive --reason dormant` moves it off the page.
- **Watch date / due** — the `(validate-by: YYYY-MM-DD)` every Watch bullet carries: the date
  it is next checked. Once the reference date is past it, `watch-due` WARNs; the owner, or a
  session working on what it names, writes a new date in place of the old one; dropping it is
  the owner's call; it is never moved on sight.
- **Near-cap** — `banana state lint --global`'s WARN past 9,000 of the 10,000 chars: archive
  the flagged lines, then write your own waiting threads in the waiting form; two weeks in a
  row → the session proposes a 10-day thread limit and the owner rules.
- **Archive move** — removing a line from the global-STATE page is never a plain delete
  (canon CONTINUITY v1.7, ADR 0006): the line's full text is copied verbatim into the
  append-only `~/.agents/STATE-archive.md` first, via `banana state archive --reason
  <expired|inactive|dormant|trimmed|closed|removed>`, then removed from the page — or, for
  `trimmed`, copied only, with the live line shortened in place by hand. If that removal
  leaves a section with no bullet at all, the command writes back that section's own
  placeholder line — not a second removal, just the placeholder taking the real bullet's
  place again. A pasted secret is the one exception: deleted outright, never archived. The
  archive is never loaded at session start, searched with `grep` only.
