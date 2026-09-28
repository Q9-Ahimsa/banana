# Spec — surface `state lint` in `brief` and `log close` (#14)

Session: cli.10 (testagent, 2026-09-28). Ticket: GitHub #14. Builds on #9/#13
(`lib/state.mjs`, commits 3526aed, bec16a1, 59ee912).

## Why

A lint nobody runs catches nothing. Closing a terminal window runs no code, so
a close-time check alone can't be the guarantee. `banana brief` is the first step
of every session in every harness, so the brief carries the verdict; `log close`
adds an early catch for sessions that do close cleanly.

## 1. `banana brief` — the guarantee

Both modes (with a feature, and discovery mode with none) print a `## State lint`
section immediately after the brief's header block (the `# brief — …` line and its
`>` lines), before `## Project state` / any other section.

Content, in this order:
- Summary line: `project: <VERDICT> · global: <VERDICT>`, where VERDICT is the
  lint's own summary without the `state lint: ` prefix (e.g. `FAIL (2 fail, 1 warn)`,
  `WARN (1 warn)`, `PASS`).
  - cwd has no STATE.md → `project: none (no STATE.md here)`.
  - `<home>/.agents/STATE.md` missing → `global: none (no ~/.agents/STATE.md)`.
  - A target that exists but can't be read (the lint's exit-2 path) → `project: unreadable (<reason>)` / `global: unreadable (<reason>)`.
- Then every finding line exactly as `state lint` prints it (`FAIL [type] <file>: …`,
  `WARN …`), project findings first, then global. No findings → no extra lines.
- When anything FAILs, one final line: `Fix these before relying on the page: a FAIL means STATE no longer projects its sources.`
  (keep this exact text; tests pin it).

Rules:
- Lint never changes `brief`'s exit code or stops it from printing the rest of the brief.
- Call the lib functions from `lib/state.mjs` directly — no subprocess, no argv parsing.
  If `lib/state.mjs` lacks a function that returns findings + verdict without printing,
  add one (e.g. `collectStateLint({ cwd, home })` → `{ project, global }`, each
  `{ verdict, findings } | { none: reason } | { unreadable: reason }`), and make the
  existing `runStateLint` use it so there is one code path.
- `brief`'s runner gains an injected `home`; only `bin/` passes `os.homedir()`.

## 2. `banana log` — the early catch

After a SUCCESSFUL write that leaves an entry in a terminal status — `log close`, or
`log stub` with a terminal `--status` (complete | blocked | abandoned) — print the same
`## State lint`-style block (summary line + findings + the FAIL line when relevant) via
the injected io, for the project at `cwd` and for the global page.

Rules:
- Never changes `log`'s exit code (0 on a successful write stays 0 even if lint FAILs).
- `--dry-run` → no lint (nothing was closed).
- `--quiet` → suppress the summary line when both verdicts are PASS or none;
  findings and the FAIL line always print.
- `append`, `supersede`, and non-terminal `stub` → no lint.
- `log`'s runner gains an injected `home`; only `bin/` passes `os.homedir()`.

## Tests (TDD — red first, then green; mutation-check each wiring point)

Follow the existing patterns in `test/brief.test.mjs` and `test/log.test.mjs`
(sandbox tmpdirs, injected io/home). Synthetic fixtures only (PUBLIC REPO: no real
project or person names, no real paths). Cover:
- brief: section placement (right after the header, before `## Project state`);
  all-PASS line; a FAIL project page (finding lines + FAIL line); a stale global
  thread; no STATE.md in cwd; no global page; unreadable target; brief exit code
  unchanged on FAIL; discovery mode also carries the section.
- log: close with a FAIL page prints findings, exit 0; terminal stub lints;
  non-terminal stub / append / supersede do not; `--dry-run` does not;
  `--quiet` hides the PASS line but not findings.
- Mutation check: remove the lint call from brief → a brief test goes red; remove it
  from log close → a log test goes red; remove the terminal-stub branch → red.
- bin e2e: one slice proving `brief` output contains `## State lint` (dispatch only).

## Docs

- `docs/DESIGN.md`: add the `## State lint` section to the brief contract and the
  post-close lint to the `log` write contract.
- `docs/adr/0004-state-lint-verdict-tiers.md`: add a `## Wiring (#14)` section — brief
  is the guarantee (survives a killed terminal, runs in every harness at session start),
  log close is the early catch; lint is advice, never a gate on these commands.

## Gates

`npm run check` and `npm test` green (baseline 451). Real-page smoke (read-only): run
`node bin/banana.mjs brief <feature> --tag testagent` in this repo (feature `cli`) and
in one other real project on the maintainer's machine (discovery mode is fine), and
paste the `## State lint` sections verbatim.

## Out of scope

No harness hooks (Claude `SessionEnd` etc.). No changes to lint rules. No canon
edits. No writes to any real STATE page or session.log. No commits or push.
