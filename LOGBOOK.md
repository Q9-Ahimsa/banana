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


## [2026-10-03] claude kit.13 | SESSION — #20 global page: line limits, expiry, inactivity, and an archive (0.4.0 built, not pushed)
WHAT: global-mode lint WARNs line-over-limit / bullet-wrapped / closed-undated / closed-expired / thread-inactive, clock-free (measured from the page newest stamp); `banana state archive` moves one line into the append-only STATE-archive.md (copy before delete, atomic rename re-guarded before every retry, record dedupe, clock gate for expired/inactive, reason fits section); canon CONTINUITY v1.7 + ADR 0006; brief/log close print a WARN-only global verdict as one line
DONE: owner ruled the rules, thresholds (30 / 7 days), archive-with-command, and two exceptions (the kit removes exactly one named line; a pasted secret is deleted outright); five adversarial review rounds (findings 64 -> 81 -> 14 -> 8, all fixed or accepted as ADR known limits), fixes #20b-#20e; 946 tests + 2 skipped; the owner machine page cleaned with the new command (9,912 -> 7,289 chars, 13 archive records verified verbatim, lint WARN only by design); text copied from private notes scrubbed from unpushed history (final tree unchanged)
ref: .agents/session.log cli.20, cli.21; GitHub #20; .agents/specs/cli-20*.md; docs/adr/0006
NEXT: ahimsa — ratify the v1.7 text, go on the 0.4.0 push; claude — then push, sync here, close #20

## [2026-10-03] claude kit.14 | RELEASE — 0.4.0 pushed; canon v1.7 ratified and synced on the owner machine (#20 closed)
WHAT: owner ratified CONTINUITY v1.7; origin fb19308..61a983c; npx serves 0.4.0; `banana sync` here: "kit updated: v0.3.0 -> v0.4.0", one change (canon CONTINUITY.md -> rev 1.7)
DONE: every other home file byte-identical to its pre-sync backup (harness rule files, hook, global page, archive, the other canon files); doctor clean; global lint WARN only by design; SessionStart hook runs on 0.4.0 (0.45 s); #20 closed with evidence
ref: .agents/session.log cli.22; GitHub #20
NEXT: claude — clean up the merged lane worktrees (owner approves the list), then #19, then #18

## [2026-10-12] claude kit.15 | RELEASE — 0.5.0 pushed; canon v1.8 ratified and synced on the owner machine (#21 closed)
WHAT: #21 global page v1.8 — threads leave at 15+ idle days; backlog lines carry `(queued …)` and go dormant at 22+; watch lines carry `(validate-by: …)` and WARN when due, never moved on sight; waiting form (160 chars); `near-cap` WARN past 9,000; `dormant` reason + stale-aware `inactive` gate; five-line header; any session archives flagged lines before adding its own. Canon CONTINUITY v1.8 + ADR 0007
DONE: built on cli-23 in lanes A0, L, A, D, I (each reviewed, fixes committed); final merged review + a blind case walk of the canon by two reviewers (one non-Claude) gave one fix batch; tests 948 -> 1036, 0 fail; owner ratified 2026-10-12, names kept
DONE: origin e5b71cc..a14259e; `banana sync` here: "kit updated: v0.4.0 -> v0.5.0", one change (canon CONTINUITY.md -> rev 1.8); every other home file byte-identical to its pre-sync backup; global lint WARN only (undated backlog/watch lines + near-cap, as projected); 13 merged lane worktree folders removed, branches kept
ref: .agents/session.log cli.23; GitHub #21; spec .agents/specs/cli-23-global-page-v18.md
NEXT: ahimsa — approve the owner page's v1.8 migration line by line (stamps on Backlog/Watch lines, the new header); claude — then apply it
NEXT: claude — #19 (sync line endings, doctor remedy text), then #18 (supersede duplicate ids); file two issues: README command table out of date, real handles left in older state/archive test fixtures

## [2026-10-12] claude kit.16 | MILESTONE — owner page migrated to v1.8; global lint PASS
WHAT: the owner's global page now follows canon v1.8: threads waiting on the owner use the waiting form, every Backlog line carries `(queued …)`, every Watch line carries `(validate-by: …)`
DONE: owner ruled each group of lines; 10 threads shortened (long text archived as trimmed), 1 thread moved to Backlog, 17 Backlog + 6 Watch lines dated, 6 Backlog lines past 21 days archived as dormant; 18 archive records; page 9,981 -> 7,506 chars; `state lint --global` PASS, so the session-start hook injects one PASS line instead of 25 WARN lines
ref: .agents/session.log owner-page.1
NEXT: claude — file two issues (README command table out of date; real handles in older state/archive fixtures), then #19, then #18

## [2026-10-12] claude kit.17 | CAPTURE — two issues filed: README command table (#22), owner handle in fixtures (#23)
WHAT: #22 README drift (`state` missing from the table, a six-command test guard, v2 fence example, archive prose); #23 the owner's handle as sample data in older tests and help examples, and a deny-list that skips test/, bin/, lib/
ref: .agents/session.log triage.1; GitHub #22, #23
NEXT: claude — #19, then #18; #22 and #23 after (owner may reorder)

## [2026-10-13] claude kit.18 | RELEASE — 0.6.0 pushed and synced on the owner machine (#18, #19, #22, #23 closed)
WHAT: #18 `log supersede --all` retires every entry under a duplicate id (owner ruling: no `--target-date`, since SUPERSEDES is id-keyed); `--target-agent` WARNs that it retires them all. #19 sync and init treat a line-ending-only difference as no change and keep each file's style; doctor names `banana sync` for a home file and `banana project` for a project AGENTS.md, and audits one file reached two ways (letter case, junction, dotfiles link) once. #22 README command table read from the CLI. #23 placeholder owner in fixtures and help; deny-list scan over bin/ lib/ adapters/ test/
DONE: built on cli-24 in 4 TDD lanes (each looped through verify and fix), then 4 merged-tree review rounds: rounds 1-2 found real defects (one a #19 doctor regression), rounds 3-4 only missing tests; final verifier diffed doctor output on 21 scenarios; tests 1036 -> 1089, 0 fail
DONE: origin 2965f94..48890eb; `banana sync` here: "kit updated: v0.5.0 -> v0.6.0", no changes; a second sync on 0.6.0 code: "kit current", no changes; all 8 home files byte-identical to the pre-sync backup; doctor: only [oversize]; global lint PASS
DONE: us-001.1..us-008.1 duplicate handoffs retired with `--all`; 10 lane worktree folders and 420 temp test copies removed (branches kept)
ref: .agents/session.log cli.24, cli.25; GitHub #18, #19, #22, #23; spec .agents/specs/cli-24-batch.md; follow-ups #24, #25, #26
NEXT: claude — .agents/session.log is past the 700-line rotation threshold: archive the tail (SESSION-LOG section 8)
NEXT: claude — #24 + #25 together (wiring template wording, fence v3 -> v4), then #26; owner may reorder

## [2026-10-15] claude kit.19 | RELEASE — 0.7.0 pushed and synced on the owner machine (#24, #25, #26 closed)
WHAT: #24 + #25 wiring templates at fence v4 name `state archive` and say what refreshes each block (sync: home files; project: a workspace AGENTS.md; init: the printed paste block). #26 doctor names `banana init --harnesses <id>` for a stale home block with no owner/tag line, which sync skips. Owner rulings: sync finishes every other file, then exits 1 when a file could not be read or written (canon included), while deliberate skips keep exit 0; project keeps a recorded `defer LOGBOOK.md` decision and exits 1 on a session log it cannot read (LOGBOOK.md left alone, the rest done)
DONE: .agents/session.log rotated (75 entries to .agents/sessions/2026-Q3.log, byte-exact); built in 2 TDD lanes, then 12 review rounds; from round 9 the owner tightened the rule (product = a defect in this batch's lines, or a remedy that fails as printed), and rounds 11 + 12 were clean; tests 1089 -> 1142, 0 fail
DONE: origin ab81ad5..09de65f; `banana sync` here: "kit updated: v0.6.0 -> v0.7.0", CLAUDE.md and codex AGENTS.md v3 -> v4, text outside both fences byte-identical to the pre-sync backup; a second sync: "no changes"; doctor clean (pi has no block, never wired)
DONE: filed #27 (hermes --deliver), #28 (compact-prep hook, design first; design comment added from this run), #29 (six pre-existing fence and doctor edge cases)
ref: .agents/session.log cli.26, cli.27; GitHub #24-#29; spec .agents/specs/cli-26-batch.md
NEXT: claude — other projects' banana blocks lift to v4 via `banana project` in each project's next session (global-page backlog line)
NEXT: ahimsa — pick the next batch: #27 hermes delivery, #28 compact-prep design, #29 edge cases

## [2026-10-15] claude kit.20 | CAPTURE — #30 filed (doctor is silent on a detected harness with no banana block); cli-26 leftovers removed
WHAT: at the 0.7.0 sync, Pi was detected but had no banana block, before and after; doctor printed "clean — no findings". Owner: "no need to wire it rn. add it as a future essential feat issue." -> #30 (doctor finding with a working remedy, a deliberate opt-out, a possible sync notice)
DONE: owner go "Delete all, keep branch (Recommended)": cli-26 worktree removed (branch cli-26-batch kept); 1,722 OS-temp test copies removed (~1.1 GB; 0 refused, 0 failed); re-checked after: none left, main HEAD and status unchanged, 1142 tests, 0 fail
ref: .agents/session.log cli.27; GitHub #30
NEXT: ahimsa — pick the next batch: #27 hermes delivery, #28 compact-prep design, #29 edge cases, #30 unwired harnesses (essential)

## [2026-10-26] claude kit.21 | RELEASE — 0.7.1 pushed and synced: CONTINUITY v1.9, delivered + review optional = closed
WHAT: owner ruling on a session audit — "Add a close disposition: delivered, review optional"; ship mode "Build and push". Canon-only: a delivered thread on whose answer nothing waits closes with a Recently-closed line naming the artifact; the waiting form drops "review" from its scope (net live rule count 0; no CLI change; existing `state archive --reason closed` does the move)
DONE: 3ab8d3b docs(canon), 7915321 chore(release) on main via branch canon-1.9-delivered-close; tsc clean, 1143 tests (1141 pass, 0 fail, 2 skipped); pushed; `banana sync` refreshed only ~/.agents/canon/CONTINUITY.md (rev 1.9), every other hashed home file byte-identical; doctor: 0 stale-canon findings
ref: .agents/specs/canon-1.9-delivered-close.md
NEXT: ahimsa — pick the next batch: #27 hermes delivery, #28 compact-prep design, #29 edge cases, #30 unwired harnesses (essential)
