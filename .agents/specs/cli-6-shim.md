# Spec — #6: local install (shim), sync as the updater, doctor remote check

Session entry: `.agents/session.log` cli.16 · Ticket: GitHub #6 · Decision: `docs/adr/0002-local-shim-sync-as-updater.md`
Built in its own git worktree, in parallel with #8. Depends on `lib/version.mjs`
(`.agents/specs/cli-6-8-shared-version.md`), which is already on main.

## Ticket acceptance (verbatim, the contract)

- Sync runs a kit-update step (npm global install from the GitHub repo) via an injected exec,
  ahead of its existing canon/fence moves; canon and template content is read from disk after
  the update step, so a single sync run propagates freshly fetched content
- Kit-update failure (offline, npm missing) degrades to a warning; the local canon/fence refresh
  still proceeds; exit 0
- Doctor gains a best-effort remote version check via injected fetch: warns "origin is ahead —
  run banana sync" when the remote version is newer; completely silent on any network failure;
  never affects the exit code (existing local staleness audits keep their exit-1 behavior)
- Sync still never touches user-owned surfaces (STATE pages, session logs, logbooks) — the
  standing invariant is asserted in tests
- Install and update instructions documented where the current npx instructions live
- Tests use fake exec/fetch; no test touches the network or the real HOME
- Quality gates green: typecheck + full test suite

## A. Sync update step (`lib/sync.mjs`)

- `runSync(flags, deps)` gains two optional deps:
  - `exec(command, args)`, resolving (never rejecting) to
    `{ code: number | null, stdout: string, stderr: string, error?: string }`
  - `kitRoot`, defaulting to `KIT_ROOT` from `lib/version.mjs`
- When `deps.exec` is present, before the canon/fence moves:
  1. `before = readKitVersion(kitRoot)`
  2. `exec('npm', ['install', '-g', 'github:Q9-Ahimsa/banana'])`
  3. On `code === 0`: `after = readKitVersion(kitRoot)`. Print `kit updated: v<before> -> v<after>`,
     or `kit current: v<after>` when the two are equal.
  4. Otherwise (non-zero code, `error` set, or a spawn failure): print through `err` one line,
     `kit update skipped (<reason>) — refreshing from the installed kit`, where `<reason>` is
     `error`, else the first non-empty stderr line, else `exit <code>`. Continue. The exit code
     is unaffected.
- When `deps.exec` is absent, skip the step silently, so today's library callers and tests keep
  today's behavior.
- **Fresh reads after the update (the load-bearing part).** Every canon file and wiring template
  that sync uses must be read from disk during the run, after step 2. Check for anything read or
  cached at module load: adapter `describe().template`, `wiringTemplateVersion`, `CANON_FILES`
  content, and any `readFileSync` at top level. If you find it, move it to call time. Prove it with
  a test in which the fake `exec` rewrites a canon file and a template under a sandbox `kitRoot`
  (a copy of the kit's `canon/` and `templates/`), and sync then installs the rewritten content.
  That test must fail if the reads happen before the update.
- Known limitation, to be documented, not built around: a canon file or adapter that is *new* in
  a release is picked up on the next sync run, because the running process keeps its loaded file
  list.
- Real exec: a new `lib/proc.mjs` exports `makeExec({ timeoutMs = 120000 } = {})`. Build it on
  `node:child_process` spawn, with `shell: process.platform === 'win32'` (npm is `npm.cmd` on
  Windows). Capture stdout and stderr, resolve on `close` or `error`, never reject, and kill on
  timeout. Test it against a harmless local command (`node --version` → code 0, stdout starts
  with `v`) and a missing command (code non-zero or `error` set). No network.
- `bin/banana.mjs`: the sync branch passes `exec: makeExec()`.

## B. Doctor remote check (`lib/doctor.mjs`)

- `runDoctor(flags, deps)` gains optional `fetch` (the global fetch's shape) and `kitRoot`.
- When `deps.fetch` is present: GET
  `https://raw.githubusercontent.com/Q9-Ahimsa/banana/main/package.json` with a 2000 ms timeout
  (AbortController). Parse JSON, take `.version`, and compare it with `readKitVersion(kitRoot)`
  using `compareVersions`. If remote > local, print one advisory line AFTER the Audits block, set
  off by a blank line, in `advice: ...` style (never a bracketed finding): `advice: kit v<local> is
  behind origin v<remote> — run banana sync`.
- Any failure prints nothing: reject, timeout, non-2xx, bad JSON, a missing or unparseable
  version on either side, or remote ≤ local.
- The line is advice. It never counts toward the exit code: only-origin-ahead exits 0, and
  existing local findings still exit 1. Read the `doctor` contract in `docs/DESIGN.md` and fit
  the output to it.
- `bin/banana.mjs`: the doctor branch passes `fetch: globalThis.fetch`.

## C. Invariant tests

Sync, with a succeeding fake exec, a failing one, and none, leaves byte-identical every
user-owned file planted in the sandbox: a `STATE.md`, a `LOGBOOK.md`, a `.agents/session.log`
(at home and in a project dir under it), and `~/.agents/STATE.md`. Hash before and after.

## D. Docs

- `README.md`: an install section with the one-time `npm install -g github:Q9-Ahimsa/banana`,
  then `banana <command>` with no network, then `banana sync` to update. The `npx` form stays,
  labeled as the cold-bootstrap path.
- `docs/DESIGN.md`: the `sync` and `doctor` contracts, including the known limitation.
- If `CONTEXT.md` has a "Shim" glossary entry, keep it true.
- Do NOT change `templates/`, adapters' wiring text, or `canon/`. The bootstrap-block text is #10.

## Out of scope

Wiring template v3 (#10), installing on the owner machine (#11), and bumping `package.json`
`version`. The version bump is a release step the orchestrator does at merge.

## Method and gates

- Red-first. Tests for A–C before implementation, with the red run recorded. Mutation checks:
  (1) move a canon/template read back before the update and the fresh-read test fails;
  (2) let the origin-ahead line count toward the exit code and the exit test fails.
- Fake exec and fetch only. No network, no real HOME. Sandbox temp dirs via mkdtempSync.
- Follow existing patterns: injectable roots, all config writes through `lib/fence.mjs`.
  Synthetic fixtures only (public repo).
- Gates: `npm run check`, `npm test` (run through `rtk proxy npm test` so counts show).
