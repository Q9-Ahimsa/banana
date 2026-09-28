# Spec — `banana state lint` (#9) + `--global` freshness check (#13)

Session: cli.9 (testagent, 2026-09-28). Tickets: GitHub #9, #13 (parent spec #3).
Repo map with literal code excerpts (dispatcher, `lib/log.mjs` DI + io pattern,
`lib/sessionlog.mjs` API, `lib/doctor.mjs` helpers, test patterns, canon text):
`banana-map.md` (orchestrator session scratchpad, not committed)
The source files themselves are authoritative over the map where they differ.

## Why

2026-09-28 the machine-grain page `~/.agents/STATE.md` was stale on 4 of 8
threads while its file date was 9 days old: every session re-wrote the one
bullet it touched and carried the rest forward. Two gaps: nothing checks a
project page against its own logs (#9), and nothing checks the global page
against the project pages it projects (#13).

## Contract (both modes)

- `banana state lint` — lints the project page at `<cwd>/STATE.md`.
- `banana state lint --global` — lints `<home>/.agents/STATE.md`.
- Verdict tiers: **FAIL** = a mechanical invariant is broken · **WARN** =
  ambiguous residue a model should look at · **PASS** = neither.
- Exit codes: `0` PASS or WARN-only · `1` any FAIL · `2` usage error or the
  target STATE.md is missing/unreadable. (Usage is 2, not 1, so exit 1 means
  FAIL and nothing else.)
- Output, through the injected io: one line per finding, FAILs first, then
  WARNs, each `FAIL [type] <file>: <message>` / `WARN [type] <file>: <message>`,
  with enough context to act (the offending line, trimmed to 120 chars; the two
  dates compared; the char count vs cap). Final line always:
  `state lint: FAIL (N fail, M warn)` / `state lint: WARN (M warn)` / `state lint: PASS`.
- **Lint never grades content.** Every verdict is reproducible from file bytes
  alone. No check may read the clock — so no `now` is injected; do not add one.
- DI shape follows `lib/log.mjs`: `runStateLint(flags, { cwd, io, home })`
  returning `{ code }`; `home` defaults to `os.homedir()` only in `bin/`.
- Normalize CRLF → LF before any check (Windows files).
- New module `lib/state.mjs` (exports the runner + the pure check functions);
  reuse existing helpers rather than re-deriving: `stateAsOf` and
  `newestLogbookDate` from `lib/doctor.mjs`; `parseSessionLog` /
  `latestEntryDates` from `lib/sessionlog.mjs`; the dirty-marker string and
  retired-header regex must be single-sourced — if they only exist in test files
  today, move them into `lib/` as exported constants and have
  `test/canon.test.mjs` / `test/templates.test.mjs` import them.
- `STATE_CAP_CHARS = 10000` — exported constant. Measured as JS string length
  after CRLF normalization. Decision record: no numeric cap existed anywhere;
  real project pages measured 1.4k–15k chars (median ~5.5k), so 10k fails only
  the one genuinely bloated page. Lines are not used: real pages have single
  lines up to 969 chars.

### Owner matcher (shared by project `## Next` and global `## Backlog (owned)`)

A **top-level bullet** is a line matching `^[-*] ` (no indentation). Indented
bullets, prose, blank lines and `###` sub-headings are ignored. For each
top-level bullet:
- Strip leading markdown emphasis (`**`, `*`, `__`, `_`) from the content.
- Bullets whose content then starts with `(` are template placeholders → skipped.
- Owned iff content matches `^(\S+)\s+—\s+\S` (em-dash U+2014), the owner token
  has no em-dash, and — after stripping trailing emphasis — is not `unowned`
  (case-insensitive) and not the literal `__OWNER__`.
- Otherwise → the unowned finding.
Real shapes the fixtures must reproduce: `- **ahimsa — piece-a: ...**`
(bold-wrapped), `- Kit-Owner — **SOLO LANE...`, `- **ahimsa/editor — SAVE...**`,
`- ahimsa+testagent — ...`, `- joint — ...`, `- **unowned** — Packet 4 ...` (FAIL).

## Project mode (#9)

Inputs: `<cwd>/STATE.md` (required), `<cwd>/LOGBOOK.md` (optional),
`<cwd>/.agents/session.log` (optional; resolve it the same way `lib/doctor.mjs`
does, including any legacy path doctor honors).

FAIL:
1. `missing-section` — each of `## Now`, `## Truths`, `## Next`, `## Blocked`,
   `## Watch`, `## Dead ends` must exist as a line (trailing whitespace ok).
   One finding per missing section.
2. `over-cap` — length > `STATE_CAP_CHARS` (10000 passes, 10001 fails).
3. `unowned-next` — per the owner matcher, over top-level bullets inside
   `## Next` (up to the next `## ` heading).
4. `as-of-missing` — `stateAsOf` finds no date. Exception: the header still
   holds the literal bootstrap placeholder `as of (date)` AND LOGBOOK.md has no
   entries (or is absent) → fresh page, no finding. Placeholder with ≥1 logbook
   entry → `as-of-missing`.
5. `stale-vs-logbook` — as-of date < newest LOGBOOK.md entry date (equal passes).

WARN:
6. `stale-vs-session-log` — as-of date < newest `.agents/session.log` entry
   heading date (equal passes). Deliberate deviation from #9's text ("session-log/
   logbook" both FAIL): canon's rebuild trigger is logbook promotion or a standing
   marker, so a newer unpromoted session entry is legitimate residue — a model
   call, not a defect. Record this in the ADR.
7. `dirty-marker` — a line byte-equal to `> ⚠ patched since last rebuild — log is authority`.
8. `retired-header` — `/rebuilt whole, never patched/i` anywhere in the page
   (project grain only — the migration backstop for #11).

## Global mode (#13)

Input: `<home>/.agents/STATE.md`.

FAIL:
1. `missing-section` — `## Active threads`, `## Backlog (owned)`, `## Watch`,
   `## Recently closed (context for next session)`.
2. `over-cap` — same constant.
3. `thread-unstamped` — a top-level `## Active threads` bullet (placeholders
   skipped) with no `(as of YYYY-MM-DD)` (regex `\(as of (\d{4}-\d{2}-\d{2})\)`).
4. `thread-no-pointer` — same bullet with no `→`.
5. `thread-stale` — the pointer resolves to a readable STATE.md whose
   `stateAsOf` date is LATER than the bullet's stamp (equal passes). Message
   names both dates and the path.
6. `backlog-unowned` — owner matcher over top-level `## Backlog (owned)` bullets.

WARN:
7. `thread-unverifiable` — the pointer does not resolve to a readable file named
   `STATE.md` (a memory file, a missing path, a relative path).
8. `thread-target-undated` — the target STATE.md has no as-of date (incl. placeholder).

Never flag `Rebuilt whole, never patched.` in global mode — correct at this grain.

Pointer resolution: take the text after the LAST `→` in the bullet; the target
is the first backtick-quoted span there, else the first whitespace-delimited
token. `~/` or `~\` prefix → `home`; absolute (`X:\…`, `X:/…`, `/…`) as-is;
anything else → unverifiable. Accept both `\` and `/` separators. A target that
is a directory → `<dir>/STATE.md`. Target must be named `STATE.md`
(case-sensitive) to be verified.

### Canon amendment (#13 only)

- `canon/CONTINUITY.md` global-grain template: the Active-threads placeholder
  becomes `- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)`,
  plus one prose bullet under the template: **Freshness stamp** — every
  Active-threads bullet carries `(as of YYYY-MM-DD)`, the newest source it was
  rebuilt from (normally its project STATE's as-of); a project STATE dated later
  than the stamp means the thread is stale, and `banana state lint --global` FAILs it.
- `templates/global-STATE.md` changes identically (existing tests likely assert
  the canon block and template agree — keep them agreeing).
- Bump the CONTINUITY version marker per the mechanism #5 used (commit `66cd7e7`
  is the pattern); add a changelog line in the same style.
- Canon/template tests updated and green.

## Docs

- `docs/DESIGN.md`: a `## \`state lint\` — verdict contract` section in the
  style of the doctor contract section (tiers, exit codes, every check by type).
- `docs/adr/0004-state-lint-verdict-tiers.md`: the three-tier contract, the 10k
  char cap and its evidence, logbook-FAIL vs session-log-WARN and why, usage exit 2.
- `CONTEXT.md` glossary: add **Freshness stamp** (with #13).

## Dispatcher + help (`bin/banana.mjs`)

- `state` command word, `lint` its only verb (room for more). Follow the `log`
  block exactly: usage strings live in bin (`STATE_USAGE`, `STATE_LINT_USAGE`),
  positional help detection only (argv[0] / argv[1]), `banana state` with no verb
  → usage on stderr, exit 2; unknown verb or flag → exit 2.
- Top-level help gains the `state lint` line; `COMMANDS` gains `state`.
- `STATE_LINT_USAGE` documents `--global`, the tiers and the exit codes.

## Tests (TDD — write each test red before the code that turns it green)

- New `test/state.test.mjs` at the lib seam, modeled on `test/log.test.mjs`:
  sandbox tmpdirs, injected io capturing output, injected `home` for global mode.
- Every invariant exercised AT its boundary: cap 10000 vs 10001; as-of equal to
  vs one day older than newest logbook/session date; stamp equal to vs one day
  older than target as-of; placeholder page with and without logbook entries.
- Tier assignment + exit codes: FAIL-only, WARN-only (exit 0), mixed (exit 1),
  clean (PASS), missing target (exit 2).
- Owner matcher: every real shape listed above.
- Global pointer resolution: `~/` with injected home, `~\`, absolute Windows
  path, directory → STATE.md, memory-file pointer → WARN, missing path → WARN.
- `test/bin.e2e.test.mjs`: dispatch + help slices only (`state`, `state --help`,
  `state lint --help`, no-verb exit 2) — follow the existing `log` slice.
- **Mutation check (mandatory, report it):** for each FAIL and WARN check,
  temporarily disable the check in `lib/state.mjs`, run its tests, confirm at
  least one goes red, restore. Report per check: `type → red test name`. A check
  whose tests stay green with the check disabled is untested — fix the test.

## Gates

`npm run check` (tsc --checkJs) and `npm test` (node --test) both green. Baseline
before this work: 315/315 tests. Report the new count. `git status --porcelain`
must show only files this spec names (plus the spec itself).

## Out of scope

No `doctor` changes. No auto-fix. No writes to any STATE page. No edits to
`.agents/session.log` (the orchestrator is its single writer). No commits, no
push — the orchestrator commits after verification.
