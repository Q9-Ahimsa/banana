# STATE — banana
> Projection of LOGBOOK.md as of 2026-10-01 (through kit.12). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- 0.3.0 released and live (pushed, served by npx, installed globally on the owner machine): #6 (local
  install, `sync` as the updater, doctor's origin check), #8 (brief v2), #10 (wiring v3), #17. #11 done
  on this machine: home blocks at v3, this repo's block at v3, the SessionStart hook runs the installed
  kit. Frontier: #19 (sync line endings, doctor remedy text), then #18.

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon, owner-ratified 2026-09-29: SESSION-LOG v2.3; CONTINUITY v1.6 (v1.4 ghosts, v1.5 freshness
  stamps, v1.6 per-thread global edits); STANDARD + CONTINUITY v1.3 rebuild-on-close — kit.7.
  Deployed to the installed `~/.agents/canon/` via `sync` 2026-09-29 — kit.9
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- retired-header reads the header only (above the first `##`, the date boundary) and matches the rule's
  sentence shape ("rebuilt … never patched" in one sentence, across a wrap), not one literal — kit.10
- Lint wiring: `brief` = the guarantee (every session start), `log close` = the early catch; advice, never a gate — kit.5
- Global page: edit only your own threads, never rewrite it; stamps + lint replace whole rebuilds (ADR 0005) — kit.7
- Fence identity (tag/owner) survives `project` / `init` / `sync` rewrites: flag > existing fence > inference — kit.8
- Install once (`npm install -g github:Q9-Ahimsa/banana`); `sync` runs that install, then refreshes from the
  newer of the launched and installed trees (kit-shaped only; never a silent downgrade) — kit.11
- doctor's origin check compares `package.json` versions, so every behavior-changing release bumps it — kit.11
- The brief: the target feature's last close + open entries in full, older closes as headings; handoffs
  are live only (latest entry per other stream; every full-shown entry of the target) — kit.11
- Supersession retires an entry from ghost and unowned-NEXT audits; it hides a brief body only when the
  superseder is in the same stream — kit.11
- After a real fetch, exit via `process.exitCode`, never `process.exit()` (Windows aborts, 0xC0000409) — kit.11
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- Public repo: fixtures and docs carry no real project/person names or local paths — kit.3
- The CLI deploys on push (npx serves origin/main); canon reaches installed sites only via `sync` — kit.6, kit.9

## Next
- claude — #19: sync ignores CRLF-only differences; doctor names `banana project` for project fences — kit.12
- claude — #18: `supersede` targeting duplicate same-agent ids (7 stale us-00N NEXTs wait on it)
- claude — other projects' banana blocks (still v2) lift to v3 via `banana project` in each project's next
  session (global-page backlog line)

## Blocked
- (none)

## Watch
- 5 of 9 installed project pages FAIL state lint on their own content (3 unowned Next, 2 missing
  section, 1 over cap) — each project's sessions fix them, never a looser lint (validate-by: rest of #11)
- 4 migrated installed pages are uncommitted (2 repos had other local STATE edits; 2 keep STATE
  untracked); a rebuild from an older draft could restore the old header — lint WARNs if it does
  (validate-by: rest of #11)
- `sync` from cmd/Git Bash runs `banana.cmd`, which npm rewrites mid-run; only the PowerShell path
  (`banana.ps1`) has been exercised for real (validate-by: the first `banana sync` from cmd or Git Bash)

## Dead ends
- Exact-line section matching — real pages qualify headings (`## Watch (…)`); now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — a body sentence or impossible date silenced staleness; now header-only + validated — kit.3
- Whole-page rebuilds of the global page — lost a concurrent session's update; replaced by per-thread edits (ADR 0005) — kit.7
- Literal-phrase retired-header detection — a second real wording passed silently; widening it then flagged
  body text that only describes the rule; now sentence-shape, header-only — kit.10 (cli.14, cli.15)
- Reading canon from the launched tree after `npm install -g` — the install writes elsewhere; now the
  installed tree, kit-shaped and newest-wins — kit.11
