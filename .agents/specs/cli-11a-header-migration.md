# Spec — #11 slice A: retired-header pattern fix + STATE header migration

Session entry: `.agents/session.log` cli.14 · Ticket: GitHub #11 (slice only; #11 stays open
until the shim (#6) and v3 fences (#10) roll out).

## Problem

`RETIRED_HEADER_RE` (`lib/state.mjs`) is `/rebuilt whole, never patched/i`. Installed project
pages carry the retired rule in more than one wording. Observed on the owner machine
(2026-09-29): 7 pages say "Rebuilt whole, never patched." and 2 say "Rebuilt, never patched."
The 2 pass lint silently, which is a false negative: the lint is meant to be the straggler net
for exactly this migration (#11 ticket body). A third historical wording, "Rebuilt from the
logbook, never patched", exists in old canon text (`test/canon.test.mjs` asserts it is gone
from canon).

## Part 1 — pattern fix (kit repo, red-first)

Widen `RETIRED_HEADER_RE` so that one sentence containing the word `rebuilt` followed, within
the same sentence, by `never patched` matches, including when a blockquote line wrap falls
inside the phrase. Reference pattern (the worker may refine, but must keep every case below):

    /\brebuilt\b[^.]{0,60}?\bnever(?:\s|>)+patched\b/i

Keep it one shared constant used by both `checkRetiredHeader` and `checkRetiredHeaderGlobal`.
Keep the whole-page scan: an existing test asserts "anywhere in the page". Update the JSDoc
above the constant: it currently claims both grains shipped one exact literal wording, which
is now known to be false.

Must MATCH (WARN `retired-header`), each a new test, project grain unless noted:
1. `Rebuilt, never patched.`
2. `Rebuilt from the logbook, never patched.`
3. A wrapped blockquote: `> One page, hard cap. Rebuilt whole,` / `> never patched.`
4. Upper case: `REBUILT, NEVER PATCHED.`
5. Global grain: `checkRetiredHeaderGlobal` on the clean global fixture with its header sentence
   replaced by `Rebuilt, never patched.`

Must NOT match, each a new test:
6. The current canonical header (`Rebuilt at session close; mid-arc` / `> section patches are
   legal and must carry the dirty-marker line.`) — the clean fixture already covers this; keep it.
7. `never patched` with no `rebuilt` in the same sentence (e.g. `The log is never patched.`).
8. Across a sentence boundary: `Rebuilt at close. Old copies were never patched.`
9. The variant phrase inside a fenced code block stays ignored (mirror the existing F1 test with
   wording 1).

Red-first: add tests 1–5, 7, 8 and 9, run them against the unchanged regex, and record which
fail. Tests 1–5 must fail before the fix; if any passes, it cannot catch the bug and must be
rewritten. Then fix the pattern and get all green. Mutation check: after the fix, temporarily
revert the regex, confirm tests 1–5 fail again, restore it.

Fixtures are synthetic. This repo is public: no real project names, person names, usernames or
local paths in tests, docs or this spec's follow-ups.

Gates: `npm test` (baseline 500 passing), `npm run check` (tsc --checkJs), both green.

## Part 1b — scope the check to the header (regression from Part 1)

Found after Part 1 landed (487c82d): the widened pattern flags a page that only *discusses* the
rule in its body. The kit's own STATE.md has a Truth bullet saying retired-header matches
"rebuilt … never patched" in one sentence, and lint now WARNs `retired-header` on it. The old
literal made this false positive rarer, not impossible: a body line quoting "rebuilt whole,
never patched" was always flagged.

Fix: both `checkRetiredHeader` and `checkRetiredHeaderGlobal` test only the header block, which
is every line before the first `## ` heading, the same boundary `stateAsOf` uses (ADR 0004). Reuse
the one existing definition: export `headerBlock` from `lib/doctor.mjs` and call it. Do not write
a second header parser. With no `## ` heading, the header block is the whole text, as today.

Tests, red-first (10 and 11 must fail before the fix):
10. Project grain: the clean fixture plus a body bullet under an existing `## ` section that
    describes the rule (e.g. `- the old header said pages are rebuilt whole and never patched`
    or similar sentence-shape text) does NOT warn.
11. Global grain: the same kind of body mention under `## Active threads` does NOT warn.
12. The retired rule in the header still warns (the existing tests cover this; their names must
    no longer claim "anywhere in the page").

Update the JSDoc of both checks, and any `docs/DESIGN.md` text that says the check scans the
whole page.

On each installed project page that carries the retired rule, replace the retired sentence
(`Rebuilt whole, never patched.` or `Rebuilt, never patched.`) with the canonical rebuild-on-close
text from `templates/project-STATE.md`, wrapped the way the template wraps it:

    …Rebuilt at session close; mid-arc
    > section patches are legal and must carry the dirty-marker line.

Rules:
- Only the header sentence changes. No other byte of any page changes: no re-stamp of the
  `as of` date, no dirty marker (the header is not a section), no content fixes. Lint FAILs on a
  page's own content belong to that project's sessions.
- Keep each file's existing line endings and encoding.
- Verify each page with a diff (a 1-line removal and 2-line addition in the header, nothing else).
- Commit only where `STATE.md` is tracked in git and had no uncommitted changes beforehand, and
  commit that path alone. Never commit where continuity files are kept local-only. Do not push.
  Leave the other edits uncommitted and note them in the report.

## Done when

- Part 1: the new tests exist, the red run is recorded (1–5 failing), the fix makes all tests
  green, mutation check done, gates green, one commit `fix(state): …`.
- Part 2: every migrated page shows the retired phrase gone and the new text present; the fixed
  lint shows no `retired-header` finding on any migrated page. As a positive control, it does
  show one on each saved pre-migration copy (9 of 9).
- Records: session entry cli.14 closed; logbook entry; STATE rebuilt; the SessionStart hook's
  first live fire recorded (observed post-compact 2026-09-29), which closes the Watch item.
