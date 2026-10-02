# Global page gets line limits, closed-stamp expiry, thread inactivity, and an archive

Decided (2026-10-01, ratified by Ahimsa). The global page (`~/.agents/STATE.md`) has a
10,000-char cap (FAIL, ADR 0004) but no rule that ever shrinks it: sessions may edit only
their own threads (ADR 0005), nothing expires, so the page only ever grows. The over-cap
FAIL lands on whoever writes last, usually not the line that bloated it. A real page
measured 9,908 chars: one thread line 1,325 chars, four threads idle 49–69 days
(~1,600 chars), one Recently-closed item 946 chars. Unlike every other record on this
machine — `.agents/session.log` and `LOGBOOK.md` are append-only with ids, project STATE
lines cite logbook ids — a line removed from the global page used to leave no trace
at all.

Five WARN-tier checks (`lib/state.mjs`, `banana state lint --global`), aimed at the kinds of
bloat the real page above showed plus the line-wrapping a char cap alone cannot catch:
`line-over-limit` (a per-section char cap on a bullet's OWN physical line: `## Active
threads` 400 · `## Backlog (owned)` 300 · `## Watch` 350 · `## Recently closed` 250 — this
one check covers both the long thread line and the long Recently-closed item above, since
both are just a bullet over its section's cap), `bullet-wrapped` (any top-level bullet in
those four sections that has continuation lines at all, however short — join it back onto
one line before anything else can even measure it), `closed-undated` (a Recently-closed
bullet with no valid `(closed YYYY-MM-DD)` stamp AT ALL — whether one exists, not how old it
is), `closed-expired` (a closed stamp more than 7 days before the reference date), and
`thread-inactive` (the idle-threads source above: an Active-threads stamp more than 30 days
before the reference date). None of the five FAILs — the page-wide `over-cap` check
stays the mechanical backstop; these five are judgment calls (what to cut, what a Backlog
line should say), same tier reasoning as the dirty-marker WARN (ADR 0004).

A companion command, `banana state archive --global --match <text> --reason
<expired|inactive|trimmed|closed|removed> --tag <agent>`, is how a line actually leaves the
page: every removal (or the long form of a trimmed line) is copied verbatim into
`~/.agents/STATE-archive.md` — append-only, never loaded at session start, searched with
`grep` — before the bullet is removed from the live page. "Removal is a move" restores the
same append-only-with-a-trace guarantee session.log and LOGBOOK.md already have; the global
page is the one surface on this machine where lines used to simply vanish.

## The clock-free reference date

Every other check in `lib/state.mjs` is reproducible from file bytes alone — no check reads
the clock (ADR 0004's module invariant) — and `closed-expired`/`thread-inactive` keep that
property by never consulting `now`. Instead, the **reference date** is the newest real
calendar date among the page's own non-placeholder Active-threads `(as of …)` and
Recently-closed `(closed …)` stamps — Watch and Backlog never carry this stamp convention, so
they are never counted either (#20d H52). This
makes "is X stale relative to the rest of this page" a self-contained, deterministic
question: the page ages against its own freshest edit, not against whatever day `state lint`
happens to run. The alternative — inject `now` — was rejected (see below).

The reference date is deliberately the **newest** stamp, not the first one encountered in
document order. Per-thread edits (ADR 0005) mean a session edits only the bullet it touches
and leaves every other bullet's position untouched — bullets land in whatever order sessions
happened to touch them, not date order. Using "the first stamp found" would make the
reference date depend on accidental bullet ordering rather than on what is actually most
recent.

## WARN, not FAIL, for all five

Four of the five need a model's judgment: which words to cut from an over-limit bullet,
whether an idle thread is genuinely done or just quiet, what a new Backlog line should say
once a thread moves there, and whether an undated closed line ever had a real date worth
restoring. A FAIL here would block automation on a judgment call, where `state lint`'s other
FAILs are all mechanically unambiguous — exactly the kind of noisy false positive ADR 0004
rejected a session-log FAIL over (it would FAIL routine, ordinary in-progress work).

`bullet-wrapped` is the odd one out: its fix — join the bullet back onto one line — is
mechanical, not a judgment call, so by ADR 0004's own tier definition it could be a FAIL.
It stays WARN anyway, for the same reason the other four do: a wrapped bullet is still
readable and still says what it says, just not yet in the one-line shape this canon wants,
so it is residue to clean up rather than a broken invariant. The page-wide `over-cap` FAIL
remains the actual backstop: it still fires regardless of these five, so a page can never
silently exceed the one hard limit this canon has always had.

## `(closed YYYY-MM-DD)` reuses the Active-threads stamp machinery

Rather than re-deriving shape/case/real-date validation for a second stamp convention, the
Recently-closed `(closed …)` stamp is parsed by the exact same hardened regex shape and
`isRealCalendarDate` round-trip the Active-threads `(as of …)` stamp already uses — only the
keyword differs. A bullet carrying more than one valid stamp of either kind compares against
the OLDEST one — conservative, the same OLDEST-wins rule ADR 0004's review hardening (its
finding F6) already established for the Active-threads freshness stamp: if any reading of a
multi-stamped bullet could be expired/inactive, treat it as such.

## The Recently-closed placeholder's wording changes; the old text stays recognized

The bootstrap placeholder for `## Recently closed` changes from a bare pointer-only phrase to
one naming the new `(closed YYYY-MM-DD)` convention. Placeholder detection
(`loadPlaceholderPatterns`) dynamically reads the shipped templates at runtime, so without
further action an already-installed page still carrying the OLD placeholder text would stop
being recognized the moment the template changes underneath it — a false `closed-undated`
WARN on a page that never had anything to report. A small, hardcoded
`LEGACY_PLACEHOLDER_PATTERNS` list (just the one retired bullet, byte-exact) is checked
alongside the dynamically-loaded current set, so an un-migrated page keeps linting clean.

## #20b review: three corrections

A 5-dimension adversarial review of the shipped #20 lanes found one root cause behind most
of its 61 findings: the archive tried to handle arbitrary markdown structure that the global
page never actually needs. Three decisions fix that, instead of patching each finding one at
a time.

### D1 — one physical line per bullet, not a greedy span

The original `topLevelBulletRanges`/`topLevelBulletSpans` helper was too greedy: it walked
forward through anything that wasn't the next top-level bullet, so a bullet followed by a
sub-heading, a `---` rule, or an unrelated paragraph several lines down could get silently
folded into the same "bullet." Replaced with a narrower rule: a bullet's continuation lines
are the non-blank lines directly after it that are NOT a heading of any level, a thematic
break (`---`/`***`/`___`, 3+), a fence opener, an HTML-comment-only line, or another
top-level bullet; plus, after a blank line, lines indented 2+ spaces or a tab (a loose
item's next paragraph). Anything else ends the bullet.

Two things follow. `line-over-limit` now measures ONLY the bullet's own physical line; a
bullet that wraps is reported once, by the new `bullet-wrapped` WARN, not folded into the
length of whatever it used to swallow. And `banana state archive --match` only ever moves a
single physical line: if the matched bullet has continuation lines, the command refuses
(exit 2, "bullet spans N lines; join it into one line first") instead of guessing how much
of the following text belongs to it — the archive never moves more than one line.

### D2 — HTML comments blank only the comment span

`blankNonSemanticRegions` used to blank the WHOLE line wherever `<!--` appeared, so a real
bullet that merely carried an inline comment (`- **name** ... <!-- note --> → pointer`)
vanished from every check, not just the commented-out part. Narrowed to blank only the
comment itself: text before `<!--` on the line that opens a comment, and text after `-->` on
the line that closes one, both survive; a line sitting entirely inside a multi-line comment
still blanks in full; several comments on one line all go. A line that is ONLY a comment
(`<!-- ## Next -->`) still blanks to nothing — the existing commented-heading hardening is
unaffected.

### D3 — the archive command is the clock-aware safety gate

`state lint` stays clock-free (ADR 0004) — a mistyped future stamp can make it WARN an
entire page as expired or inactive, and that is an acceptable false alarm, because lint never
changes anything. `state archive` is where acting on a reason actually matters, so it is the
one place in this feature allowed to read the injected clock. For `--reason expired` it
refuses (exit 2) unless the MATCHED line's own `(closed …)` stamp really is more than 7 days
before today; for `--reason inactive` it refuses unless its `(as of …)` stamp really is more
than 30 days before today. A missing stamp refuses outright and suggests `--reason removed`
instead. The gate is LINE-SCOPED (#20d H17, revising the page-wide scan this ADR shipped
earlier): a future-dated stamp blocks the move only when it belongs to the MATCHED line
itself — the refusal names it, so the fix is "correct that stamp first," not "pick a different
reason." A future-dated stamp on any OTHER line never blocks the move: the gate's own verdict
is decided entirely by the matched line's stamp against the real clock, so a stray mistake
elsewhere cannot make that decision wrong, and the old page-wide refusal only blocked cleanup
until someone else's unrelated mistake happened to get fixed. The command still proceeds in
that case and prints one note naming the other line and its stamp (the same two non-placeholder
Active-threads/Recently-closed sections and keywords the reference date itself reads above, so
Watch and Backlog are never read either way, #20d H52), so its owner can be told. The stamp
parsing itself is not re-derived: `state archive` imports the same hardened parser
`lib/state.mjs` already exports for `(as of …)`/`(closed …)`, so there is only ever one
definition of what a valid stamp looks like.

## Consequences

- A session doing `banana state archive` after a `line-over-limit`/`closed-expired`/
  `thread-inactive` WARN leaves a permanent, greppable trace of what left the page and why —
  the counter-failure this whole ticket exists to fix.
- `thread-inactive`'s remedy is two steps, not one: archive the thread bullet, then add a
  one-line Backlog item naming what it's waiting on. The check only flags the first half;
  a model does the second.
- Exception to ADR 0005's "edit only your own threads" rule: any session may archive an
  `expired` Recently-closed line on sight — recognizing one needs no judgment (a date
  comparison, not a content decision) — unlike `trimmed`/`inactive`/`closed`/`removed`, which
  still want the touching session's own judgment about what to keep.
- The kit's "never rewrites their content" promise for user-owned surfaces (`canon/
  CONTINUITY.md`'s "Upstream and sync") gets its one exception here, introduced by this ADR,
  not merely extended by it: `state archive` may remove exactly the one line its caller named
  from the global page, and write back that section's placeholder line when the removal
  empties it — the only kit-written edit to user-owned content this canon permits (owner
  ruling, 2026-10-02; #20d H22).
- D1 makes the one-line rule mechanical instead of aspirational: a bullet that wraps is
  flagged (`bullet-wrapped`) the moment it happens, not discovered later as a mysterious
  `line-over-limit` on the bullet it had silently swallowed.
- D3 means a WARN from `state lint` is advice, and a refusal from `state archive` is the
  actual backstop: a session can misread the page's own stamps, but it cannot archive
  something as `expired`/`inactive` that the real calendar disagrees with.

## Considered options

- **Raise the cap** — rejected: only defers the problem, and a bigger page costs every
  session that reads it at BEGIN (the entry ritual's hot-surface read, canon v1.1) even when
  most of it is stale residue nobody needs.
- **A page-rewriting `trim` command** — rejected: a command that reads the whole page,
  shortens several lines, and writes it back is exactly the whole-page-write failure mode
  ADR 0005 already retired (two sessions writing in the same window silently drop each
  other's edits). Per-bullet archive, matched by a case-sensitive substring of the bullet's
  own line and guarded by a read-unchanged-before-write check, keeps the same per-thread-edit
  safety ADR 0005 established.
- **Pointers-only provenance** (cite a session.log/LOGBOOK id instead of copying the bullet's
  text) — rejected: machine-grain Backlog/Watch items and quick Recently-closed notes often
  have no project logbook to point into at all; copying the verbatim text into the archive
  needs no such pointer to exist.
- **Wall-clock lint** (have `state lint` itself read `now` instead of deriving the reference
  date from the page's own stamps) — rejected: every other check in this module is a pure
  function of file bytes (ADR 0004); a clock-dependent lint would make its verdict depend on
  the moment it happened to run, not on the page's own content, and would need `now` threaded
  through a module that otherwise never needs it. The clock lives in `state archive` instead
  (D3), the one command where acting on a reason actually needs it.
- **Outlier heuristics** (flag a bullet as bloated by comparing it against the page's own
  average length, instead of a fixed per-section number) — rejected: a heuristic like that
  moves with whatever else is on the page, so the same bullet can flip between WARN and PASS
  as unrelated bullets are added or archived elsewhere — not reproducible from the bullet's
  own bytes, and harder for a model to act on than a fixed number it can quote back in the
  remedy message.

## #20c re-review: comments, stamps, and the archive's own edges

A second adversarial review (76 fresh findings plus a completeness pass) found the shipped
#20b lanes correct in shape but unpinned or slightly off at the edges: comments, stamps,
empty bullets, and the archive's own write path each had one case the first pass missed.
Thirteen decisions, grouped by what they touch.

**E1 — comments and the raw line.** The lint's printed excerpts are cut from the RAW page
line, comment included, so a printed excerpt is always a literal substring of the line the
archive matches against — pasting an excerpt back as `--match` must always work. The lint's
stamp parsing and the archive's D3 clock gate both read the same PREPARED line
(comment-stripped, code-span-masked), so the two can never reach a different verdict about
what a stamp says. The archive refuses outright a line that opens or closes a multi-line HTML
comment (an unclosed `<!--`, or a bare `-->` with no `<!--` earlier on the same line):
removing that line would either re-expose commented-out content below it or swallow real
content the comment never meant to hide. A comment that both opens and closes on the same
line is ordinary and fine.

**E2 — the one-line rule's continuation lines, refined.** After a bullet, every line indented
two or more spaces, or a line starting with a tab, is a continuation line no matter what it
holds — an indented fence, an indented fence's body, even an indented comment. Only column-0
structure ends a bullet: a heading, a thematic break, a fence opener, a line that is only a
comment, another top-level bullet, or a blank line followed by a line that is NOT indented. A
comment-only line never counts as the blank-line separator a loose item's next paragraph
needs.

**E3 — empty bullets aren't bullets.** A bullet line that is empty once its comment is
stripped (`- <!-- note -->`) is not a bullet at all, in project or global mode — there is no
marker, no text, nothing to measure or archive. A template placeholder that itself carries an
inline comment is still recognized as a placeholder. `- - -`/`* * *` are thematic breaks, not
three one-character bullets.

**E4 — code spans follow the real CommonMark rule.** A run of N backticks opens an inline
code span that only a later run of EXACTLY N backticks closes; a run with no matching close
is literal backtick characters, not a span. A stamp sitting inside a real span is ignored, as
before — but an unmatched, unpaired backtick no longer hides every stamp after it on the
line, which the simpler "odd backtick count" rule used to do by accident.

**E5 — the archive's write path gets the same hardening a real file-write tool needs.**
Before writing, the archive resolves the page's real path (following symlinks) and writes its
temp file next to that real file, and refuses a page that has more than one hard link (a
rename there would not do what the caller expects). A rename that fails with
`EPERM`/`EACCES`/`EBUSY` is retried with short backoff, up to about two seconds total —
Windows antivirus scanners and search indexers hold files open just long enough to make an
un-retried rename flaky. Before it appends anything, the archive skips the append when the
archive file's last record is already byte-identical to the one it is about to write, so a
retried run — or two concurrent, identical runs — never writes the same record twice. If the
rename still fails after all that, the temp file is unlinked and the refusal says plainly: the
archive already holds the record, the line is still on the page, and simply running the
command again will not duplicate anything.

**E6 — the headers name the one exception.** The page header's "never delete a line" promise
and the archive header's "append-only" promise both now name the one case where a line really
is deleted outright rather than moved: a pasted secret. See the Global-grain template and the
by-hand archive header in `canon/CONTINUITY.md` for the exact wording.

**E7 — a WARN-only lint gets one line in `brief` and `log close`, not a wall of text.** When
the global lint's verdict is WARN-only (no FAIL), `brief` and `log close` collapse their
`## State lint` output to one line: the verdict, a count per finding type, and a pointer to
`banana state lint --global` for the rest. A FAIL finding still prints in full, every time —
this collapse is about saving space on ordinary, non-urgent residue, never about hiding a real
defect. Standalone `banana state lint` is unaffected; it always prints every finding.

**E8 — one tag validator, reused.** `state archive --tag` is checked by the exact same
validator `banana log` already uses for its own `--tag` flag, rather than a second,
possibly-different rule. A `--match` or `--tag` value that is empty or made of nothing but
whitespace is a usage error, the same as a missing flag.

**E9 — the owner comes from the header's own sentence shape.** The owner substituted into a
re-inserted placeholder is read off the page header's literal `Owner: <name>. Protocol:`
phrase — the name is everything between `Owner: ` and the `. Protocol:` that follows it, not
just up to the first period, so a name like "Jane Q. Public" survives whole instead of
truncating at her middle initial. No match on that shape leaves the template's own placeholder
token in place, which the lint already treats as an acceptable, unowned placeholder.

**E10 — one stamp-selection rule, not two.** When a line carries more than one valid stamp of
the same kind, the archive's D3 clock gate reads the SAME stamp the lint's own WARN already
picked (the oldest valid one), instead of a second, independently-invented rule. Before this,
the two could disagree about which stamp governs a multi-stamped line, so the gate could
refuse to archive a line the lint had already told the caller was expired.

**E11 — filling in a placeholder is not a removal.** Adding a section's first real bullet,
where only the bootstrap placeholder stood before, deletes that placeholder line — but this is
not "content leaving the page" in the sense the archive rule exists to catch. Nothing was ever
there to lose; the archive move applies to real text leaving the page or being trimmed, never
to a placeholder giving way to the content it was always inviting.

**E12 — one plain sentence instead of per-shell quoting rules.** Rather than teaching
`--match` quoting rules for PowerShell, cmd.exe, and POSIX shells separately, the help text
says: pick a short, distinctive substring with no quotes, `$`, `%`, or backticks in it, and
gives one example per shell. Usage-error causes are named in plain words in the same help
text, never by an internal label like "D1".

**E13 — the clock gate and the page rule, stated side by side.** Both halves of this
feature's clock design are spelled out together, in matching words, in the canon and in
`docs/DESIGN.md`: `banana state lint` never reads the clock — every verdict, including
`closed-expired`/`thread-inactive`, is a pure function of the page's own newest stamp — while
`banana state archive` is the one place that does read the real clock, for its `--reason
expired`/`--reason inactive` gate. The two can disagree (see the clock-aware gate bullet in
the canon's Global grain): a line lint already WARNed as expired is not automatically
eligible for `--reason expired`, and vice versa.

## #20d verification: eight corrections

A third adversarial pass re-checked the #20c fixes against the real repo and found 14 fresh
findings on top of the re-review's own leftovers. The owner's 2026-10-02 ruling (fix what is
real, accept the exotic tail, verify) resolved eight of them with a real behavior change, split
across the lint module (`lib/state.mjs`), the archive module (`lib/state-archive.mjs`,
`bin/banana.mjs`), and this document.

**G1 — no write over a concurrent edit.** The rename retry (see "Atomic write and the two
re-read guards" in `docs/DESIGN.md`) re-runs the page's bytes-unchanged guard before EVERY
rename attempt, not only once before the retry loop starts. On a change mid-retry it stops,
unlinks the temp file, and exits 2 — the archive already holds a copy, the line is still on
the page, and a rerun is safe.

**G2 — no "delete by hand" remedy.** A failed rename or a re-read guard tripping never tells
the caller to delete the line by hand — that would contradict "never delete a line." The
remedy is always "rerun the command"; the archive's own duplicate-record skip (E5) is what
makes a rerun safe.

**G3 — comment boundaries respect fences.** The archive's "does this line open or close a
multi-line comment" check now shares the SAME fence-aware scan the lint's own
`blankNonSemanticRegions` uses: a `<!--` or `-->` sitting inside a fenced code block is literal
text, never a comment boundary, to either tool. Before this, a fence anywhere above a matched
line could make the archive falsely refuse a line that has no comment at all.

**G4 — a multi-word owner needs real authority.** A multi-word Backlog owner token is accepted
only when it equals the GLOBAL page's own declared owner (the header's `Owner: <name>.
Protocol:` line) or is a recognized agent tag; any other multi-word token falls back to the
single-word rule and is unowned. Closes the gap where a line merely shaped like `name — text`
(`- review the draft — waiting on the vendor`) read as owned on the strength of looking like a
name. PROJECT pages carry no declared-owner header, so this comparison has no source there — a
multi-word owner on a project `## Next` is unowned unless it is a recognized agent tag, even
when it is spelled exactly as the page's own `--owner` value (#20e F2; see Known limits below).

**G5 — whitespace-only is blank.** A line of nothing but spaces or a tab, directly after a
bullet, is a blank line for the one-line rule's continuation check — never a continuation line
in its own right, whether or not the line after it is indented.

**G6 — hard links, scoped to real replacement.** The hard-link refusal now only blocks a move
that would actually replace the page (every reason except `trimmed`, and never under
`--dry-run`): a rename over a hard-linked page would silently detach one copy from the other,
but `trimmed`'s copy-only write and a `--dry-run` preview never touch the page at all, so a
hard link blocks neither.

**G7 — archive line endings, chosen from the archive itself.** A new record's line ending
comes from the archive file's OWN existing line breaks whenever it already has real content;
only a genuinely blank archive (missing, empty, a lone BOM, or nothing but line breaks) falls
back to the page's own dominant ending. Both directions are pinned: a non-blank archive's
ending always wins over the page's, and a blank one always takes the page's.

**G8 — a symlinked page stays covered.** A test creates a symlinked global page (skipped where
the platform refuses `fs.symlinkSync`, e.g. Windows without developer mode) and pins that the
write path resolves and guards the REAL file the symlink points at, never the symlink's own
directory entry.

Each of G1–G8 is pinned by its own test in `test/state.test.mjs` or
`test/state-archive.test.mjs`; this section is the normative record of what changed and why,
alongside the matching `docs/DESIGN.md` contract text.

## Known limits (accepted)

The owner's 2026-10-02 ruling on the re-review fixed what mattered and the cheap test gaps,
and routed the rest here rather than letting it block the release. Each of these is a real,
reproducible edge case; none of them corrupts data or breaks an invariant this canon claims to
hold.

- An archive file saved as UTF-16 (or any non-UTF-8 encoding) still gets its new records
  written in UTF-8 — the kit only ever writes UTF-8, and never converts an existing file's own
  encoding.
- The atomic rename that replaces the page takes on its containing directory's default file
  permissions and attributes, not the replaced file's own.
- Two Recently-closed or Backlog lines that happen to share their first 60 characters print
  the same excerpt in a finding or an ambiguity list; pass a longer, more specific `--match`.
- Two concurrent runs by different agents, racing on the exact same move, can each append
  their own archive record for that line before either one's rename lands — a harmless
  duplicate copy, not data loss; the exact same record written twice by one retried run is
  still caught and skipped (E5).
- The machine-wiring roster still tells agents about `state lint` only; teaching it `state
  archive` too would mean re-fencing every already-wired instruction file on every machine for
  one line. Agents learn `state archive` from the page header and the canon instead.
- A global page created before v1.7 keeps its old header text; no kit command rebuilds or
  migrates an existing page's header — `init` only ever CREATES `~/.agents/STATE.md` when it is
  missing (`lib/init.mjs`'s `createIfMissing`), it never rewrites one that already exists, and
  `sync` never touches user-owned surfaces like `STATE.md` either. The only way an old header
  picks up the new lines is for an agent to edit the header by hand — there is no automatic or
  command-driven migration (#20e F3).
- A project page's `## Next` owner check has no declared-owner header to compare against — only
  global pages carry an `Owner: <name>. Protocol:` line (see G4 above). A multi-word human
  owner on a project `## Next` (`- Jane Doe — fix the build`) is therefore unowned unless it is
  a recognized agent tag, even when `banana project --owner "Jane Doe"` wrote that exact name
  into the `## Next` placeholder it then rejects in real use (#20e F2).
- A "blank" archive that holds nothing but line breaks (no real content) takes the PAGE's own
  line ending, not its own existing break characters — G7's blank/non-blank branch treats a
  breaks-only file as blank (#20e, H65).
- A wrapped continuation line that starts with a number and a period (e.g. a bare year) can
  read as a numbered list marker rather than prose — rare, and now visible anyway through
  `bullet-wrapped` and the other WARNs it would also trip.
- The **reference date** — the newest valid stamp among a page's own `(as of …)`/`(closed …)`
  lines — can move BACKWARD the moment the bullet carrying that newest stamp is archived away:
  the next-newest remaining stamp becomes the new reference date, and a `closed-expired` or
  `thread-inactive` WARN that depended on the old, later reference date can simply vanish until
  the next write changes it again. This follows directly from defining the reference date off
  the page's own content rather than the clock (see "The clock-free reference date" above),
  and is accepted rather than fixed.
