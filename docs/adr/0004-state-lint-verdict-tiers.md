# state lint verdicts in three tiers, not doctor's two

`doctor`'s audits are FAIL-only (exit 1 if any hit). `state lint` needed a genuinely new
shape: a project or global STATE.md page can carry defects a human must fix (a missing
section, an unowned NEXT, a page over the size cap) alongside residue that is legitimate
until a model looks at it (a standing rebuild-on-close marker, an unpromoted session-log
entry newer than the projection). Collapsing both into one FAIL tier would either make CI
gates trip on things that are not defects, or hide real defects inside noise. Decided
2026-09-28 (ticket #9): three tiers — **FAIL** (a mechanical invariant is broken), **WARN**
(ambiguous residue a model should look at), **PASS** (neither) — with exit codes `0`
PASS/WARN-only, `1` any FAIL, `2` usage error or a missing/unreadable target. Usage errors
and disk-state preconditions share exit `2` deliberately, so exit `1` means FAIL and nothing
else — a CI script can gate on `1` alone without also having to parse output for the reason.

Lint never grades content: every verdict is reproducible from file bytes alone, so no check
reads the clock (no `now` is ever injected into `lib/state.mjs`) and no check judges whether
a decision was *good*, only whether the page's mechanical shape is intact.

## The 10,000-char cap

No numeric "one page" cap existed anywhere in the canon or the kit before this — `STANDARD.md`
and `CONTINUITY.md` both say only "one page, hard cap," qualitatively. The spec for this ticket
(cli.9, `.agents/specs/cli-9-13-state-lint.md`) records a survey of live project STATE.md pages
across this machine's active projects measuring 1.4k–15k chars, median ~5.5k, with single lines
up to 969 chars. `STATE_CAP_CHARS = 10000` (measured as JS string length after CRLF
normalization, not lines — a line cap would not track "one page" bloat the way a char cap does,
given lines that long) fails only the one page that measured genuinely oversized in that
survey, and passes every other real page with headroom. A real-page smoke run against six live
project STATE.md files at this ticket's implementation time is consistent with that survey
— see the cli.9 session-log entry.

## logbook-FAIL vs session-log-WARN

`stale-vs-logbook` (as-of older than the newest LOGBOOK.md entry) is a FAIL: the canon's
rebuild-on-close discipline (ADR 0001) makes logbook promotion one of the two judgment-free
triggers for a full STATE rebuild, so a projection that has fallen behind its own logbook is
squarely broken. `stale-vs-session-log` (as-of older than the newest `.agents/session.log`
entry) is a WARN instead, on purpose — a deliberate narrowing of #9's original text, which
named "session-log/logbook" as one FAIL criterion together. The rebuild trigger is logbook
promotion *or* a standing dirty marker, not every unpromoted session-log entry; an agent can
legitimately be mid-arc on a stream with fresh session-log checkpoints that have not yet been
promoted to the logbook (and so have not yet triggered a rebuild) without the projection being
wrong. Flagging that as a hard FAIL would make `state lint` noisy on completely ordinary
in-progress work; WARN routes it to a model's judgment instead of a CI gate.

## Qualifier-tolerant heading matching (amended 2026-09-28, phase 1b)

The first real-page smoke run (six live project STATE.md pages) turned up three
false-positive `missing-section` FAILs: one page carries
`## Truths (durable studio doctrine)` and two others carry `## Watch (...)`
variants — real pages qualify their headings with parenthetical context, and
the original spec's "must exist as a line" was read
literally as an exact-line match, which none of those three satisfy. The defect
was in the spec, not the implementation: real usage already qualifies headings,
so an exact-line match rejects legitimate pages, not just genuinely broken ones.

Fixed by making the heading match qualifier-tolerant: `^## <Name>(?:\s.*)?$`,
the exact name optionally followed by whitespace and any qualifier text. A
name-glued suffix still does not count (`## Watchlist` does not satisfy
`Watch`) — the qualifier must be its own token, not a spelling collision. The
SAME matcher locates a section's body for the owner-matcher scan (`## Next`),
not just presence — a page with `## Next (owned)` must still have its bullets
scanned for `unowned-next`, or a qualified heading would silently skip that
scan, which prints identically to a clean PASS (the worst kind of lint bug: a
false negative that looks exactly like success).

## Global grain (#13)

The trigger for this whole ticket: `~/.agents/STATE.md` was stale on 4 of its 8 threads
while the file's own date read 9 days old — every session had rewritten the one bullet it
touched and carried the rest forward unexamined, so nothing about the page's own bytes
signaled staleness. Project mode (#9) already answers "is this page consistent with its own
logs?"; global mode answers the different question "is this page still consistent with the
project pages it projects?" — a cross-file check, not a self-check, so it needed its own
canon amendment (CONTINUITY v1.5) before `state lint` had anything to verify against.

**The freshness stamp.** Every non-placeholder `## Active threads` bullet now carries
`(as of YYYY-MM-DD)` — the date of the newest source it was rebuilt from, normally the
project's own STATE.md as-of. `thread-stale` FAILs when the pointed-to project STATE is
dated *later* than the stamp: the global bullet is provably behind a page it claims to
summarize. This is deliberately a FAIL, not a WARN, unlike project mode's
session-log-lag — there is no legitimate "mid-arc, not yet promoted" story here: the
project's own STATE.md is itself already a rebuilt projection, so a stamp older than it is
simply wrong, not provisionally incomplete.

**Two WARNs, not FAILs, for the parts lint cannot verify by design.**
`thread-unverifiable` (a pointer that cannot be resolved to a readable STATE.md — a memory
file, a missing path, a relative path) and `thread-target-undated` (a resolved target with
no as-of date of its own) both stop short of FAIL because the global page cannot always
point at another `state lint`-conformant STATE.md — some threads are legitimately tracked
in memory files or external documents, and flagging that as a hard defect would punish a
sanctioned pattern, not a broken one.

**Placeholder bullets are skipped, symmetrically with the owner matcher.** The bootstrap
template's Active-threads and Backlog placeholder lines both start with `(` after emphasis
stripping — the same test the owner matcher already used to skip a template Next bullet.
Reusing it (rather than inventing a thread-specific placeholder rule) is why a freshly
`init`-ed global page — proven against the real `banana init` code path, not a hand-copied
fixture — lints clean with zero findings on the first try.

**No dirty-marker, no retired-header, in global mode.** The global page is rebuilt whole,
never patched (unlike project STATE's rebuild-on-close) — there is no mid-arc patched state
for a marker to announce, and "rebuilt whole, never patched" is its *correct*, required rule
at this grain, not the retired one project pages moved away from in v1.3.

## Review hardening (2026-09-28)

An independent adversarial review of the committed lint (`3526aed` + `bec16a1`) confirmed 15
wrong-verdict inputs — 7 of them false PASSes — against real trigger shapes (fenced/commented
headings, arrows inside backticks, multiple stamps, page-wide date search, and more). Every
mutation check from the original build was real and correct; this is a different class of gap
(right check, wrong input handling), expected on a first hardening pass, not a mark against
the original TDD. One line per rule (`lib/state.mjs` unless noted):

- **F1** — before any section matching, blank fenced code regions and `<!-- ... -->` HTML
  comments to empty lines; a section is present iff a non-blanked line matches; a duplicated
  heading is scanned under every occurrence, not just the first.
- **F2** — a placeholder is ONLY a bullet byte-equal (after trim) to a literal bullet shipped in
  `templates/project-STATE.md`/`templates/global-STATE.md` (with `__OWNER__` tolerant of
  substitution) — not "any bullet starting with `(`".
- **F3** — a date-shaped-but-impossible value (`2026-13-45`, `2026-09-31`, ...) is
  `as-of-malformed`/`thread-stamp-malformed`, never silently "missing" or silently accepted.
- **F4** — as-of search is header-block-only (before the first `## `), case-insensitive, LAST
  match wins — not page-wide, case-sensitive, first match.
- **F5** — pointer resolution ignores `→` inside backtick spans and skips a trailing-prose arrow
  whose target doesn't look like a path.
- **F6** — a bullet carrying more than one freshness stamp compares against the OLDEST
  (conservative).
- **F7** — emphasis stripping tries the triple-marker form (`***`/`___`) before double/single, so
  one strip per side fully unwraps a triple-wrapped or doubly-wrapped `__OWNER__` token.
- **F8** — a top-level bullet marker is `-`/`*`/`+`/numbered (`\d+[.)]`) with 0-1 leading spaces,
  not only `-`/`*` with none.
- **F9** — a section body ends at the next level-1 or level-2 heading (`# `/`## `), not `## `
  alone — a deeper heading or a `---` rule does not end it.
- **F10** — the target STATE.md's own as-of (for `thread-stale`) reuses the same F3/F4/F12-hardened
  `stateAsOf`, so a capitalized "As of" or a page-wide decoy no longer defeats it either.
- **F11** — the bullet content extractor consumes the marker generically (not a hardcoded 2-char
  offset), so extra whitespace or a tab after the marker doesn't defeat the owner match.
- **F12** — the freshness-stamp regex is case-insensitive (`(As of ...)` counts) but otherwise
  exact by design — `(as of 2026-09-28, rebuilt)` still doesn't match.
- **F13** — every U+FEFF byte-order-mark is stripped during normalization, not only one at file
  start.
- **F14** — the dirty marker compares on `line.trim()` (byte-exact otherwise); an Active-threads
  bullet is never joined across lines — a wrapped bullet FAILs by design (canon: one line per
  in-flight project).
- **F15** — line-ending normalization is `/\r\n?/g` (CRLF and lone-CR both become LF), not
  `/\r\n/g` alone.
- **Unreadable inputs** — an existing-but-unreadable LOGBOOK.md or session.log exits `2` naming
  the file, the same tier as an unreadable target, instead of being silently swallowed to
  "absent."

`lintProjectState`/`lintGlobalState` were also changed to run the full text-preparation pipeline
themselves (not only when called through `runStateLint`) — the adversarial review's own probe
scripts call them directly on raw file content, and a public "pure check composer" that only
works correctly through one specific caller is a footgun, not a contract.

## Consequences

- A CI gate can key on exit `1` alone to mean "a real defect exists," without additional
  parsing.
- WARN findings (dirty marker, retired header, session-log lag, thread-unverifiable,
  thread-target-undated) need a human or agent to look and decide — they do not block
  automation, but they do surface.
- The char cap is a decision under uncertainty, not a canon-derived number; if pages trend
  meaningfully larger in future real use, the cap is revisitable evidence, not doctrine.
- Heading detection tolerates any qualifier text a page appends after whitespace, on both the
  presence check and the body-scan boundary — a canon amendment that further constrains
  permitted qualifier text (if one is ever needed) must update both together, since they now
  share one matcher by design.
- The freshness stamp is a manual field, not (yet) machine-derived at rebuild time — a future
  `banana state` subcommand could compute and write it; today a session author fills it by
  hand, and `state lint --global` is the check that catches drift, not a writer that prevents it.

## Considered options

- **Two tiers (FAIL only, doctor's shape)** — rejected: forces a choice between silence on real
  ambiguous residue (dirty marker, session-log lag) or false-positive FAILs on legitimate
  mid-arc states.
- **FAIL on any session-log lag, per #9's literal text** — rejected: the canon's actual rebuild
  trigger is logbook promotion or a standing marker, not "every entry ever," so this would FAIL
  routine unpromoted checkpoints.
- **Line-count cap, matching LOGBOOK/session-log's 700-line rotation threshold** — rejected:
  real STATE.md pages carry very long single lines; a line cap does not track "one page" bloat
  the way a char cap does, and 700 lines of STATE.md prose would already be enormous by char
  count.
- **Exact-line heading match, per the original spec text** — rejected on evidence: the first
  real-page smoke run false-positived on three of six live pages, all of which qualify a
  heading with parenthetical context. An exact match punishes normal usage, not defects.
- **Free-form heading match (any text after `## <Name>`, no separating whitespace required)**
  — rejected: would also match a genuine name collision (`## Watchlist` for `Watch`), which is
  a different section entirely, not a qualified version of the required one.
- **`thread-stale` as a WARN, matching session-log-lag** — rejected: unlike an unpromoted
  session-log checkpoint, a project's own STATE.md is already a rebuilt, authoritative
  projection — a global stamp older than it has no legitimate "not yet promoted" story, so
  treating it as ambiguous residue would hide a real, provable defect.
- **FAIL on every unresolved Active-threads pointer** — rejected: the global page legitimately
  points at non-STATE.md tracking (memory files, external docs) for some threads; a hard FAIL
  there would punish a sanctioned pattern the canon does not forbid.
