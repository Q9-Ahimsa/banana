# Spec — #6 re-review fixes (sync tree selection, taskkill, test integrity)

Session entry: `.agents/session.log` cli.17 · Refs #6 (25147af). A re-review of the first fix
round proved these against the shipped `lib/`. The findings are numbered as in the re-review.

## Code fixes (red-first, each)

**F1 + F7. The timeout guard keys on the install TARGET, with path identity normalized.**
`lib/sync.mjs` (~:168) currently treats "the resolved root fell back to kitRoot" as the global
path. On npx with nothing installed yet, `readKitVersion(installRoot)` is null, the root falls
back to kitRoot, and a timeout then skips the whole refresh. Sync becomes a silent no-op on
exactly the owner machine's configuration. Fix:
`const refreshingInstallTarget = installRoot === null || samePath(installRoot, kitRoot);`
where `samePath(a, b)` compares `path.resolve()` of both, lowercased on win32. An `installRoot`
of null (the lookup failed) stays conservative and skips. Tests:
- npx with nothing installed + timeout → the refresh proceeds from kitRoot;
- the same directory spelled with a different drive-letter case → counts as the same path;
- the global path + timeout → skipped with the warning.

**F2. Only an absolute `npm root -g` output is trusted.** Today
`join((stdout ?? '').trim(), own)` with empty stdout yields a RELATIVE path, resolved against
cwd, so canon and templates could come from a directory in the working dir. Fix:
`const rootOut = (stdout ?? '').trim(); if (rootOut !== '' && isAbsolute(rootOut)) installRoot = join(rootOut, own);`
Test: code 0 with empty stdout, and a planted kit-shaped dir in cwd → the planted dir is NOT used.

**F3. The taskkill child gets an `'error'` listener** (`lib/proc.mjs` ~:114): add
`tk.on('error', () => {});` beside `tk.unref()`. A taskkill that can't be spawned currently
crashes the CLI. Test: inject a nonexistent kill command, if the code has a seam for it;
otherwise add a minimal seam (an optional kill-command parameter used only by tests) and test
that makeExec still resolves.

**F4. Tree selection: a kit-shaped check, and the NEWER tree wins (orchestrator ruling).**
Adopt the resolved install tree only if it is kit-shaped: `package.json` readable,
`canon/<CANON_FILES[0]>` exists, `templates/wiring/` exists. Between the launched tree (kitRoot)
and a kit-shaped install tree, refresh from the one with the higher version
(`compareVersions`). On a tie, use the install tree, so the global path is unchanged. If either
version is unparseable, use the launched tree. Version line:
- `kit installed: v<after>` when nothing was installed before;
- `kit updated: v<before> -> v<after>` when the install tree's version rose;
- `kit current: v<x>` when unchanged;
- when the install tree ends up OLDER than the launched tree:
  `kit: the installed copy is v<old>, older than this run's v<new> — refreshing from v<new>`.

A non-kit-shaped install tree falls back to the launched tree and says so in one line. It is
never an exit-1 ENOENT. Change the fixture at `test/sync.test.mjs` (~:448: installed 0.9.9 vs
launched 1.0.0), which currently locks in the downgrade: it must now expect the launched tree's
canon and the older-install line. Tests:
- a non-kit-shaped install tree → falls back, exit 0;
- an older install tree → launched canon wins, and the line names both versions;
- a newer install tree → install canon wins;
- the first-ever install → `kit installed`.

## Test-integrity fixes

- **F5.** Six doctor origin-ahead tests assert only `!includes('origin-ahead')`, a string doctor
  no longer prints. Add `assert.ok(!captured.text().includes('advice:'))` to each: remote
  equal, remote older, non-2xx, rejecting fetch, stalled body, unreadable local version. Verify:
  a mutant that always returns the advisory now fails all six.
- **F6.** One S1 test's `npm root -g` fake must return `` `${prefix}\r\n` ``, proving the trim is
  load-bearing. Mutation: drop `.trim()` and that test fails.
- **F8.** Give the stalled-body test `{ timeout: 10000 }`, so a revert fails instead of hanging the
  file.

## Comment and doc drift (F9, F10)

- `lib/sync.mjs` ~:155-158: the "npx path … no change there" comment is false. Rewrite it to
  describe F4's selection.
- `lib/sync.mjs` ~:174: "refreshing from the installed kit" → name the tree actually used.
- `lib/wiring.mjs` ~:19-22 and ~:37-38: `wiringDir` is not "tests only"; sync passes it in
  production.
- `lib/proc.mjs`: add the trusted-fixed-arguments restriction to `makeExec`'s own JSDoc.
- `test/sync.test.mjs` ~:250-255: `rootLookupResolvesToNothing` returns `{code:1}`. Rename it
  and fix its docstring to "lookup fails".
- `.agents/specs/cli-6-shim.md` ~:64: `[origin-ahead]` → the `advice:` wording now shipped.
- F10: one comment line each on (a) a taskkill that exits non-zero being ignored, and (b) posix
  `detached: true` meaning Ctrl-C no longer reaches npm, so only the timeout stops it.
- `docs/DESIGN.md`: the sync contract states F4's selection rule and the version lines.

## Gates

`npm run check`, `timeout 300 rtk proxy npm test` (report the baseline you measure). Fake exec
and fetch only. Synthetic fixtures (public repo). Report the red run per code fix and a
mutation per code fix.
