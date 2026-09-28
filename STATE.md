# STATE — banana
> Projection of LOGBOOK.md as of 2026-09-29 (through kit.6). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- /implement flow over spec #3's ticket chain: #4 #5 #7 #9 #13 #14 shipped and PUSHED 2026-09-29 —
  every `npx github:Q9-Ahimsa/banana` session now gets `log`, `state lint [--global]`, and lint in
  `brief` / `log close`. Frontier: #8 (brief v2).

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon in repo: SESSION-LOG v2.3, CONTINUITY v1.5 (v1.4 ghosts + v1.5 freshness stamp), STANDARD +
  CONTINUITY v1.3 rebuild-on-close — kit.2, kit.4. Installed `~/.agents/canon/` is still rev 1.2
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- Lint wiring: `brief` = the guarantee (every session start), `log close` = the early catch; advice, never a gate — kit.5
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- Public repo: fixtures and docs carry no real project/person names or local paths — kit.3
- The CLI deploys on push (npx serves origin/main); canon deploys to installed sites only via `sync`, gated at #11 — kit.6
- Local main may run ahead of origin — commits land locally, push is a separate call

## Next
- ahimsa — review canon SESSION-LOG v2.3 + CONTINUITY v1.4 + v1.5 and ADR 0004's calls (gate before #11) — the CLI already behaves per them since the push
- ahimsa — decide coverage for sessions started outside a workspace (`brief` refuses there) — kit.5
- testagent — /implement #8 (brief v2), then #6 #10 #11 per cli.5 order
- testagent — hygiene: supersede the 10 July ghost entries + 2 hyphen-dash NEXTs `doctor` flags here

## Blocked
- (none)

## Watch
- 5 of 9 real project pages FAIL state lint today (over cap, missing `## Blocked`, unowned Next) —
  at #11 they must be fixed per project, never by loosening the lint (validate-by: #11 rollout)
- Whole-file rebuilds of the global page lose concurrent updates: on 2026-09-28 a rebuild from this
  repo's session dropped a thread another session had just added (recovered by that session). Its
  guard compared one bullet, not the file. Needs a canon answer — compare-and-swap on the full file
  hash, or per-thread edits instead of whole rebuilds (validate-by: the canon review above)

## Dead ends
- Exact-line section matching — real pages qualify headings (`## Watch (…)`); now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — a body sentence or impossible date silenced staleness; now header-only + validated — kit.3
