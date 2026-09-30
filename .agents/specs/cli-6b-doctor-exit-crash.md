# Spec — #6 follow-up: doctor crashes on exit after its real fetch (Windows)

Session entry: `.agents/session.log` cli.17 · Refs #6 (merged as 25147af).

## Observed (owner machine, Node v24.11.0, Windows, main at bab93aa)

`node bin/banana.mjs doctor` prints its audits, then
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`,
and exits **127** on every run, whether or not there are findings. doctor's contract is exit 0
(clean) or 1 (findings), so every run now breaks it. No test caught it because every doctor
test injects a fake fetch, and no test runs the real bin with a real fetch.

Hypothesis, to verify before fixing: `bin/banana.mjs` calls `process.exit(result.code)`
immediately after `runDoctor` returns. The global fetch (undici) keeps its connection alive, and
on Windows, `process.exit` while a libuv handle is closing trips the assertion. Candidate fix:
set `process.exitCode = result.code` and return, so the event loop drains; or make the doctor
fetch not keep the connection (for example, fully consume or cancel the body and send
`connection: close`). Choose by evidence, not by preference.

## Build

1. **A real-fetch regression test.** A test that spawns the real bin (`process.execPath
   bin/banana.mjs doctor`) in a sandbox project and HOME, with the origin URL pointed at a
   local `node:http` server the test starts on 127.0.0.1. It asserts the exit code is exactly 0
   for a clean sandbox (or exactly 1 with a seeded finding), stderr has no `Assertion failed`,
   and the process exits within 5 s. To point doctor at the local server, add an env override
   read only in `bin/banana.mjs` (e.g. `BANANA_ORIGIN_URL`) and pass it through the existing
   deps as the URL. Default: the current raw.githubusercontent.com URL. Document it in DESIGN.md
   as a test seam. This test must FAIL (127 / assertion) before the fix. If it does not
   reproduce against a local server, report that and stop; don't guess.
2. **The fix,** per the evidence. Also check whether the `advice:` line and a stalled or failed
   fetch still exit with the right code through the real bin: add one real-bin case where the
   local server returns a newer version (exit unaffected, advice printed), and one where it
   returns 500 (silent).
3. Check that doctor exits promptly (≤ 3 s after its output) on the success path. Draining the
   event loop must not wait out a keep-alive timeout.

## Gates

`npm run check`, and `timeout 300 rtk proxy npm test` (baseline 594). No external network in any
test: localhost only. Synthetic fixtures (public repo). Mutation check: restore the old exit
path and the regression test fails.
