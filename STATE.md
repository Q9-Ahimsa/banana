# STATE — banana
> Projection of LOGBOOK.md as of 2026-10-03 (through kit.14). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- 0.4.0 released and live (pushed, served by npx, installed and synced on the owner machine): #20 global
  page — line limits, closed expiry, thread inactivity, and `banana state archive` (removal = a move into
  the append-only STATE-archive.md); canon CONTINUITY v1.7 (ratified) + ADR 0006. Frontier: #19, then #18.

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon, owner-ratified 2026-09-29: SESSION-LOG v2.3; CONTINUITY v1.6 (v1.4 ghosts, v1.5 freshness
  stamps, v1.6 per-thread global edits); STANDARD + CONTINUITY v1.3 rebuild-on-close — kit.7.
  CONTINUITY v1.7 (#20 global-page limits, expiry, inactivity, archive move) ratified 2026-10-03 and
  deployed via `sync` — kit.13, kit.14
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- The lint never reads the clock: global date checks measure from the page's newest stamp; the archive
  command is the clock-aware gate for expired/inactive moves (ADR 0006) — kit.13
- Global page: one physical line per bullet; limits thread 400 · backlog 300 · watch 350 · closed 250;
  closed lines carry `(closed YYYY-MM-DD)`; a line leaves only via `state archive` (copy before
  delete; a pasted secret is deleted outright) — kit.13
- retired-header reads the header only (above the first `##`) and matches the rule's sentence shape — kit.10
- Lint wiring: `brief` = the guarantee, `log close` = the early catch; advice, never a gate; a WARN-only
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
- claude — delete the merged #20 lane worktrees, their branches and filter-branch's refs/original
  (list them first; owner approves) — kit.14
- claude — #19 (sync line endings, doctor remedy text), then #18 (supersede duplicate ids) — kit.12
- claude — other projects' banana blocks (still v2) lift to v3 via `banana project` in each project's next
  session (global-page backlog line)

## Blocked
- (none)

## Watch
- 5 of 9 installed project pages FAIL state lint on their own content — each project's sessions fix them,
  never a looser lint (validate-by: rest of #11)
- `sync` from cmd/Git Bash runs `banana.cmd`, which npm rewrites mid-run; only the PowerShell path has been
  exercised (validate-by: the first `banana sync` from cmd or Git Bash)
- The archive's symlinked-page test skips on Windows without developer mode; it runs only where symlinks
  can be created (validate-by: the first run on a POSIX machine or with developer mode on)
- ADR 0006 "Known limits" lists the accepted edge cases (validate-by: any real hit on the owner machine)

## Dead ends
- Exact-line section matching — real pages qualify headings; now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — silenced staleness; now header-only + validated — kit.3
- Whole-page rebuilds of the global page — lost a concurrent session's update; per-thread edits — kit.7
- Literal-phrase retired-header detection — missed real wordings; now sentence-shape, header-only — kit.10
- Reading canon from the launched tree after `npm install -g` — the install writes elsewhere — kit.11
- An archive that moves arbitrary markdown extents (wrapped bullets, sub-headings, comments, fences) —
  ~15 ways to misjudge where a bullet ends; now one physical line per bullet — kit.13
