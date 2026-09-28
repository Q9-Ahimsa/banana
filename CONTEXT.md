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
