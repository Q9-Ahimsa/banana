# Spec — shared kit-version helper (pre-step for #6 and #8)

Session entry: `.agents/session.log` cli.16. Both #8 (the brief prints the kit version) and #6
(doctor compares the local version with origin's) need the same two operations. This module
lands on main first, so the two tickets can be built in parallel worktrees without each writing
its own copy.

## Build: `lib/version.mjs`

- `KIT_ROOT`: the kit's root directory, resolved as `lib/sync.mjs` resolves it today
  (`join(dirname(fileURLToPath(import.meta.url)), '..')`). `lib/sync.mjs` then imports it from
  here instead of defining its own. That is the only change outside the new files.
- `readKitVersion(kitRoot = KIT_ROOT)`: the `version` string from `<kitRoot>/package.json`,
  read from disk at call time (never cached at module load; #6 re-reads after an update). It
  returns `null` when the file is missing or unreadable, the JSON is malformed, or `version` is
  not a non-empty string.
- `compareVersions(a, b)`: `-1 | 0 | 1` for plain `MAJOR.MINOR.PATCH` versions, compared
  numerically part by part. One leading `v` is allowed on either side. It returns `null` when
  either side is not exactly three dot-separated non-negative integers, including any
  prerelease or build suffix (`0.3.0-beta`, `0.3`, `abc`, `null`).

JSDoc types on every export (`npm run check` runs tsc --checkJs).

## Tests: `test/version.test.mjs` (node:test + node:assert/strict, sandbox temp dirs)

- readKitVersion: a sandbox package.json with a version → that string; missing file → null;
  malformed JSON → null; `version` missing or non-string → null. The default argument reads
  the real kit's package.json and returns a string. This is read-only and allowed.
- compareVersions: `0.2.0` < `0.3.0`; `1.0.0` > `0.9.9`; equal → 0; `v0.2.0` vs `0.2.0` → 0;
  **`0.10.0` > `0.9.0`**, which a string compare gets wrong, so this test must fail against a
  lexical implementation; `0.3`, `0.3.0-beta`, `abc`, `null` → null.
- Red-first: write the tests, run them against a missing module (red), implement, green.
  Mutation check: temporarily swap the numeric compare for a string compare, confirm the
  `0.10.0` test fails, then restore.

Gates: `npm run check`, `npm test` (baseline 510 passing). Synthetic fixtures only: the repo is
public.
