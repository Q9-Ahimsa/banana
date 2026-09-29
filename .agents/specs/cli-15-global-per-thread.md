# Spec — global page: per-thread edits, not whole rebuilds (#15)

Session: cli.12 (claude, 2026-09-29). Ticket: GitHub #15. Owner ruling 2026-09-29: adopt
per-thread edits; ratify SESSION-LOG v2.3, CONTINUITY v1.4 + v1.5, ADR 0003, ADR 0004.

## Why

Several sessions write the global page concurrently. "Rebuilt whole, never patched" makes
each close rewrite the whole file, so a rebuild from a stale read deletes another session's
update (observed 2026-09-28). The rule existed to stop per-line drift; the v1.5 freshness
stamps + `state lint --global` now catch that drift mechanically.

## 1. Canon — `canon/CONTINUITY.md` → v1.6

In the "Global grain — `~/.agents/STATE.md`" section:
- Template header, line 2: replace `Rebuilt whole, never patched.` with
  `Edit only your own threads; never rewrite the page.` Re-wrap the header lines the way
  the existing block is wrapped; keep every other word of the header unchanged.
- Replace the "Session close" bullet's text ("… rebuild the page — never patch it. …") with:
  **Session close:** if cross-project state changed (thread opened/closed, backlog item
  added), edit only the threads and items your session owns or changed — a targeted edit
  right after a fresh read, re-stamping each touched thread's `(as of)` from its source.
  Never rewrite the whole page: several sessions write it concurrently, and a whole-page
  write from a stale read deletes their updates. Freshness is enforced by
  `banana state lint --global`, not by rebuilding. Chronology does not live here; it lives
  in project logbooks.
- Bump the version marker to v1.6 using exactly the mechanism of the v1.5 bump (commit
  bec16a1 is the pattern: `<!-- banana:canon rev … -->`, the H1 version, any test pinning it).
- Add changelog paragraph + numbered item in the same style as v1.4/v1.5:
  "v1.6 amends the **global-grain maintenance rule** (ADR 0005 in the kit repo). Nothing
  else changes." and item **16. Per-thread edits** — one paragraph with the reason and a
  "Counter-failure:" sentence (a whole-page write from a stale read silently deleting a
  concurrent session's update).
- Any other place in canon/ that states the global page is rebuilt whole (grep
  `rebuilt whole`, `never patch`, `rebuild the page`) must be made consistent — the
  PROJECT-grain rebuild-on-close rule (v1.3) is untouched.

## 2. Template — `templates/global-STATE.md`

Header identical to the new canon block. Tests that assert the canon block and template
agree must stay green; tests asserting the global template CONTAINS
`Rebuilt whole, never patched.` flip to assert it does NOT, and that it contains the new line.

## 3. Lint — `lib/state.mjs` global mode

- New WARN in global mode: `retired-header` when the page matches
  `/rebuilt whole, never patched/i` — message: header carries the retired
  whole-rebuild rule; migrate to per-thread edits (ADR 0005). Reuse the single-sourced
  retired-header regex/constant already used by project mode.
- Remove any code/docs saying global mode "never flags" that phrase.
- A page with the new header must not WARN. A fresh page from the real `init` path must
  still lint PASS (the existing global fresh-page control covers this — keep it green).

## 4. Docs

- `docs/adr/0005-global-page-per-thread-edits.md` in the style of 0003/0004: Context (the
  lost update; why the old rule existed), Decision (per-thread edits + stamps + lint),
  Rejected (compare-and-swap whole rebuilds — needs a kit write command because every
  harness writes files its own way, and still re-reads every project page per close;
  lock files — a killed window leaves a stale lock, the same failure that rules out
  close-time hooks), Consequences (drift control = stamps + lint; the live page's header
  must be migrated; global-mode retired-header WARN is the backstop).
  First line after the title: `Decided (2026-09-29, ratified by Ahimsa).`
- ADR 0003 and ADR 0004: add, in the same place ADR 0001/0002 carry it, the line
  `Ratified by Ahimsa, 2026-09-29.` Change nothing else in them.
- `docs/DESIGN.md` state-lint contract: add the global-mode `retired-header` WARN.
- `CONTEXT.md`: add **Per-thread edit** to the glossary.

## Tests (TDD — red first, then green; mutation-check the new WARN)

Synthetic fixtures only (PUBLIC REPO — no real project/person names, no real paths).
Global mode: old header → WARN retired-header (exit 0); new header → no WARN; both headers'
pages otherwise identical. Canon/template agreement tests updated. Mutation: disable the
new global WARN → a test goes red.

## Gates

`npm run check` + `npm test` green (baseline 479). Then, read-only: run
`node bin/banana.mjs state lint --global` from the repo against the real machine page and
report the output (expected now: the new retired-header WARN appears, since the live page
still carries the old header — that is correct and will be migrated by the orchestrator).

## Out of scope

No project-grain rule changes. No edits under the user's home config or `~/.agents/`. No
session.log writes. No commits or push.
