# Spec — #20d verification fixes

Session entry: `.agents/session.log` cli.21. Base: `51384c9`. Owner ruling (2026-10-02) stands: fix
what is real, accept the exotic tail, verify. The #20c verification closed 72 of 102 items; 30 stay
open (24 not fixed — mostly a missing test, 6 regressed) and one should-fix round confirmed 14 new
findings (F1–F14), one a blocker. Each worker gets the full findings file in its prompt (keys
`recheck.<id>` and `fresh.F<n>`).

## Decisions

- **G1 — no write over a concurrent edit (F1, blocker).** The rename retry must re-run the page
  guard (page bytes unchanged since the first read) before EVERY rename attempt; if the page
  changed, stop, unlink the temp file, exit 2, and say the archive holds a copy, the line is still
  on the page, and a rerun is safe (identical records are skipped).
- **G2 — refusal messages never say "delete by hand" (F5).** After a failed rename or guard 2, the
  remedy is "rerun the command" — the record dedupe makes a rerun safe. Hand deletion contradicts
  "never delete a line".
- **G3 — comment boundaries respect fences (C1, H6, H40, F3).** The archive's "this line opens or
  closes a multi-line comment" check must use the same fence-aware scan as the lint
  (`blankNonSemanticRegions`): `<!--` or `-->` inside a fenced block is literal text, not a
  comment boundary. Export one helper from lib/state.mjs that reports, per line, whether it opens or
  closes a multi-line comment outside fences; the archive uses it.
- **G4 — owners (H42, F4).** A multi-word owner is accepted only when it equals the page's
  declared owner (the global header's `Owner: <name>. Protocol:`; for project pages, the fence or
  `--owner` source the lint already uses, if any) or a known agent tag; otherwise the single-word
  rule applies. Match on code-span-masked text. Pin as UNOWNED: `- review the draft — waiting on
  the vendor`, `- Unowned item — needs an owner`, ``- see `a — b` for details``.
- **G5 — whitespace-only lines are blank (H59, F2).** A line of only spaces/tabs after a bullet is a
  blank line for the continuation rule, never a continuation line.
- **G6 — hard links (F6).** Refuse a hard-linked page only for moves that replace the page;
  `trimmed` and `--dry-run` never replace it, so they proceed. The refusal's remedy names what to
  do (archive by hand per the canon's by-hand format, or break the link).
- **G7 — archive line endings (H65).** Choose the record EOL from the archive's own existing line
  breaks; a blank archive (empty, BOM-only, breaks-only) takes the page's EOL. Pin both.
- **G8 — symlink pin (X3, F11).** Add a test that creates a symlinked page with `fs.symlinkSync`
  and skips (`t.skip`) when that throws EPERM/EACCES (Windows without developer mode); where it
  runs, it must fail if `realpathSync` is dropped.

## Lane L2 — lib/state.mjs + test/state.test.mjs

G3 helper (export), G4, G5, H41 (a placeholder with an inline comment is still a placeholder — the
behavior still fails), and pins: C15 + H11 + F13 (the raw-line excerpt at ALL five WARN sites),
C29 (the remaining exemption), C44 + F14 (the reference-date test must be able to fail), H31
(`___` breaks, level 5–6 headings), H54, H55 (the S7 half), H58.

## Lane D2 — canon/CONTINUITY.md, docs/DESIGN.md, docs/adr/0006-…, test/canon.test.mjs

Runs in parallel with L2. F7 (the canon's CLOSE step still says to rebuild the global page — since
v1.6 it is per-thread edits), F8 (the one-line rule must state E2: an indented line right after a
bullet is always a continuation line), F9 (DESIGN's brief/log-close collapse wording must match the
code: only the global side collapses, and only when it has WARNs and no FAILs — read the code to
confirm), H17, H18, H22, H46, H47, H52 (each: make the wording match the code; pin canon sentences
with canon tests where the rule lives in the canon), H64 (the fifth pin). Document G1–G8. Canon
stays v1.7; embedded template byte-identical to templates/global-STATE.md.

## Lane A2 — lib/state-archive.mjs, bin/banana.mjs, test/state-archive.test.mjs, test/bin.e2e.test.mjs

After L2 merges. G1, G2, G3 (use L2's helper), G6, G7, G8, and pins: F10 (an in-place page write
that also deletes its temp file must turn a test red), F12 + H3 (D3 reads the prepared line: a
stamp inside a comment must not count), H30 (the temp file is written next to the page and never
left behind), H33 (placeholder EOL precedence, both mutants), H37 + H23 (help names no spec labels),
H75 (the placeholder owner comes from the header, not elsewhere on the page).

## Closed without work

H45 (E11 is docs-only; the wording is right — unpinnable prose). Everything the #20c verification
marked fixed, docs-unpinnable or accepted.

## Gates (every lane)

`npm run check`; `timeout 300 rtk proxy npm test` (base 880 pass + 1 skipped); red-first tests with
independent expected values; revert-to-red for every new test. Fixtures synthetic (public repo).
No commits. Sandbox only: temp dirs via node `mkdtempSync`, absolute paths printed before writing,
HOME= and USERPROFILE= inline on every CLI command, never a CLI run chained after a step that can
fail. Run single test files with `--test-concurrency=1` while iterating (memory is tight).
