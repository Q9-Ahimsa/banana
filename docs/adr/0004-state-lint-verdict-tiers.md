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

## Consequences

- A CI gate can key on exit `1` alone to mean "a real defect exists," without additional
  parsing.
- WARN findings (dirty marker, retired header, session-log lag) need a human or agent to look
  and decide — they do not block automation, but they do surface.
- The char cap is a decision under uncertainty, not a canon-derived number; if pages trend
  meaningfully larger in future real use, the cap is revisitable evidence, not doctrine.
- Heading detection tolerates any qualifier text a page appends after whitespace, on both the
  presence check and the body-scan boundary — a canon amendment that further constrains
  permitted qualifier text (if one is ever needed) must update both together, since they now
  share one matcher by design.

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
