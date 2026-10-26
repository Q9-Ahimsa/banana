# STATE — banana
> Projection of LOGBOOK.md as of 2026-10-26 (through kit.21). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- 0.7.1 released and live (pushed, synced): CONTINUITY v1.9 — a delivered thread on whose answer nothing
  waits closes with a Recently-closed line; the waiting form no longer covers optional reviews — kit.21.
- 0.7.0 released and live (pushed, synced on the owner machine): session log rotated; wiring templates at
  fence v4 (#24, #25); doctor's init remedy for a home block with no owner/tag line (#26); sync's exit-1
  contract and project's LOGBOOK.md deferral (owner rulings) — kit.19. Frontier: the owner picks the next
  batch from #27 (hermes delivery), #28 (compact-prep hook, design first), #29 (edge cases) and #30
  (doctor silent on a detected harness with no block; owner: essential, Pi stays unwired for now) — kit.20.

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
- Wiring templates at fence v4: the roster names `state archive`; each says what refreshes it (`sync` for
  home files, `banana project` for a workspace AGENTS.md, re-run init for the paste block); a fence bump
  needs `banana project` in each workspace — kit.19
- Install once; `sync` runs the install, then refreshes from the newer of launched and installed trees — kit.11
- sync finishes every file it can, then exits 1 when any canon or home wiring file could not be read or
  written; deliberate skips (no owner/tag line, malformed markers) keep exit 0; "canon and fences current"
  prints only when nothing changed and nothing was skipped (owner ruling) — kit.19
- project keeps a recorded `DECISION: … defer LOGBOOK.md` (canon CONTINUITY step 2) and reads the log only
  while LOGBOOK.md is missing; a log it cannot read leaves LOGBOOK.md alone, the rest is done, exit 1
  (owner ruling) — kit.19
- doctor's origin check compares `package.json` versions, so every behavior-changing release bumps it — kit.11
- After a real fetch, exit via `process.exitCode`, never `process.exit()` (Windows aborts) — kit.11
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- SUPERSEDES is id-keyed: one line retires every entry under `{feature}.{n}`; `supersede --all` says so,
  `--target-agent` only picks what the new entry copies and WARNs; no date selector (owner ruling) — kit.18
- A line-ending-only difference is never a change for sync or a kit-owned file; a write keeps the target's
  style (LF when new); a fence takes its host's style, judged outside the fence — kit.18
- doctor's stale-fence remedy: `banana sync` for a home harness file, `banana init --harnesses <id>` for a
  home block with no owner/tag line (sync skips it, never invents one), `banana project` for a project's
  AGENTS.md; one file reached two ways (case, junction, symlink) is audited once, as home — kit.18, kit.19
- The README command table is checked against lib/commands.mjs `COMMANDS`, the CLI's own list — kit.18
- The session log rotates past 700 lines into `.agents/sessions/{YYYY}-{Qn}.log` (SESSION-LOG section 8);
  the brief reads only the active log — kit.19
- Review rounds judge this batch's lines, plus any remedy that fails as printed; older defects go to one
  follow-up issue; stop after two clean rounds in a row (owner ruling) — kit.19
- Public repo: fixtures, docs, specs and this repo's own records carry no real project/person names,
  usernames or local paths; test/deny-list.test.mjs scans bin/, lib/, adapters/, test/ — kit.3, kit.13, kit.18
- The CLI deploys on push (npx serves origin/main); canon reaches installed sites only via `sync` — kit.6, kit.9

## Next
- ahimsa — pick the next batch: #27 hermes `--deliver`, #28 compact-prep hook (design questions in the
  issue and its comment), #29 six pre-existing fence and doctor edge cases, #30 unwired detected
  harnesses (essential) — kit.19, kit.20
- claude — other projects' banana blocks lift to v4 via `banana project` in each project's next session
  (global-page backlog line) — kit.19

## Blocked
- (none)

## Watch
- The waiting form is a convention lint cannot enforce; with no use the owner page settles near 10,300
  chars, over the cap. near-cap is the signal; escalation is the owner's (validate-by: 2026-11-12, a
  month of v1.8 on the owner page)
- 5 of 9 installed project pages FAIL state lint on their own content — each project's sessions fix them,
  never a looser lint (validate-by: rest of #11)
- `sync` from cmd runs `banana.cmd`, which npm rewrites mid-run; the PowerShell path and the Git Bash shim
  (the 0.7.0 update) have run cleanly (validate-by: the first `banana sync` from cmd)
- sync's exit 1 on a file it cannot read or write is new in 0.7.0: a script that runs sync must expect it
  (validate-by: the first scripted sync)
- The compact-prep checkpoint lands in the log above the session's current folder: a worktree's own copy,
  or nowhere from a scratch folder; keep the shell in the main checkout until #28 decides (validate-by: #28)
- The archive's symlinked-page test skips on Windows without developer mode; it runs only where symlinks
  can be created (validate-by: the first run on a POSIX machine or with developer mode on)
- ADR 0006 and ADR 0007 "Known limits" list the accepted edge cases (validate-by: any real hit on the
  owner machine)
- #19's CRLF path has run only in tests and a sandboxed walk: every installed canon and harness file on the
  owner machine is LF (validate-by: the first sync where an installed file is CRLF)
- The dotfiles-link doctor test's audit half runs only where file symlinks can be created; here it takes
  the junction fallback (validate-by: the first POSIX or developer-mode run)

## Dead ends
- Exact-line section matching — real pages qualify headings; now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — silenced staleness; now header-only + validated — kit.3
- Whole-page rebuilds of the global page — lost a concurrent session's update; per-thread edits — kit.7
- Idle threads demoted to a Backlog line (v1.7) — moved the pile into a section with no outflow; v1.8
  archives them whole — kit.15
- A `--target-date` selector for duplicate ids — an id-keyed SUPERSEDES line cannot retire just one
  entry; dropped by owner ruling — kit.18
- Same-file check by path spelling (`resolve()`) — Windows letter case and junctions defeated it; now
  the on-disk path (`realpathSync.native`) — kit.18
- Judging every old defect on a path the batch sends users down — review rounds kept resetting on bugs
  the batch did not write; now only this batch's lines or a failing remedy count (owner ruling) — kit.19
- An unguarded read added to a command that writes several files (project's deferral check) — one throw
  stopped the block refresh; read only when the answer matters, catch, finish the rest — kit.19
