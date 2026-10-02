# Spec — #20e final fixes

Session entry: `.agents/session.log` cli.21. Base: `fb3752b`. The #20d verification fixed 42 of 47
items (incl. the rename-retry blocker); its should-fix round found 8 (down from 14, from 81). This
batch closes what is real; the rest goes to ADR 0006's Known limits. Verification afterwards is a
recheck of these items only. Each item's full text is in the findings file passed in the prompt
(keys `recheck.<id>` for H42/H45/H52/H65/F10, `fresh.F<n>` for this round's F1–F8).

## Fix

1. **F4 — public-repo hygiene (must).** Replace the fixture and JSDoc text that came from a real
   private page (a Backlog line quoted in test/state.test.mjs and in the `classifyOwnerBullet`
   JSDoc in lib/state.mjs) with synthetic text that exercises the same shape.
   Then grep the whole repo for any other non-synthetic name and report every hit.
2. **F1 — `<!--` inside a code span.** A `<!--` or `-->` inside a backtick code span is literal
   text: the comment pass in `blankNonSemanticRegions`/`stripCommentsFromLine` and
   `commentBoundaryFlags` must mask code spans (the E4 CommonMark rule) before looking for comment
   markers. Pin: a bullet quoting `` `<!--` `` does not hide later lines from the lint or block the
   archive; the commented-heading hardening still holds.
3. **H42 / F2 — owners on project pages.** Code stays as is (multi-word owner = the global page's
   declared owner or a known agent tag; project pages have no declared owner, so single-word or
   agent tag). Make DESIGN.md and ADR 0006 say exactly that, and add one Known-limits line.
4. **F3** — ADR 0006 Known limits: no kit command rebuilds the global page; say how an old header
   gets the new lines (an agent edits the header by hand; `init` only creates a missing page).
5. **H52** — finish the docs scoping (the reference date and the future-stamp scan read only
   non-placeholder Active-threads `(as of)` and Recently-closed `(closed)` stamps) wherever the
   recheck found the old "any stamp on the page" wording; pin it.
6. **H45** — pin E11's sentence (a placeholder is replaced, not archived) with a canon/DESIGN test.
7. **Pins** (each must kill the mutant the verifier recorded): F5 (G1 guard with a SAME-LENGTH
   concurrent edit, and the page-missing branch of the retry check), F6 (a comment with an unfenced
   middle line: dropping the carried-in state must go red), F7 (code-span masking in the owner
   matcher: a fixture where masking changes the verdict), F8 (future-stamp note: the today boundary,
   the real-date filter, and the reason scope — the note's text must be asserted, not just exit 0),
   F10 (mutant A2: an in-place page write that also deletes its temp file).

## Accept (ADR 0006 Known limits)

- H65 — a blank archive holding only line breaks takes the page's line ending, not its own.
- The 4 downgraded nits of the #20d round (listed in the findings file) — no work.

## Gates

`npm run check`; `timeout 300 rtk proxy npm test` (base 932 pass + 2 skipped); red-first, revert-to-
red for every pin; synthetic fixtures; sandbox-only CLI runs (HOME= and USERPROFILE= inline); no
commits.
