# STATE — banana
> Projection of LOGBOOK.md as of 2026-09-28 (through kit.4). Logbook wins
> on conflict. One page, hard cap. Rebuilt at session close; mid-arc
> section patches are legal and must carry the dirty-marker line.

## Now
- /implement flow over spec #3's ticket chain: #4 #5 #7 #9 #13 shipped on local `main`
  (everything since #4 unpushed — `npx` still serves the old kit). `banana state lint
  [--global]` runs here via the local bin. Frontier: #8 (brief v2).

## Truths
- banana = protocol + mechanical CLI; markdown canonical, no datastore (spec #3) — kit.1
- Canon in repo: SESSION-LOG v2.3, CONTINUITY v1.5 (v1.4 ghosts + v1.5 freshness stamp), STANDARD +
  CONTINUITY v1.3 rebuild-on-close — kit.2, kit.4. Installed `~/.agents/canon/` is still rev 1.2
- state lint: FAIL exit 1 · WARN exit 0 · usage/unreadable exit 2; 10000-char cap; stale vs LOGBOOK
  = FAIL, vs session.log = WARN; dates header-only + calendar-validated (ADR 0004) — kit.4
- Envelope grammar single-sourced in lib/sessionlog.mjs; log.mjs composes, sessionlog parses (#4, #7)
- Public repo: fixtures and docs carry no real project/person names or local paths — kit.3
- Deployment to installed sites is gated at #11 (rollout sweep); nothing deployed yet
- Local main runs ahead of origin by design — commits land locally, push is a separate call

## Next
- ahimsa — review canon SESSION-LOG v2.3 + CONTINUITY v1.4 + v1.5 and ADR 0004's calls (gate before #11)
- ahimsa — decide the push (all local commits since #4); note `.agents/session.log` cli.9 names real
  projects in its checkpoints, as earlier entries do
- testagent — /implement #8 (brief v2), then #6 #10 #11 per cli.5 order
- testagent — hygiene: supersede the 10 July ghost entries + 2 hyphen-dash NEXTs `doctor` flags here

## Blocked
- (none)

## Watch
- 5 of 9 real project pages FAIL state lint today (over cap, missing `## Blocked`, unowned Next) —
  at #11 they must be fixed per project, never by loosening the lint (validate-by: #11 rollout)

## Dead ends
- Exact-line section matching — real pages qualify headings (`## Watch (…)`); now qualifier-tolerant — kit.3
- Page-wide, shape-only date matching — a body sentence or impossible date silenced staleness; now header-only + validated — kit.3
