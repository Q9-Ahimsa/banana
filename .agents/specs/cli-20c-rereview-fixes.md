# Spec — #20c re-review fixes

Session entry: `.agents/session.log` cli.21. Base: `e3a35df`. Owner ruling (2026-10-02): fix the
regressions, the findings that matter, and the cheap test gaps; write the exotic tail into ADR 0006
as known limits; verify with a recheck of every fixed item plus one fresh round that reports only
should-fix or worse.

The re-review rechecked the 64 earlier findings (26 fixed, 1 by design, 32 open — mostly "correct
but unpinned", 4 regressed) and confirmed 76 new findings (H1–H76) plus 5 from its critic (K1–K5).
Each worker gets the full findings file (ids, failure scenarios, reviewer reasoning) in its prompt;
this spec gives the disposition of every id and the design decisions that the fixes need.

## Design decisions

- **E1 — comments and the raw line.** Lint excerpts are cut from the RAW page line (comment
  included), so a printed excerpt is always a substring the archive can match (C15, H11). The
  lint's stamp parsing and the archive's D3 gate both read the PREPARED line (comment-stripped,
  code-span-masked) — one text, one verdict (H3). The archive refuses a line that opens or closes a
  multi-line HTML comment (an unclosed `<!--`, or a `-->` with no `<!--` before it on the line):
  removing it would re-expose or swallow other content (H6, H40). A comment that opens and closes on
  the line is fine.
- **E2 — D1 continuation, refined.** After a bullet, every line indented 2+ spaces or a tab is a
  continuation line, whatever it holds (an indented fence, its body, an indented comment). Only
  column-0 structure ends a bullet: a heading, a thematic break, a fence opener, a comment-only
  line, another bullet, or a blank line followed by a non-indented line. A comment-only line never
  counts as the blank separator (C4, H9). So the archive refuses any bullet with an indented tail
  and the lint WARNs `bullet-wrapped` for it.
- **E3 — empty bullets.** A bullet line that is empty after comment removal (`- <!-- note -->`) is
  not a bullet, in both modes (H67). A template placeholder carrying an inline comment is still a
  placeholder (H41). `- - -` / `* * *` are thematic breaks, not bullets (H68).
- **E4 — code spans.** CommonMark rule: a run of N backticks opens a span that only a later run of
  exactly N backticks closes; an unmatched run is literal text. Stamps inside a span are ignored;
  an unpaired backtick no longer hides a stamp after it (H8, H61).
- **E5 — archive write robustness.** Resolve the page's real path (symlinks) and put the temp file
  next to the real file; refuse a page that has more than one hard link (H1). Retry the rename on
  EPERM / EACCES / EBUSY with short backoff, up to about 2 s in total — Windows readers such as
  antivirus scanners hold files briefly (H2). Before appending, skip the append when the archive's
  last record is byte-identical to the one about to be written, so a retry or a concurrent
  identical run never duplicates a record (C48, H38). If the rename finally fails: unlink the temp
  file and say the archive holds the record, the line is still on the page, and a rerun will not
  duplicate the record.
- **E6 — headers name the exception.** The page header's "Never delete a line" and the archive
  header's "Append-only" both name the one exception: a pasted secret is deleted outright (H70).
- **E7 — lint inside brief and log close.** When the global lint has only WARNs, `brief` and
  `log close` print ONE line: the verdict, the count per finding type, and "run `banana state lint
  --global` for details". FAIL findings still print in full. Standalone `state lint` is unchanged
  (K1 — the real page went from 1 to 19 lines, about 5 KB, in every brief).
- **E8 — tags.** `state archive --tag` uses the same validator as `banana log` (reuse it; K2).
  Whitespace-only `--match` or `--tag` is a usage error (H66).
- **E9 — owner from the header.** Read the owner from the template's literal `Owner: <name>.
  Protocol:` shape — the name runs to the `. Protocol:` — so "Jane Q. Public" survives (C9, H7). No
  match → keep the template token (the lint accepts either).
- **E10 — one stamp rule.** For a line with several valid stamps, the archive's D3 gate uses the
  same stamp the lint uses (the oldest valid one), so the lint never suggests an `expired`
  move the gate must refuse (H12).
- **E11 — placeholders.** A placeholder is replaced, not archived: adding the first real line to a
  section deletes the placeholder. That is not a removal of content (H45, docs only).
- **E12 — shell quoting in help.** Instead of per-shell quoting rules, the help says: pick a short,
  distinctive `--match` substring without quotes, `$`, `%` or backticks (H15, H69, H71). Keep one
  example per shell. Name exit-2 causes in plain words, never spec labels like "D1" (H23, H37).
- **E13 — clock gate vs page rule.** Document both, plainly: the lint flags by the page's newest
  stamp (it never reads the clock); the archive allows `expired`/`inactive` by today's date. Both
  wordings must agree with the code (H47, X2).

## Lane L — lib/state.mjs (+ lib/brief.mjs, lib/log.mjs only as E7/E8 need), test/state.test.mjs, test/brief.test.mjs, test/log.test.mjs

Fix: E1 lint side (raw-line excerpts; prepared-line stamps), E2, E3, E4, E7, E8 (parse side), H42
(an owner name with a space can own a bullet), H43 + C50 (every excerpt, `trimLine` included,
cuts at code points), H48 (expiry JSDoc direction), H36, C29 (the removed placeholder-exemption
tests: re-pin each exemption with a placeholder that WOULD be flagged if it were not exempt). Export what lane A needs: the raw-line excerpt helper, the stamp
selection used by the age checks, the tag validator.
Pin with tests (each must fail if its behavior is reverted): H28, H29, H31, H54, H55, H58, H59,
H63, H76, C28, C44, C45, C55, C56, and every E-decision above that this lane implements.

## Lane A — lib/state-archive.mjs, bin/banana.mjs, test/state-archive.test.mjs, test/bin.e2e.test.mjs

Starts after lane L merges. Fix: C1 (its regression path — read its recheck reasoning; E1's
comment-boundary refusal must cover it, with a test), E1 archive side, E5, E6 (archive header text), E9, E10, E12, C8
(an archive without a final newline gets a blank-line separator — the current test pins the wrong
outcome; correct it), H4 (use lane L's code-point excerpt), H14 (help names the duplicate
exception), H16 (`--reason closed` reminds you to add the Recently-closed line), H53 (in-code docs
still describe the pre-D1 extent), H65 (a BOM-only or line-break-only archive gets the header).
Pin with tests: H24, H25, H26, H27, H30, H32, H33, H34, H35, H56, H57, H60, H62, H72, H73, H74,
H75, C7, C22, C24, C26, C30, C31, C41, C42, C46, C58, C60, and X1: replacing the rename with an
in-place write of the temp file's bytes must turn a test red (today the whole suite passes it).

## Lane D — canon/CONTINUITY.md, templates/global-STATE.md, docs/adr/0006-…, docs/DESIGN.md, README.md, CONTEXT.md, test/canon.test.mjs, test/templates.test.mjs

Runs in parallel with lane L. Document E1–E13 exactly. Fix: H10, H13, H17, H18, H19, H20, H21,
H22, H46, H47, H49, H50, H51, H52, C37, C39, C51 (both were assigned in #20b and not done), K4
(the template test comment still says three header lines). Canon stays v1.7 (unshipped); the
embedded template stays byte-identical to templates/global-STATE.md. Pin with canon tests (H64):
the secrets rule, the five reason definitions, the clock gate, the by-hand record format, and that
the by-hand format matches what the command writes byte for byte.
ADR 0006 gains a "Known limits (accepted)" section listing every id below with one plain sentence
each.

## Accepted, not fixed (ADR 0006 known limits)

- H5 — an archive saved as UTF-16 gets UTF-8 records (the kit only ever writes UTF-8).
- H39 — the atomic rename gives the page its directory's default permissions and attributes.
- H44 — two lines sharing their first 60 characters print the same excerpt; pass a longer
  `--match`.
- H38 residue — two concurrent runs by different agents can write two records for one line (a
  harmless duplicate copy; identical records are skipped per E5).
- K3 — the wiring roster still lists `state lint` only (changing it re-fences every installed
  block; agents learn `state archive` from the page header and the canon).
- K5 — pages created before v1.7 keep their old header until someone rebuilds it.
- C34 remainder — a wrapped line starting with a number and a period can read as a numbered
  bullet (now visible through `bullet-wrapped` and the other WARNs).
- The reference date can move backward when the newest stamp leaves the page.

## Already fixed — no work

C2, C3, C5, C6, C10–C12, C14, C16–C20, C23, C25, C27, C33, C35, C36, C43, C47, C57, C59, C61, N2, N3
(fixed); C13 (by design); C40 (comment-only — closed). Docs-only rechecks marked "unpinned" with no
rule sentence to pin (C21, C38, C52, C53, N1) — closed; C54 (the e2e test now runs with a sandbox
home; "never touches the real home" is not something a behavioral test can pin) — closed; C32, C49 are covered by lane D's canon pins.

## Gates (every lane)

`npm run check`; `timeout 300 rtk proxy npm test` (base 741 pass + 1 skipped); red-first tests with
independent expected values; mutation-check every new guard and boundary. Fixtures synthetic (public
repo). No commits. Never touch the real home; run every CLI with HOME and USERPROFILE set to a
sandbox; create temp dirs with node `mkdtempSync` and print each absolute path before writing to it.
