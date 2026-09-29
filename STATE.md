# STATE — banana
> Projection of LOGBOOK.md as of 2026-09-29 (through kit.9). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- /implement flow over spec #3's ticket chain: #4 #5 #7 #9 #13 #14 #15 #16 shipped and pushed —
  `npx github:Q9-Ahimsa/banana` serves `log`, `state lint [--global]` (inside `brief` / `log close`),
  per-thread global edits, and fence-identity preservation. Frontier: #8 (brief v2).

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon, owner-ratified 2026-09-29: SESSION-LOG v2.3; CONTINUITY v1.6 (v1.4 ghosts, v1.5 freshness
  stamps, v1.6 per-thread global edits); STANDARD + CONTINUITY v1.3 rebuild-on-close — kit.7.
  Deployed to the installed `~/.agents/canon/` via `sync` 2026-09-29 — kit.9
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- Lint wiring: `brief` = the guarantee (every session start), `log close` = the early catch; advice, never a gate — kit.5
- Global page: edit only your own threads, never rewrite it; stamps + lint replace whole rebuilds (ADR 0005) — kit.7
- Fence identity (tag/owner) survives `project` / `init` / `sync` rewrites: flag > existing fence > inference — kit.8
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- Public repo: fixtures and docs carry no real project/person names or local paths — kit.3
- The CLI deploys on push (npx serves origin/main); canon deploys to installed sites only via `sync`, gated at #11 — kit.6

## Next
- claude — #11 rollout: migrate the 6 project STATE headers still carrying the retired rule (`retired-header` WARN) — kit.9
- claude — /implement #8 (brief v2), then #6 #10 per cli.5 order
- claude — hygiene: supersede the 11 July ghost entries + 2 hyphen-dash NEXTs `doctor` flags here

## Blocked
- (none)

## Watch
- 5 of 9 real project pages FAIL state lint today (over cap, missing `## Blocked`, unowned Next) —
  at #11 they must be fixed per project, never by loosening the lint (validate-by: #11 rollout)
- The owner-machine SessionStart hook that lints the global page has only been pipe-tested, not seen
  firing in a live session (validate-by: the next Claude session start shows the lint in context)

## Dead ends
- Exact-line section matching — real pages qualify headings (`## Watch (…)`); now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — a body sentence or impossible date silenced staleness; now header-only + validated — kit.3
- Whole-page rebuilds of the global page — lost a concurrent session's update; replaced by per-thread edits (ADR 0005) — kit.7
