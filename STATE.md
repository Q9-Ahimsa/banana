# STATE — banana
> Projection of LOGBOOK.md as of 2026-10-12 (through kit.17). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- 0.5.0 released and live (pushed, served by npx, installed and synced on the owner machine): #21 global
  page v1.8 — threads leave at 15+ idle days, backlog lines go dormant 22+ days after `(queued …)`,
  watch lines carry `(validate-by: …)` and WARN when due, waiting form, near-cap WARN, writer pays;
  canon CONTINUITY v1.8 (ratified) + ADR 0007. The owner page is migrated to v1.8 (global lint PASS,
  7,506 chars) — kit.16. Frontier: #19, then #18, then #22 and #23 (filed, kit.17).

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon, owner-ratified 2026-09-29: SESSION-LOG v2.3; CONTINUITY v1.6 (v1.4 ghosts, v1.5 freshness
  stamps, v1.6 per-thread global edits); STANDARD + CONTINUITY v1.3 rebuild-on-close — kit.7.
  CONTINUITY v1.7 (#20 limits, expiry, inactivity, archive move) ratified 2026-10-03 — kit.14.
  CONTINUITY v1.8 (#21 outflow by date for every section) ratified 2026-10-12 and synced — kit.15
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- The lint never reads the clock: global date checks measure from the page's newest Active/closed stamp
  (`queued`/`validate-by:` stamps never feed it); the archive command is the clock-aware gate for
  expired (7) / inactive (14, refuses a stale thread) / dormant (21) moves (ADR 0006, ADR 0007) — kit.15
- Global page: one physical line per bullet; limits thread 400 (waiting form 160) · backlog 300 ·
  watch 350 · closed 250; stamps `(as of …)`, `(queued …)`, `(validate-by: …)`, `(closed …)`, oldest
  wins, a renewal replaces the stamp; a line leaves only via `state archive` (copy before delete; a
  pasted secret is deleted outright) — kit.13, kit.15
- Writer pays: before adding a line, any session archives the lines lint flags to leave
  (closed-expired, thread-inactive, backlog-dormant); a due Watch line is never moved on sight; only
  the owner re-queues or renews — kit.15
- retired-header reads the header only (above the first `##`) and matches the rule's sentence shape — kit.10
- Lint wiring: `brief` = the guarantee, `log close` = the early catch; never a gate; a WARN-only
  global verdict prints as one summary line there — kit.5, kit.13
- Global page: edit only your own threads, never rewrite it (ADR 0005); the one kit write is
  `state archive` removing exactly the named line — kit.7, kit.13
- Fence identity (tag/owner) survives `project` / `init` / `sync` rewrites: flag > existing fence > inference — kit.8
- Install once; `sync` runs the install, then refreshes from the newer of launched and installed trees — kit.11
- doctor's origin check compares `package.json` versions, so every behavior-changing release bumps it — kit.11
- After a real fetch, exit via `process.exitCode`, never `process.exit()` (Windows aborts) — kit.11
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- Public repo: fixtures, docs, specs and this repo's own records carry no real project/person names,
  usernames or local paths — kit.3, kit.13
- The CLI deploys on push (npx serves origin/main); canon reaches installed sites only via `sync` — kit.6, kit.9

## Next
- claude — #19 (sync line endings, doctor remedy text), then #18 (supersede duplicate ids) — kit.12
- claude — then #22 (README command table) and #23 (owner handle in fixtures and help; deny-list scope);
  owner may reorder — kit.17
- claude — other projects' banana blocks (still v2) lift to v3 via `banana project` in each project's next
  session (global-page backlog line)

## Blocked
- (none)

## Watch
- The waiting form is a convention lint cannot enforce; with no use the owner page settles near 10,300
  chars, over the cap. near-cap is the signal; escalation is the owner's (validate-by: 2026-11-12, a
  month of v1.8 on the owner page)
- 5 of 9 installed project pages FAIL state lint on their own content — each project's sessions fix them,
  never a looser lint (validate-by: rest of #11)
- `sync` from cmd/Git Bash runs `banana.cmd`, which npm rewrites mid-run; only the PowerShell path has been
  exercised (validate-by: the first `banana sync` from cmd or Git Bash)
- The archive's symlinked-page test skips on Windows without developer mode; it runs only where symlinks
  can be created (validate-by: the first run on a POSIX machine or with developer mode on)
- ADR 0006 and ADR 0007 "Known limits" list the accepted edge cases (validate-by: any real hit on the
  owner machine)

## Dead ends
- Exact-line section matching — real pages qualify headings; now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — silenced staleness; now header-only + validated — kit.3
- Whole-page rebuilds of the global page — lost a concurrent session's update; per-thread edits — kit.7
- Idle threads demoted to a Backlog line (v1.7) — moved the pile into a section with no outflow; v1.8
  archives them whole — kit.15
