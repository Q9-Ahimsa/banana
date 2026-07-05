# PACKET — banana v2: agent-first inversion — bootstrap pointers + living canon
> Compiled by /arm on 2026-07-05 from: "arm the v2 packet, monke together stronk" — "v2" being the
> session's realignment: the real user is the AGENTS, not the human. The human runs one command once;
> the wired blocks flip from protocol-summary to thin stable bootstrap pointers at a living canon;
> agents self-initialize workspaces (repo OR non-code topic); a sync path propagates canon updates so
> "whatever we update, we point all those agents to that."
> This file is the task list AND the continuity interface. Read Goal + first unchecked task + last 3
> session-log entries to (re)enter the run. Mark tasks, never delete them. Evidence lines are mandatory.

## Goal
End state:    The banana repo reshaped agent-first: canon rev 1.2 with an agent bootstrap section (self-serve workspace setup), an upstream/sync model, and topic-grain language; wiring templates rewritten as thin v2 bootstrap-pointer blocks; init infers owner from git config and fails fast on no-TTY; a new `sync` command propagates canon + fence updates; `project` initializes non-git topics; `brief` gains slug discovery; `doctor` audits canon staleness; README inverted (one screen for the human, the rest addressed to agents); pushed to GitHub as Q9-Ahimsa/banana and runnable cold via npx.
Verify by:    `npm run check && npm test` from the repo root — exit 0, full output shown (typecheck gate + full suite incl. sandbox-HOME e2e and idempotency tests)
Do not touch: C:/Users/VICTUS/.claude/ (no writes), C:/Users/VICTUS/.agents/, C:/Users/VICTUS/.pi/, the Hermes home (C:/Users/VICTUS/AppData/Local/hermes/), any other project directory; no `npm publish`; all filesystem writes confined to the kit repo and OS temp/sandbox dirs.
Stop when:    all tasks checked + Verify passes, OR 30 turns/iterations elapsed, OR the same task hits BLOCKED twice

ASSUMED: Canon rev is 1.2 (1.1 + agent-bootstrap section, upstream/sync model, topic-grain language); each canon file gains a machine-readable version marker line (HTML comment) that doctor and sync compare.
ASSUMED: Global canon location moves from `<home>/.agents/CONTINUITY.md` to a kit-owned dir `<home>/.agents/canon/` (CONTINUITY.md, STANDARD.md, SESSION-LOG.md) that sync may overwrite freely; `<home>/.agents/STATE.md` stays user-owned, create-if-missing, never overwritten. No migration shim for pre-v2 installs (the only such machine is the author's, out of scope per Do-not-touch).
ASSUMED: Fence block version bumps to v2 (`<!-- banana:begin v2 -->`); the existing fence engine's version-replace path performs the upgrade — no new fence semantics.
ASSUMED: Canonical CLI invocation in all agent-facing text is `npx --yes github:Q9-Ahimsa/banana <cmd>` — always fetches latest, so no network code ships in the kit; `sync` only copies the bundled canon into `<home>/.agents/canon/` and re-fences wired files. Global npm install stays optional and undocumented in v2.
ASSUMED: Owner inference order: --owner flag, then `git config --get user.name`, then interactive prompt only when stdin is a TTY; non-TTY with no inferable owner exits 1 printing the exact non-interactive invocation. TTY state is injectable for tests.
ASSUMED: `project` in a non-git dir proceeds by default, printing a not-version-controlled note; the --force flag is removed (pre-public, no back-compat owed).
ASSUMED: `brief` with no feature arg prints an active-slug listing (slug + last-entry date) and exits 0; an unknown slug prints the same listing to stderr and exits 1.
ASSUMED: Deferred out of v2 scope: doctor --fix, MCP tool surface, session-start hooks, npm registry publish, re-wiring the author's live machine (user runs init themselves after ship).
ASSUMED: Carried from v1: zero runtime deps, Node >= 18, ESM, `node --test`, injectable roots everywhere, constants (ghost 48h, rotation 700 lines, tokens __OWNER__/__AGENT_TAG__).

## Tasks
<!-- Dependency order. done-when rungs: command | artifact | diff | REVIEW (auto-inserts a review task).
     On completion: flip [x], fill evidence:, append session.log entry (banana-v2.n | build). -->

- [ ] T1 — Canon rev 1.2 under canon/: add an agent bootstrap section (what an agent with zero prior context does on landing in a workspace with no continuity files: which files to create, the entry envelope, the session ritual — and that a workspace may be a git repo or a non-code topic dir), an upstream/sync section (canon dir is kit-owned and overwritable by sync; user surfaces — STATE.md, logs, logbooks — are never overwritten by the kit), a version marker line in each canon file, and extend the changes-from-v1 section with the v1.2 additions.
      done-when: `node --test test/canon.test.mjs` exits 0 — asserts presence of the bootstrap section heading, the upstream/sync section heading, a version marker containing "1.2" in each canon file, workspace/topic (non-git) language, all prior v1.1 required strings, and still zero occurrences of "Ahimsa", "VICTUS", "hermes.exe", or absolute C:/ paths across canon/
      evidence:

- [ ] T2 — Wiring templates v2 (the product's agent-facing interface): rewrite wiring/claude-code.md, wiring/agents-md.md, wiring/portable-directive.md as thin stable bootstrap blocks — agent identity (tag), pointer to `<home>/.agents/canon/` as protocol authority, the canonical npx invocation, the self-setup instruction (initialize any workspace lacking continuity files per canon bootstrap section), and the session ritual one-liner (brief at start, close entry at end). Bump fence markers to v2. Protocol rules live behind the pointer, not in the block.
      done-when: `node --test test/templates.test.mjs` exits 0 — every wiring template contains both v2 fence markers, the canon dir pointer, the npx invocation string, and a self-setup instruction; each wiring block body is 30 lines or fewer; only __OWNER__/__AGENT_TAG__ tokens; zero double-brace residue in templates/
      evidence:

- [ ] T3 — Harden the agent-facing surface (qualitative gate on T1's canon additions + T2's bootstrap blocks, taken together as one surface).
      done-when: REVIEW — criteria: (1) an agent given ONLY a rendered bootstrap block plus the canon files can execute the full lifecycle — machine context, workspace self-setup (git and non-git), session BEGIN/WORK/CLOSE — without any other source; (2) the bootstrap block contains pointers, identity, and ritual only — no protocol rule stated in the block that the canon does not also own (no dual-authority drift); (3) the new canon sections preserve every v1.1 rule or list the deviation in the changes section; (4) every newly added rule or section names the failure mode it counters; (5) the upstream/sync model never licenses overwriting a user-owned surface (STATE.md, session.log, LOGBOOK.md); (6) no person- or machine-identifying reference (personal names, usernames, drive letters, machine-absolute paths) in canon/ or templates/wiring/ — portable home-relative and repo-relative paths are allowed.
      evidence:

- [ ] T3-R — Adversarial blind review of the T3 surface (canon/ additions + rendered wiring blocks).
      done-when: 2 fresh, independent subagent reviewers (artifacts + T3 criteria ONLY — no rationale, no chat history) each fail to sustain a refutation; verdicts quoted in evidence
      evidence:

- [ ] T4 — init v2: owner resolution per the assumed inference order (flag → git config → TTY prompt; non-TTY without owner exits 1 printing the exact non-interactive invocation); installs canon files into `<home>/.agents/canon/` (kit-owned — created or refreshed to the bundled canon), keeps `<home>/.agents/STATE.md` create-if-missing; wires adapters with the v2 blocks; hermes compose/deliver and paste-instruction paths unchanged in behavior.
      done-when: `node --test test/init.e2e.test.mjs` exits 0 — sandbox-HOME e2e: zero-flag init succeeds when a git-config owner stub is injectable; non-TTY init with no owner exits 1 and the output names --owner and --yes; canon dir populated with version-marked files; STATE.md preserved when pre-existing; second run byte-identical tree
      evidence:

- [ ] T5 — sync command: copies the kit's bundled canon over `<home>/.agents/canon/`, re-applies the fenced block to every already-wired harness file whose block version is older than current, reports each change, exits 0; never touches user-owned surfaces.
      done-when: `node --test test/sync.test.mjs` exits 0 — sandbox with stale canon + a v1 fence block: after sync the canon dir is byte-equal to the kit's bundled canon, the fence block reads v2 with user content outside the fence byte-identical, STATE.md untouched; a second sync run reports no changes and the tree is byte-identical
      evidence:

- [ ] T6 — project v2 (topic-grain): non-git dir proceeds by default printing a not-version-controlled note, --force removed; owner resolution shares init's inference order and non-TTY fail-fast; created files and AGENTS.md fence content otherwise per the v2 templates.
      done-when: `node --test test/project.e2e.test.mjs` exits 0 — non-git temp dir: exit 0, files created, note present in output; git temp repo: exit 0, note absent; non-TTY with no inferable owner exits 1 naming the flags; re-run idempotent
      evidence:

- [ ] T7 — brief discovery: `banana brief` with no feature arg prints the active-slug listing (slug + date of its latest entry) and exits 0; an unknown slug prints the listing to stderr and exits 1; the compiled-brief contract for a known slug is unchanged.
      done-when: `node --test test/brief.test.mjs` exits 0 — fixture logs: no-arg run lists both fixture slugs with dates, exit 0; unknown-slug run exits 1 and stderr carries the listing; all prior include/exclude assertions still pass
      evidence:

- [ ] T8 — doctor v2: two new audits — canon dir missing or any canon file's version marker older than the kit's bundled canon; any wired fence block at a version older than current — each finding names `sync` as the remediation; existing four audits and exit semantics unchanged.
      done-when: `node --test test/doctor.test.mjs` exits 0 — stale-canon and stale-fence fixtures each flagged with exit 1 and the finding text contains "sync"; current-canon fixture adds no finding; the four v1 audit assertions still pass
      evidence:

- [ ] T9 — README inversion + version bump: package.json to 0.2.0; README restructured — human section is one screen (the npx one-liner + "your agents handle the rest" framing + the sync update story), everything below addressed to agents (five-command reference incl. sync, canon pointer, bootstrap model); the four-command human tour and human-facing daily-ritual sections removed.
      done-when: `node --test test/readme.test.mjs` exits 0 — README contains the npx one-liner, all five command names, the canon dir path, and the human section (content above the first agent-addressed heading) is 40 lines or fewer; `node bin/banana.mjs --version` prints 0.2.0
      evidence:

- [ ] T10 — Ship: full gates green, conventional commits throughout, public GitHub repo Q9-Ahimsa/banana created and pushed, then cold npx smoke test. NOTE: repo creation is a user-run step (`gh repo create` is outside this agent's permitted surface) — the run stops and requests exactly that command, then resumes.
      done-when: `npx --yes github:Q9-Ahimsa/banana --version` prints 0.2.0 and exits 0, output shown
      evidence:

## Continuity
- After EVERY task: flip its checkbox, fill `evidence:` (command output / file / reviewer verdicts), append the session-log entry. All three, before starting the next task.
- Fresh/compacted context: read Goal + first unchecked task + `grep "banana-v2\." .agents/session.log | tail -3`. That is sufficient; do not re-derive state from the codebase.
- Checked tasks stay closed unless global Verify fails — then re-run their done-whens in order to find the culprit; reopening is a new line with `SUPERSEDES:`, not an edit.
- BLOCKED on a task: write `BLOCKED: reason` under it, move to the next task that doesn't depend on it. Same task BLOCKED twice = stop the run, report to the user.

## Log
session.log stream: `banana-v2` · logbook promotion N/A (kit repo carries no LOGBOOK.md; the v1 packet and its run history live at .agents/goal/archive/2026-07-05-banana-v1/)
