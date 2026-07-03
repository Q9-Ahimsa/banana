# PACKET — banana v1: harness-neutral continuity installer + brief architecture
> Compiled by /arm on 2026-07-03 from: "arm this, and make sure it's fully solid." — "this" being the
> session's design: an npx installer with harness auto-detection, plus the brief/snapshot continuity
> architecture (per-intent compiled briefs, hot/cold surface tiering, transaction-shaped sessions).
> This file is the task list AND the continuity interface. Read Goal + first unchecked task + last 3
> session-log entries to (re)enter the run. Mark tasks, never delete them. Evidence lines are mandatory.

## Goal
End state:    A git repo at C:/Users/VICTUS/projects/banana containing an npx-runnable Node CLI with four commands — init (harness auto-detect + idempotent wiring), project (project-grain init), brief (per-intent context compiler), doctor (wiring checks + liveness audits) — plus genericized canon docs (CONTINUITY v1.1 embedding the brief/snapshot architecture), templates, wiring blocks, README, and a green test suite; pushed to GitHub as Q9-Ahimsa/banana and runnable via npx from there.
Verify by:    `npm run check && npm test` from the repo root — exit 0, full output shown (typecheck gate + unit/integration suite incl. sandbox-HOME e2e and idempotency tests)
Do not touch: C:/Users/VICTUS/.claude/ (no writes), C:/Users/VICTUS/.agents/, C:/Users/VICTUS/.pi/, the Hermes home (C:/Users/VICTUS/AppData/Local/hermes/), any other project directory; no `npm publish`; all filesystem writes confined to the kit repo and OS temp/sandbox dirs.
Stop when:    all tasks checked + Verify passes, OR 45 turns/iterations elapsed, OR the same task hits BLOCKED twice

ASSUMED: New public GitHub repo Q9-Ahimsa/banana; NOT published to the npm registry in v1 (npx-from-GitHub only).
ASSUMED: Plain JavaScript, Node >= 18, ESM, zero runtime dependencies (prompts via node:readline); single dev dependency `typescript` for the `tsc --checkJs --noEmit` typecheck gate; tests via built-in `node --test`.
ASSUMED: v1 adapters: claude-code, pi, codex (file wiring) + hermes (write-through-agent: composes the one-shot directive, never writes her files). Cursor and all other tools get printed paste instructions only.
ASSUMED: The brief compiler is deterministic (grep-shaped) in v1; the librarian-subagent variant is deferred until the deterministic brief demonstrably misses relevant facts in real use.
ASSUMED: Re-wiring Ahimsa's own live machine from the kit is OUT of scope for this run (protected by Do-not-touch); the user runs `init` themselves after reviewing the shipped kit.
ASSUMED: The loop stack (arm/loops skills) is not bundled; the kit covers global/project/task grains only.
ASSUMED: Constants — ghost threshold 48h, rotation threshold 700 lines, fence markers `<!-- banana:begin v1 -->` / `<!-- banana:end -->`, template placeholder tokens `__OWNER__` / `__AGENT_TAG__`.

## Tasks
<!-- Dependency order. done-when rungs: command | artifact | diff | REVIEW (auto-inserts a review task).
     On completion: flip [x], fill evidence:, append session.log entry (banana.n | build). -->

- [x] T1 — Scaffold the repo: git init at C:/Users/VICTUS/projects/banana, package.json (name banana, type module, bin → bin/banana.mjs, scripts: check = `tsc --checkJs --noEmit`, test = `node --test`), bin entry with version/help flags, MIT LICENSE, .gitignore, initial conventional commit.
      done-when: `node bin/banana.mjs --version` prints the package.json version and exits 0
      evidence: `node bin/banana.mjs --version` → 0.1.0, exit 0; gates green (tsc clean, node --test 3/3 pass); commit 2c8bf07, tag pre-ralph. Deviation logged: test script is `node --test` (dir-arg form broke on Windows); +@types/node dev dep for checkJs.

- [ ] T2 — Write canon v1.1 under canon/: CONTINUITY.md genericized and extended with the new architecture — closed allowlist entry ritual with the compiled brief as the sole default read, hot/cold surface tiering, headings-not-bodies rule for other agents' in-flight work, 48h ghost rule, snapshot session lifecycle (BEGIN/WORK/CLOSE), and a "Changes from v1" section listing every deviation — plus STANDARD.md and SESSION-LOG.md copied with machine-specific references removed.
      done-when: `node --test test/canon.test.mjs` exits 0 — asserts the six required section/rule strings are present in canon/CONTINUITY.md and that "Ahimsa", "VICTUS", "hermes.exe", and absolute C:/ paths have zero occurrences across canon/
      evidence:

- [ ] T3 — Harden the canon prose (qualitative gate on T2's CONTINUITY.md).
      done-when: REVIEW — criteria: preserves every v1 integrity rule (append-only, supersession-not-erasure, owned NEXT, agent attribution, rebuild-don't-patch projections) or lists the deviation under "Changes from v1"; the entry ritual is a closed allowlist (reads nothing outside it by default); every newly added rule names the failure mode it counters; no rule contradicts canon/STANDARD.md or canon/SESSION-LOG.md; no person-, machine-, or path-specific reference survives genericization.
      evidence:

- [ ] T3-R — Adversarial blind review of T3 artifact (canon/CONTINUITY.md).
      done-when: 2 fresh, independent subagent reviewers (artifact + T3 criteria ONLY — no rationale, no chat history) each fail to sustain a refutation; verdicts quoted in evidence
      evidence:

- [ ] T4 — Templates under templates/: global-STATE.md, project-STATE.md, LOGBOOK-header.md, session-log-seed.md, wiring/claude-code.md, wiring/agents-md.md, wiring/portable-directive.md. Wiring blocks carry the kit fence markers; placeholders use only the documented tokens.
      done-when: `node --test test/templates.test.mjs` exits 0 — every wiring template contains both fence markers; only `__OWNER__`/`__AGENT_TAG__` placeholder tokens appear; zero double-brace template residue anywhere in templates/
      evidence:

- [ ] T5 — Harness detection: lib/detect.mjs with injectable home root; detects claude-code (.claude dir or claude on PATH), pi (.pi), codex (.codex), hermes (home dir or binary on PATH); returns a structured report consumed by init and doctor.
      done-when: `node --test test/detect.test.mjs` exits 0 against fixture fake-home trees covering present and absent cases for each of the four harnesses
      evidence:

- [ ] T6 — Fenced-write engine: lib/fence.mjs — insert-or-replace a version-marked block in a target file, creating the file if missing, preserving all surrounding content byte-for-byte.
      done-when: `node --test test/fence.test.mjs` exits 0 — includes: applying twice yields a byte-identical file; user content outside the fence unchanged; a version bump replaces the old block in place
      evidence:

- [ ] T7 — File-wiring adapters: adapters/claude-code.mjs (fenced block into <home>/.claude/CLAUDE.md), adapters/pi.mjs (<home>/.pi/agent/AGENTS.md), adapters/codex.mjs (<home>/.codex/AGENTS.md) — each exposing detect/wire/describe and writing only via lib/fence.mjs.
      done-when: `node --test test/adapters.test.mjs` exits 0 — each adapter wires a sandbox home; a second run is byte-identical; a path-audit assertion proves no writes outside each adapter's declared target file
      evidence:

- [ ] T8 — Hermes adapter (write-through-agent): adapters/hermes.mjs — detect/describe plus compose() building the directive text (agent-to-agent sender header, protocol summary, agent tag hermes) and the one-shot command string; delivery only behind an explicit --deliver flag; never writes files under the hermes home.
      done-when: `node --test test/hermes.test.mjs` exits 0 — composed directive contains the sender header and the session-log envelope line; running the adapter against a sandbox hermes home leaves its file tree byte-identical
      evidence:

- [ ] T9 — init command: non-interactive flags (--owner, --tag, --harnesses, --yes) with interactive fallback capped at 3 prompts (owner, confirm detected harnesses, confirm write plan); creates <home>/.agents/CONTINUITY.md + STATE.md from canon/templates, runs selected adapters, prints paste instructions for undetected or manual-only harnesses.
      done-when: `node --test test/init.e2e.test.mjs` exits 0 — sandbox-HOME e2e: fresh init creates both global files plus wiring for detected harnesses; a second run exits 0 with a byte-identical tree
      evidence:

- [ ] T10 — project command: inside a git repo, creates LOGBOOK.md (header block + declared TYPE vocabulary), STATE.md (all six sections), .agents/session.log seed, and appends the fenced AGENTS.md wiring block; refuses to run outside a git repo unless --force.
      done-when: `node --test test/project.e2e.test.mjs` exits 0 — temp-repo e2e: files created with required sections; re-run idempotent; non-repo dir without --force exits non-zero
      evidence:

- [ ] T11 — brief command: `banana brief <feature> --tag <agent>` compiles a per-intent brief to stdout — target feature's session-log entries with bodies; headings-only for the last 5 entries of other features; NEXT lines owned by the given tag or unowned; project STATE.md verbatim (one page by contract); in-progress entries older than 48h flagged as ghosts; every section carries source refs; other features' bodies excluded.
      done-when: `node --test test/brief.test.mjs` exits 0 — fixture logs: target-feature APPROACH text present; other-feature APPROACH text absent; ghost entry flagged; each brief section carries a ref line
      evidence:

- [ ] T12 — doctor command: reports detected harnesses + fence block versions; audits — in-progress entries older than 48h, unowned NEXT lines, STATE.md "as of" older than the newest LOGBOOK entry date, any tracked continuity file over 700 lines; exit 0 clean / 1 findings; --verify prints (not executes) the per-harness headless recital commands.
      done-when: `node --test test/doctor.test.mjs` exits 0 — seeded-violation fixture: all four audit types flagged with exit 1; clean fixture exits 0
      evidence:

- [ ] T13 — README quickstart: the npx one-liner, four-command tour, per-harness wiring table ("what gets written where"), manual paste path for unsupported tools, and the hot/cold + brief mental model in one short section.
      done-when: `node --test test/readme.test.mjs` exits 0 — README.md contains the npx github:Q9-Ahimsa/banana command, all four command names, and one section per shipped adapter
      evidence:

- [ ] T14 — Ship: full gates green, conventional commits throughout, create public GitHub repo Q9-Ahimsa/banana via gh, push, then smoke-test the cold npx path.
      done-when: `npx --yes github:Q9-Ahimsa/banana --version` prints the version and exits 0, output shown
      evidence:

## Continuity
- After EVERY task: flip its checkbox, fill `evidence:` (command output / file / reviewer verdicts), append the session-log entry. All three, before starting the next task.
- Fresh/compacted context: read Goal + first unchecked task + `grep "banana\." .agents/session.log | tail -3`. That is sufficient; do not re-derive state from the codebase.
- Checked tasks stay closed unless global Verify fails — then re-run their done-whens in order to find the culprit; reopening is a new line with `SUPERSEDES:`, not an edit.
- BLOCKED on a task: write `BLOCKED: reason` under it, move to the next task that doesn't depend on it. Same task BLOCKED twice = stop the run, report to the user.

## Log
session.log stream: `banana` · logbook promotion N/A until the project grows a LOGBOOK.md (T10's own command can seed it post-run)
