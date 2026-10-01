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

## [2026-09-28] testagent kit.5 | SESSION — ticket #14 shipped: state lint surfaced in brief + log close
WHAT: `brief` opens with a `## State lint` section (project + global verdicts); `log close` and terminal `stub` print the same after writing (bfdfb2d — local, unpushed)
DONE: 451 → 479 green; sandbox + real-page verified; advice only, exit codes unchanged; `brief` no longer crashes on an unreadable STATE.md. Gap: `brief` refuses outside a workspace, so sessions started from home never see the check
ref: .agents/session.log cli.10; GitHub #14; .agents/specs/cli-14-lint-wiring.md
NEXT: ahimsa — decide coverage for sessions started outside a workspace, then the push

## [2026-09-29] testagent kit.6 | RELEASE — pushed to origin (f38fb83..0361947): #4 #5 #7 #9 #13 #14 now served by npx
WHAT: every session running `npx github:Q9-Ahimsa/banana` now gets `banana log`, `state lint [--global]`, and lint in `brief` / `log close`; installed canon unchanged (rev 1.2 — `sync` is #11)
DONE: secret sweep 0 hits over 7,561 added lines (scanner control-tested); verified through npx: `brief` carries `## State lint`; #9 #13 #14 auto-closed; first live catch within minutes = a stale thread on the global page
ASSUMED: owner ruled the push before reviewing canon v2.3/v1.4/v1.5 + ADR 0004 — the CLI now behaves per them; review still pending
ref: .agents/session.log cli.11
NEXT: ahimsa — review canon v2.3/v1.4/v1.5 + ADR 0004 (gate before #11)

## [2026-09-29] claude kit.7 | DECISION — owner ratified canon v2.3/v1.4/v1.5 + ADR 0003/0004; global page moves to per-thread edits (CONTINUITY v1.6, ADR 0005)
WHY: a whole-page rebuild on 2026-09-28 deleted a concurrent session's update; the v1.5 stamps + `state lint --global` now carry drift control, so "rebuilt whole" costs more than it protects
ref: canon/CONTINUITY.md v1.6 item 16; docs/adr/0005-global-page-per-thread-edits.md; GitHub #15
NEXT: claude — deploy the ratified canon via `sync` on the owner's go (#11 scope)

## [2026-09-29] claude kit.8 | SESSION — tickets #15 + #16 shipped: per-thread global edits; fence identity survives project/init/sync
WHAT: CONTINUITY v1.6 + global-mode retired-header WARN (6b6373d); fence identity single-sourced, `project` and `init` now preserve it as `sync` already did (cde4147)
DONE: 479 → 500 green; end to end, a forced v1 → v2 fence upgrade keeps the recorded identity where the old kit wrote the placeholder tag; a Claude SessionStart hook on the owner's machine now lints the global page at every session start
ref: .agents/session.log cli.12; GitHub #15, #16; .agents/specs/cli-15-global-per-thread.md, cli-16-fence-identity.md
NEXT: ahimsa — go on `sync` (deploys canon v1.6 + current fences to the home harness files)

## [2026-09-29] claude kit.9 | RELEASE — ratified canon deployed to the installed site via `sync`
WHAT: `~/.agents/canon/` refreshed — CONTINUITY 1.2 → 1.6, STANDARD 1.2 → 1.3, SESSION-LOG 1.2 → 1.4, byte-equal to the kit; home harness fences already current (v2), so none were rewritten
DONE: every file sync could touch backed up first; harness files unchanged (hash = backup), identity lines intact; `doctor` stale-canon 0, stale-fence 0. Remaining doctor findings: 11 July ghosts (earlier counted as 10 — `banana.12` was missed) + 2 hyphen-dash NEXTs
ref: .agents/session.log cli.13
NEXT: claude — #11 rollout: migrate the 6 project STATE headers (`retired-header` WARN), then #8

## [2026-09-29] claude kit.10 | SESSION — #11 slice: installed STATE headers migrated; retired-header lint catches every wording
WHAT: the 9 project pages on the owner machine moved from the retired "never patched" header to rebuild-on-close (header line only); RETIRED_HEADER_RE now matches the sentence shape, not one literal (487c82d)
DONE: 500 → 508 green; on the 9 pre-migration pages the old pattern flagged 7, the fixed one 9, and 0 after migration; the SessionStart hook's first live fire seen (after a compaction)
ref: .agents/session.log cli.14; .agents/specs/cli-11a-header-migration.md; GitHub #11 (stays open: shim install + v3 fences)
NEXT: claude — /implement #8 (brief v2), then #6 → #10 → rest of #11

## [2026-10-01] claude kit.11 | SESSION — 0.3.0 built: local install + sync as updater (#6), brief v2 (#8), wiring v3 (#10), doctor supersession (#17)
WHAT: banana installs once and `sync` updates it (it reads canon from the tree npm installed, and the newer of the launched and installed trees wins); doctor checks origin's version; the brief shows the last close + open entries in full and only live handoffs; the bootstrap blocks teach install-once + sync; unowned NEXTs clear once superseded (local, unpushed: 308df6f..16f5540)
DONE: 526 -> 605 green + 1 opt-in network test; the kit's own brief 30,779 -> 8,618 chars; 3 adversarial reviews fixed red-first; a real-world doctor abort after fetch (Windows, Node 24) found and fixed; 11 July ghosts closed, #18 filed
ref: .agents/session.log cli.16-cli.18; .agents/specs/cli-6-*, cli-8-*, cli-10-*, cli-17-*, cli-6b-*, cli-6c-*, cli-release-0.3.0.md; GitHub #6 #8 #10 #17 #18
NEXT: ahimsa — go on the push; then on #11's machine step (npm install -g + `banana sync` here, which re-fences the home harness files to v3)

## [2026-10-01] claude kit.12 | RELEASE — 0.3.0 pushed; first real install + sync on the owner machine (#11 done here)
WHAT: origin 76385c2..0c6fcca; npx serves 0.3.0; `npx … sync` installed the kit globally ("kit installed: v0.3.0") and re-fenced the home harness blocks v2 -> v3; this repo's own block re-fenced by `banana project` (identity corrected to the current agent/owner); the SessionStart lint hook runs the installed kit
DONE: bytes outside every fence unchanged, identities kept, second sync a no-op, doctor clean at home; #6 #8 #10 #17 closed. Found on the real run: CRLF-only "refreshes" and a wrong doctor remedy for project fences (#19)
ref: .agents/session.log cli.19; GitHub #11 #19
NEXT: claude — #19, then #18
