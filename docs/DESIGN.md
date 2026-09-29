# banana — design spec (authoritative for this build)

> The task packet at `.agents/goal/packet.md` holds the done-whens. This file holds the WHY and the
> exact behavioral contracts. A fresh-context iteration reads both before implementing anything.

## What banana is

A harness-neutral continuity kit. It installs a file-based coordination protocol shared by every
AI agent (Claude Code, Pi, Codex, Hermes, …) and human on a machine, so that work survives session
death and no agent's private memory becomes load-bearing. Five commands: `init` (machine wiring),
`project` (repo init), `brief` (per-intent context compiler), `doctor` (audits), `sync` (propagates
upstream canon and wiring changes).

## The architecture being shipped (canon v1.3)

The protocol's v1 lives at the canon source paths listed in prd.json. v1.1 adds the
**pollution-control architecture**:

1. **Hot/cold surface tiering.** Hot = auto-loaded every session: projections only (global STATE,
   project STATE), one page each, facts only. Cold = chronology and entry bodies (LOGBOOK.md,
   session.log bodies): never auto-loaded, grep-on-demand only.
2. **Closed allowlist entry ritual.** A session reads exactly: its compiled brief (see below).
   Nothing else by default. Counter-failure: anything visible gets woven into plans, so relevance
   filtering must happen before context load, not after.
3. **Headings-not-bodies.** For other agents'/features' in-flight work, a session may see entry
   HEADINGS (awareness that work exists) but not bodies (no exposure to approach). Counter-failure:
   anchoring on another session's approach.
4. **48h ghost rule.** A `STATUS: in-progress` entry older than 48h is a ghost: flagged in briefs
   and by doctor; the next session in that project closes it as `abandoned` via a superseding
   entry. Counter-failure: dead claims steering live sessions.
5. **Snapshot session lifecycle (BEGIN/WORK/CLOSE).** BEGIN: declare intent (feature slug), compile
   brief, treat it as a snapshot. WORK: no mid-session re-reads of shared state; the session's own
   open log entry is the cohesion anchor (re-read it after compaction). CLOSE: land the plane —
   close entry with owned NEXT, promote project-worthy events, rebuild stale projections; conflicts
   with concurrently-landed work reconcile here, not mid-flight. Counter-failure: shared files
   changing under a session mid-task.
6. **Preserved v1 invariants** (unchanged, restated in canon): append-only + `SUPERSEDES:`
   corrections, agent attribution in every entry, owned `NEXT:`, rebuild-don't-patch projections,
   pointers-not-payloads, event-triggered writes.

Canon v1.1 must carry a "Changes from v1" section listing exactly the additions above.

### v1.2 additions

v1.2 adds the **agent-first bootstrap and upstream model** on top of v1.1; nothing from v1.1 is
removed. Mirrors canon's "Changes from v1" items 9-12 (`canon/CONTINUITY.md`):

9. **Agent bootstrap section.** A zero-context agent self-initializes any bare workspace (git repo
   or non-code topic dir) from the canon alone: which files to create, the entry envelope, the
   session ritual. Counter-failure: cold landings producing ad-hoc or absent record-keeping.
10. **Upstream/sync surface ownership.** `~/.agents/canon/` is kit-owned and sync-overwritable
    (`sync` refreshes it freely); STATE pages, session logs, and logbooks are user-owned and never
    overwritten by the kit — created only if missing. Counter-failure: stale-protocol drift on
    wired machines, and updaters trampling user record surfaces.
11. **Version markers.** Every canon file opens with a machine-readable marker,
    `<!-- banana:canon rev X.Y -->`, giving `doctor` and `sync` a mechanical staleness check.
    Counter-failure: undetectable canon drift.
12. **Topic-grain workspaces.** A workspace needing continuity may be a git repository or a
    non-code topic directory (research notes, a course, an ops runbook) — the protocol and the
    kit's `project` command apply to both. Counter-failure: continuity gated on version control,
    leaving non-code work recordless.

Canon v1.2 carries these as part of the same "Changes from v1" section, numbered 9-12 following
v1.1's items 1-8.

### v1.3 additions

v1.3 amends the **project-STATE maintenance discipline** (ADR 0001,
`docs/adr/0001-state-rebuild-on-close.md`); nothing from v1.2 is removed. Mirrors canon's
"Changes from v1" item 13 (`canon/CONTINUITY.md`):

13. **Rebuild-on-close.** Project STATE pages only: mid-arc surgical section patches are legal,
    each ensuring the dirty-marker line (`> ⚠ patched since last rebuild — log is authority`) as
    the final line of the header block; the close-time rebuild's judgment-free trigger extends to
    promotion OR standing marker, and the rebuild removes the marker. Recovery is lazy: a standing
    marker obliges nothing at open. The global page is unchanged (rebuilt whole, never patched).
    Enforcement — doctor and `state lint` WARN on a standing marker — ships with the state-lint
    work, not this amendment. Counter-failure: per-touch rebuild cost driving silent
    rebuild-skipping; loud staleness (the marker) replaces silent staleness.

### v1.4 additions

v1.4 amends the **ghost surfaces** (ADR 0003, `docs/adr/0003-log-auto-continuation.md`); nothing
else changes. Mirrors canon's "Changes from v1" item 14 (`canon/CONTINUITY.md`):

14. **Supersession-aware ghosts.** An entry named by a `SUPERSEDES:` reference is retired from
    ghost surfaces (brief, doctor, by-hand scan) regardless of its own status line; the superseding
    entry carries the liveness clock and is itself subject to the 48h rule. Motivated by `log`'s
    auto-continuation (ADR 0003): without the carve-out, every continuation would manufacture a
    permanent false ghost from its predecessor. Counter-failure: zombie ghost flags on corrected
    history burying the real ones.

## `brief` — behavioral contract

`banana brief <feature> --tag <agent>` writes a brief to stdout, compiled from the project's
continuity files. Include / exclude:

| Include | Exclude |
|---|---|
| target feature's session.log entries, full bodies | other features' entry BODIES |
| headings only of the last 5 entries from other features | other projects' content |
| `NEXT:` lines owned by `--tag` or unowned | NEXT owned by other agents |
| project STATE.md verbatim (one page by contract) | global STATE (machine grain, not project) |
| ghosts: any in-progress entry older than 48h, flagged | Entries retired by a `SUPERSEDES:` reference are excluded (supersession-aware, canon CONTINUITY v1.4 / ADR 0003). |

Every section header carries a `ref:` line naming its source file (the brief is an index into the
record, not a replacement for it). Deterministic only — no LLM calls, pure text processing.

**`## State lint` section (#14).** Both modes (a compiled feature brief, and discovery mode with no
feature) print a `## State lint` section immediately after the brief's header block, before
`## Project state` / any other content — the brief is the session-start guarantee that a lint
nobody runs by hand still gets surfaced. Built from `lib/state.mjs`'s `collectStateLint({ cwd, home
})` (no subprocess, no argv parsing) and `formatStateLintLines`, so the finding text is byte-for-byte
the same `state lint` itself would print. Content, in order: a `project: <VERDICT> · global:
<VERDICT>` summary line (`<VERDICT>` is the lint's own summary text with no `state lint: ` prefix —
`PASS`, `WARN (N warn)`, `FAIL (N fail, M warn)`, `none (<reason>)` when the target page doesn't
exist, or `unreadable (<reason>)` when it exists but can't be read); then every finding line exactly
as `state lint` prints it, project findings first, then global (no findings — no extra lines); then,
only when either side's verdict is FAIL, one closing line: `Fix these before relying on the page: a
FAIL means STATE no longer projects its sources.` Lint never changes `brief`'s exit code or stops it
from printing the rest of the brief — an existing-but-unreadable STATE.md degrades to a `(STATE.md
exists but could not be read)` placeholder in `## Project state` rather than throwing. `brief`'s
runner takes an injected `home` (only `bin/` resolves `os.homedir()`), same as `state lint --global`.

## `doctor` — audit contract

Reports: detected harnesses; fence-block versions found in wired files. Audits (exit 1 if any hit):

- **Project liveness (v1.1):** in-progress entries older than 48h · unowned `NEXT:` lines ·
  project STATE.md "as of" older than the newest LOGBOOK entry date · any continuity file over 700
  lines. Entries retired by a `SUPERSEDES:` reference are excluded (supersession-aware, canon
  CONTINUITY v1.4 / ADR 0003).
- **Upstream staleness (v1.2):** `stale-canon` — the home canon dir (`~/.agents/canon/`) is missing,
  or an installed canon file's version marker is older than the kit's bundled canon · `stale-fence`
  — any wired fence block (home adapters plus the project's `AGENTS.md`) is older than its
  template's current version. Both findings name `sync` as the remediation.

`--verify` prints (never executes) per-harness headless recital commands.

## Adapter contract

Each adapter module exposes `detect(home)`, `describe()`, and either `wire(home, opts)` (file
adapters) or `compose(opts)` (write-through adapters). File adapters write ONLY via `lib/fence.mjs`
(insert-or-replace a version-marked block, `<!-- banana:begin vN -->` … `<!-- banana:end -->`,
creating the file if missing, preserving everything outside the fence byte-for-byte — idempotency
is THE contract: second run must be byte-identical). Every shipped wiring template
(`templates/wiring/*.md`) is currently fenced at `v2`. **Identity preservation (#16):** when a
fence-writing path rewrites or upgrades an EXISTING fence, it reads the agent tag and owner off
that fence's own identity line (`lib/fence.mjs`'s `readPreservedIdentity`/`extractIdentity` —
single-sourced there for every fence-writing path: `project`'s own `AGENTS.md` write, `init`'s
per-adapter wiring, and `sync`'s stale-fence upgrades) and carries them into the new block
unchanged, even as it upgrades everything else (version, template text). An explicit value the
command was given for this run (`project`'s and `init`'s `--tag`/`--owner`) wins over a preserved
one — `init` resolves this per adapter target, so a machine wired at different times with
different `--owner`/`--tag` values keeps each file's own identity independently; `sync` takes no
such flags, so a preserved value always wins there. No existing fence, or a fence whose identity
line can't be parsed, falls back to the command's normal default computation (`init`'s per-adapter
fallback is this run's resolved owner and the adapter's own default tag) — the unparseable case
also prints exactly one warning line naming the file, so identity loss is never silent. The hermes
adapter never writes files: it
composes a directive (sender header + protocol summary + agent tag) and the one-shot command
string; delivery only behind an explicit `--deliver` flag. Rationale: another agent's memory is
written through the agent, never at its files.

## `log` — write contract

`banana log stub|append|close|supersede` is the single writer of
`.agents/session.log`; lib/log.mjs owns zero grammar literals (heading
format, PHASE/STATUS vocabulary, ghost math all live in `lib/sessionlog.mjs`)
and orchestrates argv parsing, field validation, target resolution, and the
write itself. The concurrency model is protocol-visible — other harnesses
that write the log by hand build against these same rules:

- **Single-buffer, single-append atomicity.** Every invocation composes the
  full text to append (heading plus body lines, or checkpoint/close lines)
  as one string, then issues exactly one `appendFileSync` call. Never
  per-line writes, never read-modify-write of existing bytes — the file's
  prior content is read only to decide what to append, never rewritten.
- **No locks; collided-`n` is a soft error (canon §7).** `nextN` reads
  the active log plus every `.agents/sessions/*.log` archive and takes
  max(n)+1 at call time; two concurrent writers can race and land the same
  `n` for a feature. The tool does not retry or lock — a duplicate `n` is
  a recoverable, human-visible anomaly, not a crash.
- **Grep-unit adjacency + auto-continuation (ADR 0003).** append/close
  decide whether their target entry is still safe to append under by
  checking the file's last `/^## \[/` line (the same grep canon's own
  audits use), not the last *parsed* entry — a hand-mangled heading is
  invisible to the parser but still poisons the grep. When the target
  heading is no longer last, the tool writes the canon-prescribed
  continuation entry itself (new heading, `SUPERSEDES:` the entry left
  open above) instead of writing under a stranger's heading; `--no-continue`
  opts out with a refusal (exit 2) instead of writing anything.
- **Never creates files.** A missing `.agents/session.log` (or a
  legacy-only log) is a state error naming `banana project` as the fix —
  `log` never creates the file or the `.agents` directory.
- **Never rewrites existing bytes.** Every write is an append past the
  current end-of-file (after sniffing the file's EOL style and separator
  needs); no existing line is ever edited or removed.
- **Never touches legacy logs.** `.claude/session.log` (the pre-v2
  grammar) is read-only historical context to `doctor`/`brief` at most and
  is never scanned by `nextN`/`loadSessionHistory` and never written.
- **Post-close state-lint early catch (#14).** After a SUCCESSFUL,
  non-dry-run write that leaves an entry in a terminal status —
  `log close` (always terminal by construction; `in-progress` is rejected
  earlier), or `log stub` with a terminal `--status`
  (complete\|blocked\|abandoned) — `log` prints the same
  project+global verdict/finding content as `brief`'s `## State lint`
  section (`lib/state.mjs`'s `formatStateLintLines`), with no markdown
  heading (log's other output is plain status lines, not a markdown
  document). Never changes `log`'s exit code — a FAIL verdict still exits 0
  on a successful write. `--dry-run` never lints (nothing was closed).
  `--quiet` suppresses ONLY the summary line, and only when both project and
  global are PASS or the target page doesn't exist — findings and the
  fix-it closing line always print regardless of `quiet`. `append`,
  `supersede`, and a non-terminal `stub` never lint. `log`'s runner takes an
  injected `home` (only `bin/` resolves `os.homedir()`), same as `brief`.

## `state lint` — verdict contract

`banana state lint` mechanically lints a STATE.md page against the canon's
invariants — **lint never grades content.** Every verdict is reproducible
from file bytes alone, so no check ever reads the clock (no `now` is
injected anywhere in `lib/state.mjs`). Verdict tiers:

- **FAIL** — a mechanical invariant is broken.
- **WARN** — ambiguous residue a model should look at.
- **PASS** — neither.

**No-print data seam (#14).** `collectStateLint({ cwd, home })` runs both project and global lint
without printing, returning `{ project, global }`; each side is `{ verdict, findings }` (found and
linted — `verdict` is the summary text with no `state lint: ` prefix, `findings` are pre-formatted
`TIER [type] <file>: message` lines, FAILs first), `{ none: reason }` (the target file doesn't
exist), or `{ unreadable: reason }` (it exists but couldn't be read — `reason` is the exact message
`runStateLint` itself would print for that failure). `runStateLint` itself now routes through this
function — one code path for every consumer of finding text, CLI included.
`formatStateLintLines(collected, { quiet })` renders a collected pair into the printable lines
`brief`/`log` both use (see their own contracts above).

Exit codes: `0` PASS or WARN-only · `1` any FAIL · `2` usage error or the
target STATE.md is missing/unreadable. Output is one line per finding
(FAILs first, then WARNs), `FAIL [type] <file>: <message>` / `WARN [type]
<file>: <message>`, then a final summary line — `state lint: FAIL (N fail, M
warn)` / `state lint: WARN (M warn)` / `state lint: PASS`. `STATE_CAP_CHARS`
(10000, ADR 0004) is measured after the full text-preparation pipeline below.

**Text preparation** (review hardening 2026-09-28; `lib/state.mjs`'s
`prepareText`, run before any check, including by `lintProjectState` and
`lintGlobalState` themselves — calling either directly on raw file content is
safe, not just going through `runStateLint`): normalize line endings (CRLF
**and** lone-CR old-Mac endings both become LF) and strip every U+FEFF
byte-order-mark (not only one at file start — a BOM glued directly in front
of a heading mid-document is just as real a character as one at position 0),
then blank fenced code regions (``` ``` ``` or `~~~`, matching delimiter,
unterminated blanks to EOF) and `<!-- ... -->` HTML comments (single- or
multi-line) — every line either touches becomes an empty line, so line
indexes stay stable and every check below sees only real page content, never
quoted example text or explanatory markup. A section heading (or an as-of/
stamp date, or the dirty marker, or the retired-header phrase) that exists
ONLY inside a fence or comment does not count; one that exists for real
elsewhere on the page is unaffected by a decoy copy sitting in a fence.

**Project mode** (`banana state lint`, default) lints `<cwd>/STATE.md`;
`<cwd>/LOGBOOK.md` and `<cwd>/.agents/session.log` are optional comparison
inputs (missing files skip the checks that need them, not a finding on their
own).

| Tier | type | Fires when |
|---|---|---|
| FAIL | `missing-section` | one of the six required headings (`## Now`, `## Truths`, `## Next`, `## Blocked`, `## Watch`, `## Dead ends`) has no matching heading line (qualifier-tolerant, below) |
| FAIL | `over-cap` | page length exceeds `STATE_CAP_CHARS` |
| FAIL | `unowned-next` | a top-level bullet in the `## Next` section (qualifier-tolerant, below) fails the shared owner matcher (below) |
| FAIL | `as-of-missing` | no `as of YYYY-MM-DD` date in the header, and it is not the fresh-page exception (bootstrap placeholder `as of (date)` with zero LOGBOOK.md entries) |
| FAIL | `as-of-malformed` | the header's `as of` value is date-SHAPED but not a real calendar date (`2026-13-45`, `2026-09-31`, ...) — mutually exclusive with `as-of-missing`: a malformed date IS an attempt, so it never also reports "missing" |
| FAIL | `stale-vs-logbook` | the as-of date is older than the newest LOGBOOK.md entry date (equal passes) |
| WARN | `stale-vs-session-log` | the as-of date is older than the newest `.agents/session.log` entry date (equal passes) — WARN, not FAIL: see ADR 0004 |
| WARN | `dirty-marker` | the standing rebuild-on-close marker (ADR 0001) is present |
| WARN | `retired-header` | the page still carries the pre-amendment "rebuilt whole, never patched" rule — this project-mode message points to ADR 0001 (rebuild-on-close); see the global-mode table below for the counterpart message (ADR 0005) |

**Heading matcher** (shared machinery — `missing-section` and locating a
section's body, e.g. `## Next`, for the owner-matcher scan, both use this
ONE matcher; a page qualifying its headings — `## Watch (tripwires ...)` —
must never silently skip a body scan, which would print identically to a
clean PASS). A `## <Name>` heading is present iff some (post-preparation)
line, trailing whitespace trimmed, matches `^## <Name>(?:\s.*)?$` with
`<Name>` regex-escaped: the exact section name, optionally followed by
whitespace and then any qualifier text. Real project pages qualify their
headings this way — `## Truths (durable studio doctrine)`, `## Watch
(tripwires — mirrored as ADR revisit-triggers)` both count as their section.
A name-glued suffix does NOT count: `## Watchlist` does not satisfy `Watch`,
`## Nextsteps` does not satisfy `Next` — the qualifier must be
whitespace-separated from the name, not appended directly onto it. (Fixed
2026-09-28, phase 1b: the original exact-line matcher false-positived
`missing-section` on three real pages that qualify their headings — see ADR
0004.) A **duplicated** heading is scanned under every occurrence, not just
the first (review hardening 2026-09-28) — a second `## Next` block's bullets
are not silently invisible to the unowned-bullet scan. A section's body ends
at the next heading of level 1 or 2 (`# ` or `## `) — a deeper `###`/`####`
heading or a `---` rule does not end it (also review hardening: the original
boundary check only recognized `## `, letting a bullet after a later `# `
H1 bleed into the wrong section's scan).

**Owner matcher** (shared machinery — project `unowned-next` and global
`backlog-unowned` both use it): a top-level bullet is 0-1 leading spaces,
then `-`, `*`, `+` or a numbered marker (`\d+[.)]`), then a space or tab
(review hardening 2026-09-28 — originally only `^[-*] ` (dash/asterisk, no
`+`/numbered/indented forms); indented bullets (2+ spaces or a leading tab),
prose, blank lines and `###` sub-headings are still not top-level. A
placeholder is ONLY a bullet whose full (trimmed) text is byte-equal to one
of the literal bullets shipped in `templates/project-STATE.md` /
`templates/global-STATE.md` (any `__OWNER__` token in a template bullet
matches either the literal token or a real single-token owner, so a
freshly-bootstrapped page's substituted placeholders still count) — review
hardening 2026-09-28: "any bullet whose content starts with `(`" was too
broad and silently exempted real content
(`- (paused) rebuild the projection`) from every check. A non-placeholder
bullet is owned iff its content matches `owner — text` (em-dash U+2014), the
owner token itself carries no em-dash, and the owner token — after stripping
ONE layer of emphasis from each end (the alternation tries `***`/`___`
before `**`/`__` before `*`/`_`, so a triple-wrapped word unwraps in one pass
per side instead of needing an open-ended repeat that would also eat into a
literal word's own underscores) — is not `unowned` (case-insensitive) or the
literal `__OWNER__`. The literal, unsubstituted `__OWNER__` bootstrap
placeholder token is always unowned (checked before the placeholder-pattern
check, so its own wrapping underscores can't hide it from the comparison —
see `lib/state.mjs`'s `classifyOwnerBullet`).

**As-of / freshness-stamp date parsing** (shared `lib/doctor.mjs` helper
`stateAsOf`, single-sourced — review hardening 2026-09-28): searched only in
the HEADER block (every line before the first `## ` heading, after text
preparation above), case-insensitive `as of`, taking the LAST match in that
block — a header may legitimately mention an earlier date in prose before
its own real as-of clause, and body text (a `## Dead ends` sentence, say)
must never date an otherwise-undated page. A date-shaped value is validated
as a REAL calendar date (a `Date.UTC` round-trip — `2026-13-45`,
`2026-09-31`, `2026-02-30` all "succeed" at construction time but roll into a
different date rather than throwing); an impossible value is
`as-of-malformed`/`thread-stamp-malformed`, distinguishable from no date at
all. A bullet's freshness stamp (`(as of YYYY-MM-DD)`) reuses the same
real-date validation and is matched case-insensitively too (`(As of
2026-09-28)` counts) but is otherwise exact by design: `(as of 2026-09-28,
rebuilt)` is not a match — the closing paren must follow the date
immediately. If a bullet carries more than one stamp, the OLDEST one governs
staleness comparison (conservative: if any reading could be stale, treat it
as stale).

**Global mode** (`banana state lint --global`, #13) lints
`<home>/.agents/STATE.md` instead — a single input, no LOGBOOK.md/session.log
comparison (the global page has none). `home` is always injected through
`runStateLint`'s deps; `lib/state.mjs` never reads the real HOME itself, only
`bin/` resolves `--global`'s home to `os.homedir()`.

| Tier | type | Fires when |
|---|---|---|
| FAIL | `missing-section` | one of the four required headings — `## Active threads`, `## Backlog (owned)`, `## Watch`, `## Recently closed (context for next session)` — has no matching heading line (qualifier-tolerant, above; the parenthetical in the last two names is part of the required name, not an optional qualifier — a bare `## Recently closed` does not satisfy it) |
| FAIL | `over-cap` | page length exceeds `STATE_CAP_CHARS` (same constant, same measurement) |
| FAIL | `thread-unstamped` | a non-placeholder top-level `## Active threads` bullet has no `(as of YYYY-MM-DD)` freshness stamp |
| FAIL | `thread-no-pointer` | same bullet has no `→` pointer (independent of the stamp check — both can fire on the same bullet) |
| FAIL | `thread-stale` | the bullet's pointer resolves to a readable target STATE.md whose own as-of date is LATER than the bullet's stamp (equal passes); only evaluated when both a valid stamp and a resolved, dated target exist |
| FAIL | `thread-stamp-malformed` | the bullet's freshness stamp is date-shaped but not a real calendar date — mutually exclusive with `thread-unstamped`: a malformed stamp IS an attempt |
| FAIL | `backlog-unowned` | a top-level `## Backlog (owned)` bullet fails the owner matcher |
| WARN | `thread-unverifiable` | the bullet has a pointer, but it does not resolve to a readable file named `STATE.md` (a memory file, a missing path, a relative path, ...) |
| WARN | `thread-target-undated` | the pointer resolves to a readable STATE.md with no `as of YYYY-MM-DD` date (incl. the bootstrap placeholder) |
| WARN | `retired-header` | the page still carries the pre-amendment "rebuilt whole, never patched" rule — this global-mode message points to ADR 0005 (per-thread edits, #15) |

Global mode never flags `dirty-marker`: ADR 0005's per-thread edits (#15)
introduced no marker convention for a mid-arc patched global page, so there
is no standing-marker state to flag. It DOES flag `retired-header` (added by
#15): ADR 0005 (2026-09-29) retired the whole-rebuild rule in favor of
per-thread edits, so a page still carrying the old header is stale — the same
shape as project mode's own `retired-header` check, just pointing at a
different migration (ADR 0005, not ADR 0001).

**Pointer resolution.** Among every `→` in the bullet that is NOT inside a
backtick span (review hardening 2026-09-28 — an arrow quoted as example text
inside backticks, `` `a → b` ``, is not a structural delimiter), take the
LAST one whose target candidate looks like a recognized path form (`~/`,
`~\`, `X:\…`, `X:/…`, `/…`) — a trailing arrow in prose after the real
pointer (`(next: draft → review)`) does not win just for appearing last,
since its target doesn't look like a path. Only when NONE of the candidates
look like a path does resolution fall back to the very last one (which then
correctly resolves to unverifiable). For the chosen arrow: the target is the
first backtick-quoted span after it, else the first whitespace-delimited
token. `~/` or `~\` prefix resolves against `home`; absolute (`X:\…`,
`X:/…`, `/…`) resolves as-is; anything else is unverifiable. Both `\` and
`/` separators are accepted. A target that is a directory resolves to
`<dir>/STATE.md`. The resolved target must be named `STATE.md`
(case-sensitive) to be verified — otherwise `thread-unverifiable`.

**A bullet is scanned as ONE physical line, never joined with a following
line** (review hardening 2026-09-28, F14; canon: "one line per in-flight
project"). A stamp or pointer living on an indented continuation line, or on
a following unmarked line, is invisible to the checks above and the bullet
FAILs (`thread-unstamped`/`thread-no-pointer`) by design — a wrapped
Active-threads bullet is a defect to fix by putting it back on one line, not
something the linter reconstructs. The dirty-marker comparison
(`checkDirtyMarker`) is on `line.trim()`, not raw equality — a trailing
space or leading indentation doesn't hide a real marker, but no other
variation is tolerated (still byte-exact otherwise).

**Unreadable (but existing) LOGBOOK.md or session.log** (review hardening
2026-09-28): a file that exists but cannot be read (permissions, or it's a
directory rather than a file) is a disk-state precondition failure, same
tier as an unreadable target STATE.md — `runStateLint` reports it and exits
`2`, naming the file. It is never silently swallowed to "absent" (which
would silently drop `stale-vs-logbook`/its date comparisons).

## Hard rules for this build

- Zero runtime dependencies. Node >= 18, ESM (`.mjs`), built-in `node:test`.
- Every lib/adapters function takes an injectable root path — nothing reads the real HOME inside
  logic; tests run against sandbox temp dirs exclusively.
- Never write outside this repo and OS temp dirs. Canon source paths in prd.json are READ-ONLY.
- Placeholder tokens in templates: `__OWNER__`, `__AGENT_TAG__` only.
- Constants: ghost 48h, rotation 700 lines, fence markers as above.
