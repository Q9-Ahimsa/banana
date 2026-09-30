# Spec — #8: brief v2 (compression grain, kit-version and dirty-status lines)

Session entry: `.agents/session.log` cli.16 · Ticket: GitHub #8 · Contract: `docs/DESIGN.md`
section "`brief` — behavioral contract". Built in its own git worktree, in parallel with #6.
Depends on `lib/version.mjs` (`.agents/specs/cli-6-8-shared-version.md`), which is already on
main.

## Ticket acceptance (verbatim, the contract)

- Characterization tests pin the surviving v1 behavior (include/exclude table, ref: lines, ghost
  flagging, discovery mode) before the tightening lands
- Target-feature section: last close entry + all open entries in full; older closed entries as
  headings only
- Kit-version line sourced from the installed package metadata
- Dirty-status line reports the project-STATE dirty marker's presence/absence
- Global machine-grain state remains excluded; every section still carries its `ref:` source line
- Deterministic only — no network, no LLM calls
- Quality gates green: typecheck + full test suite

## Step 1 — characterization first

Before changing `lib/brief.mjs`, add tests that pin today's behavior, against the DESIGN.md
include/exclude table:
- which sections appear, in which order, including the `## State lint` section that #14 added
  right after the header
- every section's `ref:` line
- ghost flagging
- discovery mode (no feature given)
- global STATE excluded

They must pass on the current code. Where an existing test already pins something, name it
rather than duplicating it. Commit nothing; just keep these tests green through Step 2. Any
v1 behavior that Step 2 deliberately changes (only the target-feature grain) gets its
characterization test updated in Step 2, with a comment naming #8.

## Step 2 — the tightening (red-first)

1. **Target-feature grain.** Among the target feature's entries, show in full the most recent
   closed entry (terminal STATUS: complete, blocked or abandoned) and every open entry. Every
   older closed entry shows as its heading line only. Keep log order. Reuse the session-log
   parsing seam (`lib/sessionlog.mjs`); do not write a new parser.
2. **Kit-version line.** Under the brief's title blockquote, before `## State lint`:
   `kit: v<version>`, from `readKitVersion(kitRoot)` in `lib/version.mjs`, or `kit: unknown`
   when it returns null. `runBrief`/`compileBrief` deps gain an optional `kitRoot` (default
   `KIT_ROOT`) for tests.
3. **Dirty-status line,** directly after the kit line:
   - project STATE carries the standing dirty marker → `STATE: dirty (patched since last rebuild; the log is authority)`
   - STATE exists without the marker → `STATE: clean`
   - no project STATE.md → `STATE: none`

   Detect the marker by reusing the existing detection in `lib/state.mjs` (`DIRTY_MARKER_LINE` /
   `checkDirtyMarker`, with the same fence/comment blanking lint uses). Do not re-parse.
4. Update the DESIGN.md brief contract to match.

Red-first: write the Step 2 tests, run them against v1, record the failures, then implement.
Mutation checks: (a) show every closed entry in full again and the grain test fails; (b) make
the dirty detection ignore the marker and the dirty test fails.

## Measure

Report the brief's size in characters before and after, for the kit's own repo:
`node bin/banana.mjs brief cli --tag claude | wc -m`, run on the base commit and on your
branch. Shrinking this is the point of the ticket, so the number goes in the report.

## Rules and gates

- Deterministic text processing only; no network.
- Don't touch `lib/sync.mjs`, `lib/doctor.mjs`, `README.md`, `templates/` or `canon/`; #6 is
  changing those in parallel.
- Synthetic fixtures only (public repo). Sandbox temp dirs.
- Gates: `npm run check`, `npm test` (run through `rtk proxy npm test` so counts show).
