# Spec — release 0.3.0 (#6 #8 #10 #17)

Session entry: `.agents/session.log` cli.17. The shim's drift detection (doctor's origin check)
compares version numbers, so a release that changes behavior must bump `package.json`
`version`, or older installs never hear they're behind.

1. `npm version 0.3.0 --no-git-tag-version`. This bumps package.json and both version fields of
   package-lock.json. Check the lock root name stays `banana-brain`.
2. `test/readme.test.mjs` (~:61-63) hard-codes `'0.2.0'` for `banana --version`. Make it read the
   expected value from package.json (the way test/bin.e2e.test.mjs reads `pkg.version`) and
   rename the test so it no longer names a version. Run it red first: bump before editing the
   test, see it fail, then fix it.
3. `.gitignore`: add `.claude/worktrees/` (agent worktrees live there; they must never be
   committed). Confirm with `git status --porcelain` that `.claude/` no longer shows as
   untracked.
4. Gates: `npm run check`, `timeout 300 rtk proxy npm test` (baseline 605 pass + 1 skipped).
   `node bin/banana.mjs version` prints `0.3.0`.

Touch nothing else. No commits.
