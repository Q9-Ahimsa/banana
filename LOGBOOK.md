# LOGBOOK — banana
> Append-only chronology per the Logbook Standard v1 (shipped with this kit as
> `STANDARD.md`). Never edit or delete an entry — corrections are new entries
> carrying `SUPERSEDES:`. STATE.md is the projection; the logbook wins on
> conflict.

**Envelope:** `## [YYYY-MM-DD] {actor} {stream}.{n} | {TYPE} — {title}` +
prefix lines, body ≤ ~10 lines, pointers not payloads.

**TYPE vocabulary** (declared here; extend deliberately, in this block):
SESSION · DECISION · MILESTONE · PROBLEM · FIX · INSIGHT · RESEARCH · HANDOFF · CAPTURE

**Prefixes:** `WHAT:` / `WHY:` / `ref:` / `DONE:` / `NEXT:` / `BLOCKED:` /
`ASSUMED:` / `SUPERSEDES:`

**Read protocol:** the session entry ritual in `~/.agents/canon/CONTINUITY.md`
(via the kit's `brief` or its direct reads) — this line is a pointer, not the
ritual. Quick refs: STATE.md first, `grep "^## \[" LOGBOOK.md | tail -5`;
grep for specifics, never read the whole file.

---

## [2026-08-12] testagent kit.1 | SESSION — tickets #5 + #7 shipped: rebuild-on-close canon + banana log command
WHAT: canon rebuild-on-close amendment (#5) and `banana log` stub/append/close/supersede with auto-continuation (#7, ADR 0003)
DONE: 315/315 green; supersession-aware ghosts + archive-aware `.n` shipped as in-ticket prerequisites; this logbook + STATE initialized via `banana project` (promotion notice from the new tool itself)
ref: .agents/session.log cli.7, cli.8; GitHub #5, #7; docs/adr/0003-log-auto-continuation.md
NEXT: testagent — /implement #8 (brief v2), then #9 #6 #10 #11 per cli.5 order

## [2026-08-12] testagent kit.2 | DECISION — canon amended: continuation shape pinned (SESSION-LOG v2.3) + supersession-aware ghosts (CONTINUITY v1.4)
WHY: `banana log` auto-writes continuation entries; canon was silent on their shape, and without the ghost carve-out every continuation manufactures a permanent false ghost from its predecessor
ASSUMED: unilateral-but-disclosed — ahimsa review pending before any rollout to installed sites (#11 is the gate)
ref: canon/SESSION-LOG.md §3, canon/CONTINUITY.md Ghosts, docs/adr/0003, .agents/session.log cli.8
NEXT: ahimsa — review both amendments; adjust or ratify before #11

## [2026-09-28] testagent kit.3 | SESSION — tickets #9 + #13 shipped: `banana state lint [--global]`, review-hardened
WHAT: PASS/WARN/FAIL over mechanical STATE invariants (#9); global-page freshness stamps checked against project pages (#13); 15 wrong-verdict inputs from an adversarial review closed (3526aed, bec16a1, 59ee912 — local, unpushed)
DONE: 315 → 451 green; triggered by the global page found 4/8 threads stale under a 9-day-old save; controls: rebuilt page WARN ×1, pre-rebuild page FAIL, fresh `project`/`init` pages PASS; 5 of 9 real project pages FAIL today
ref: .agents/session.log cli.9; GitHub #9, #13; .agents/specs/cli-9-13-state-lint.md; docs/adr/0004-state-lint-verdict-tiers.md
NEXT: testagent — /implement #8 (brief v2), then #6 #10 #11 per cli.5 order

## [2026-09-28] testagent kit.4 | DECISION — CONTINUITY v1.5 freshness stamp + ADR 0004 lint calls
WHY: no numeric "one page" cap existed and the global page had no per-thread date to check; lint needs both to be mechanical
ASSUMED: unilateral-but-disclosed — 10000-char cap (real pages 1.4k–15k, median ~5.5k); stale vs LOGBOOK = FAIL, vs session.log = WARN; shared `stateAsOf` now header-only, case-insensitive, calendar-validated (doctor inherits it) — ahimsa review pending with v2.3/v1.4, before #11
ref: canon/CONTINUITY.md v1.5, docs/adr/0004-state-lint-verdict-tiers.md, .agents/session.log cli.9
NEXT: ahimsa — review v1.5 + ADR 0004 alongside v2.3/v1.4; adjust or ratify before #11
