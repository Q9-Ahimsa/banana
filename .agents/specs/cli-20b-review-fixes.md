# Spec — #20b review fixes (lint, archive, docs)

Session entry: `.agents/session.log` cli.20. Base: `e3f1e5a` (#20 lanes merged + span reconcile).
A 5-dimension adversarial review (3-lens verify) confirmed 61 findings + 3 from its completeness
critic: 0 blockers, 23 should-fix, the rest nits. Many share one root cause — the archive tried to
handle arbitrary markdown structure (wrapped bullets, sub-headings, rules, inline comments, fences)
that the global page never needs. So the central fix is a simplification, not 20 patches.

## Decision D1 — the global page is one physical line per bullet

The canon already says "one line each". Make it mechanical:
- A top-level bullet's **continuation lines** (new shared helper in lib/state.mjs, replacing the
  greedy `topLevelBulletRanges`/`topLevelBulletSpans` rule): the non-blank lines directly after it
  that are NOT a heading of any level (`#{1,6} `), a thematic break (`---`/`***`/`___`, 3+), a
  fence opener, an HTML-comment-only line, or another top-level bullet; plus, after a blank line,
  lines indented 2+ spaces or a tab (a loose item's next paragraph). Anything else ends the bullet.
- Lint (global mode only): new WARN `bullet-wrapped` for a top-level bullet in any of the four
  sections that has continuation lines — message: join it into one line. `line-over-limit` now
  measures the bullet's own physical line only (the wrap is reported separately). The existing
  Active-threads one-line rule (F14) is unchanged.
- Archive: a candidate is exactly one physical line. If the matched bullet has continuation lines,
  exit 2 ("bullet spans N lines; join it into one line first"), nothing written. The archive only
  ever removes one line.
- Remove the now-unused span helpers; keep exports minimal.

## Decision D2 — HTML comments blank only the comment

`blankNonSemanticRegions` blanks every whole line that contains `<!--`, so a real bullet with an
inline comment is invisible to every check (pre-existing). Blank only the comment span: text
before `<!--` on the opening line and after `-->` on the closing line survives; lines fully inside
a multi-line comment blank; several comments on one line all go. `<!-- ## Next -->` alone still
blanks to nothing (keeps the commented-heading hardening). All existing state tests must stay
green; if one pins whole-line blanking of real content outside a comment, report it with your
judgment instead of silently changing it.

## Decision D3 — the archive command is the clock-aware safety gate

The lint stays clock-free (ADR 0004). A mistyped future stamp can make the lint WARN the whole
page expired/inactive; the action side catches it. `state archive` (it reads the injected clock):
- `--reason expired`: refuse (exit 2) unless the line's own `(closed …)` stamp is more than 7 days
  before today. `--reason inactive`: refuse unless its `(as of …)` stamp is more than 30 days
  before today. Missing stamp → refuse, suggest `--reason removed`. If any stamp on the page is
  after today, name it in the refusal ("fix that stamp first").
- Reuse lib/state.mjs's stamp parsing (export what's needed); no second parser.

## Lane 1 — lib/state.mjs + test/state.test.mjs

1. D1 lint side + D2.
2. `parseStateArgs`/archive flags: a value flag (`--match`, `--reason`, `--tag`) whose value is
   missing, empty, or starts with `--` → usage error (today `--tag --dry-run` swallows `--dry-run`
   and does a REAL move); a value containing CR or LF → usage error; a repeated flag → usage error.
3. Stamps inside inline code spans (backticks) are ignored, for both `(as of …)` and `(closed …)`,
   in every check and in the reference date. Keep existing tests green (report any conflict).
4. `thread-inactive` is not reported for a bullet that is already `thread-stale` (contradictory
   remedies; stale wins — the project moved, refresh the stamp).
5. Placeholder patterns: an owner name containing spaces still matches (`__OWNER__` →
   a non-greedy any-run, not `\S+`); a fresh `init` page with such an owner lints clean.
6. Finding excerpts: cut at code-point boundaries (no split surrogate pairs), 60 code points, and
   always a substring of the page line so it can be pasted as `--match`.
7. Every date-check message names the reference date AND the bullet it came from.
8. Comments: fix the orphaned `topLevelBullets` JSDoc; drop the `SECTION_LINE_LIMITS` comment's
   false claim that the archive reuses it.
Tests (red first; independent expected values — never compute the expectation with the function
under test): D1 continuation cases (lazy line, indented paragraph after blank, `###`, `---`,
fence, comment-only line, plain paragraph after blank = NOT continuation); D2 inline/multi-line/
several comments; item 2 each bad form; backtick stamps (as-of and closed, incl. reference date);
stale+inactive on one bullet; spaced owner; surrogate excerpt; line-over-limit through
`lintGlobalState` on a CRLF page (no hand normalization); reference-date scope (Watch/Backlog
dates never count); stamp keyword per section (`(as of …)` on a closed line does not satisfy
closed-undated); impossible dates on the closed side and in both age checks; non-ASCII length unit
pinned; remove or rewrite the placeholder-exemption tests that cannot fail.

## Lane 2 — lib/state-archive.mjs + bin/banana.mjs + test/state-archive.test.mjs + test/bin.e2e.test.mjs

Starts AFTER lane 1 merges (it consumes the new helpers and parse rules).
1. D1 archive side; D3.
2. Atomic page write: write the new page to a temp file in the same directory, then rename it over
   the page; on any failure unlink the temp file (a single file, never a directory). Order:
   read → validate (match, single line, D3, valid UTF-8) → write temp → re-read guard 1 (page bytes
   unchanged, else unlink temp, exit 2, nothing appended) → append archive record → re-read guard 2
   (else unlink temp, exit 2, say the archive holds a copy and the line is still on the page) →
   rename. `trimmed`: validate → guard → append, page untouched.
3. Invalid UTF-8 on the page (bytes that don't round-trip) → refuse, exit 2, nothing written.
4. Placeholder insertion when a section empties: the removed line's own terminator (page dominant
   if it had none; lone-CR pages included); substitute the owner from the page header's
   `Owner: <name>.` line when present.
5. Archive append: an existing archive that is empty gets the header first; one without a final
   newline gets one before the record; EOL = the existing archive's, or the page's on creation.
6. Several matches whose lines are byte-identical → move the first and say so; otherwise exit 2.
7. `--dry-run` output is clearly a dry run (prefix every line `dry run — `), never the success
   wording.
8. Help: the top-level `state` entry lists `lint · archive`; STATE_USAGE's exit-2 line names its
   non-usage causes; examples for PowerShell (single quotes — literal), cmd.exe (double quotes),
   POSIX (single quotes). A line with a pasted secret: say in help that it is deleted outright,
   never archived.
Tests (red first, independent expected values): a Recently-closed `expired` move end-to-end incl.
runtime placeholder; copy-before-delete order (fail the append → page unchanged; fail the rename →
page unchanged, archive holds the copy, temp gone); `closed` and `inactive` really remove the
line; byte-preservation on CRLF, lone-CR and BOM pages; archive EOL contract both ways; header
pinned as literal text (not the module's constant); guard 1 and 2 each detect a same-length edit;
D3 refusals (not yet expired, future stamp named, missing stamp); bad flag forms through bin;
duplicates; dry-run purity and wording; reminders absent for other reasons; section name in the
record for every section; record date from injected `now` (local calendar, pin a UTC-boundary
case); trailing whitespace preserved verbatim; bin exit code + stderr for refused moves; the
"without --global" e2e must run with HOME and USERPROFILE set to a sandbox (today it runs the
real binary against the real home).

## Lane 3 — docs + canon/template tests (canon/CONTINUITY.md, templates/global-STATE.md, docs/adr/0006-…, docs/DESIGN.md, README.md, CONTEXT.md, test/canon.test.mjs, test/templates.test.mjs)

Describe the behavior of D1–D3 and lanes 1–2 exactly as specified above.
1. Expiry wording is backwards today ("expires 7 days after the page's reference date"): a closed
   line expires when its stamp is MORE than 7 days before the page's newest stamp; a thread is
   inactive when its stamp is MORE than 30 days before it (31+, not "30+"). Same in the header.
2. The template header (max 3 blockquote lines, ≤ 100 chars each) says: one line per bullet; the
   four limits; `(closed YYYY-MM-DD)`; dates measured against the page's newest stamp; never delete
   a line — `banana state archive` moves it to STATE-archive.md. Canon embedded template stays
   byte-identical (pin ALL header lines and the placeholder in tests, not a subset).
3. Kit-ownership carve-out: README, DESIGN.md and the canon promise the kit never overwrites the
   global page. Amend precisely: the kit never rewrites the page's content; the one exception is
   `state archive`, which removes exactly the one line the caller named, after copying it.
4. Define every reason: expired (closed line past expiry), inactive (thread → one-line Backlog
   item), trimmed (copy only; shorten in place), closed (a finished Active thread: archive its line,
   add a Recently-closed line), removed (anything else the owner drops).
5. A routine status update of your own thread is NOT a removal (its history lives at the pointer
   target); archive only when text leaves the page or a line is trimmed.
6. Secrets: a credential/token/key pasted onto the page is deleted outright, never archived; if
   one reaches the archive, delete it there too — the only edit the archive ever takes.
7. Give the by-hand record format (header + record heading + verbatim line) so a harness without
   the kit can comply; the command stays the preferred way.
8. The clock gate (D3) and atomic write in the canon/DESIGN contract; the one-line rule and
   `bullet-wrapped`; the reference date can move backward when the newest stamp leaves the page
   (accepted: a WARN can vanish until the next write).
9. ADR 0006: fix the check-set and matching-rule description, drop the precedent ADR 0004 doesn't
   contain, record D1–D3 and the rejected alternatives (wall-clock lint; outlier heuristics).
   DESIGN.md: fix the "mirrors F6" reference; add `bullet-wrapped`. CONTEXT.md glossary: reference
   date, archive move, and correct "Per-thread edit".
10. Canon tests must pin the normative rule text itself (not strings that also appear in the
    changelog or template), and the template test must assert the "never delete" line.
Fixtures and text synthetic (public repo).

## Gates (every lane)

`npm run check`; `timeout 300 rtk proxy npm test` (base 679 pass + 1 skipped); mutation-check each
new guard/boundary (a test must go red). Use `command git`. No commits. Never touch the real home
(`~/.agents/`), never run a write command without HOME and USERPROFILE set to a sandbox.

## Accepted, not fixed

- A wrapped continuation line starting with a number and a period (e.g. a year) reads as a
  numbered bullet — rare, and now visible via `bullet-wrapped`/other WARNs.
- The reference date can move backward after an archive (documented, item 8).
