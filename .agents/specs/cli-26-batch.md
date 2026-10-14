# cli-26 batch — #24 + #25 (wiring wording, fence v3 -> v4) and #26 (doctor remedy for an identity-less home fence)

Status: resolved, ready to build. Log: cli.26 (continued as cli.27).
Owner go, 2026-10-13: "Go for all the items, which include archiving, 26, and the bump".
The archiving (session-log rotation) shipped on its own in e32895a.
Inputs: a read-only code map of both lanes, trial-run in throwaway copies (not committed).

## Calls (main)

- C1 One worktree, two lanes in sequence: L1 = #24 + #25, then L2 = #26 on top of L1.
  Both lanes edit README.md and docs/DESIGN.md; #26's doc text lands on the bumped text.
- C2 All three wiring templates move to v4 together. The code accepts a version per template,
  but templates.test.mjs derives one opener from claude-code.md and requires it everywhere.
- C3 Roster spelling: `state lint · state archive`, one entry per state verb. A test derives the
  expected roster from lib/commands.mjs `COMMANDS` × lib/state.mjs `STATE_VERBS` (the #22 idea).
- C4 agents-md.md (installed in the codex and pi home files and in every project AGENTS.md): sync
  refreshes the blocks in home instruction files; `banana project`, run in a workspace, refreshes
  its AGENTS.md block. True in every install place, and it matches doctor's remedy for a project.
- C5 claude-code.md is installed only at the home CLAUDE.md, where "refreshes this block" is true.
  Only its roster changes.
- C6 portable-directive.md is only printed (a paste block for other tools; fence-stripped into
  Hermes memory). No sync or doctor path reaches a pasted copy. New sentence: "To refresh this
  block, re-run `banana init` and use the copy it prints." Never suggest `init --tag`: that flag
  beats the preserved identity of every home file in the same run.
- C7 ADR 0006 records the opposite choice for the roster (avoid a re-fence of every wired file for
  one line). Its cost is now paid once, together with #25. Add a dated note under that bullet.
- C8 #26 remedy: a stale home fence whose block has no readable owner/tag line names
  `banana init --harnesses <id>`, with the reason. Not bare `banana init`: non-interactive init
  wires every harness whose dot-dir exists, so it can create a block in a never-wired file.
  doctor runs the same test as sync: `extractIdentity` (lib/fence.mjs) on
  `text.slice(fence.start, fence.end)`, and `owner === null || tag === null`. No new helper.
- C9 sync's skip message names the same command as doctor.
- C10 The repo's own AGENTS.md block is re-fenced to v4 in L1, by the kit itself, so the repo never
  ships a block older than its own templates.
- C11 Docs that state the changed facts change in the same lane: README, docs/DESIGN.md, ADR 0006,
  doctor.mjs comments. STATE.md, LOGBOOK.md and the session log are records: main only.

## Rules for both lanes

- Work only inside the worktree path given in the prompt. Run `pwd` before the first write.
  The main checkout is read-only on purpose; never write there or under the home directory.
- Scratch dirs only via node `fs.mkdtempSync(path.join(os.tmpdir(), 'b26l-'))`; print the path
  before writing. Env overrides go inline on the very command (`HOME=… USERPROFILE=… node …`).
- Git: only `git add` and `git commit` on the lane branch in the worktree. No push, reset, clean,
  stash, rebase, checkout of other branches, or worktree commands.
- No recursive deletes, no process kills, no WebFetch.
- Line endings: the worktree checks files out as CRLF (`core.autocrlf=true`); git stores LF.
  Do not convert files. After the commit, `git ls-files --eol <changed files>` must show `i/lf`.
- Public repo: test data and docs use placeholders only (alice, bob, alpha, owner-x). No real
  names, usernames or local paths. `test/deny-list.test.mjs` must stay green.
- TDD: write or change the tests first, run them, and record which fail (red). Then make the
  change and run them green. Then run both gates: `npm run check` and `npm test`.

## Lane L1 — #24 + #25 (one fence bump, v3 -> v4)

### L1 tests first

Before editing any template, render the CURRENT agents-md.md for tag `alpha`, owner `owner-x`
with `renderWiringTemplate` (lib/wiring.mjs) and paste the result as a literal string constant
`V3_AGENTS_MD_BLOCK` (LF line endings) into each test file below that needs it. This is a real v3
block, so the upgrade tests use real old text.

test/templates.test.mjs:
- Import `COMMANDS` from '../lib/commands.mjs' and `STATE_VERBS` from '../lib/state.mjs' (keep the
  existing imports). Add `const flat = (text) => text.replace(/\s+/g, ' ');`.
- Replace the v1-only marker guard (about line 69) with: exactly one opener, the current one —
  `const openers = text.match(/<!-- banana:begin v\d+ -->/g) ?? []; assert.deepEqual(openers, [FENCE_BEGIN], …)`.
- Replace the v3 Kit-bullet test (about lines 73-95) with a v4 one:
  `assert.equal(CURRENT_WIRING_VERSION, 4, 'templates/wiring must be bumped to v4 (#24, #25)')`;
  each file includes `<!-- banana:begin v4 -->` and `npm install -g github:Q9-Ahimsa/banana`;
  `flat(text)` includes 'then `banana sync` updates the kit'; no 'npx always fetches the latest kit'.
- New test 'every wiring template roster lists every CLI command, state spelled out per verb (#24)':
  `expected = COMMANDS.flatMap((c) => (c === 'state' ? STATE_VERBS.map((v) => `state ${v}`) : [c]))`;
  per template, `roster = /\(commands: ([^)]*)\)/.exec(flat(text))?.[1]`, then
  `assert.deepEqual(roster.split(' · '), expected)`.
- New test 'each wiring template names the command that refreshes its block (#25)', on `flat(text)`:
  - agents-md.md includes: 'then `banana sync` updates the kit and refreshes the blocks in home instruction files, and `banana project`, run in a workspace, refreshes its AGENTS.md block.'
  - claude-code.md includes: 'then `banana sync` updates the kit and refreshes this block.'
  - portable-directive.md includes: 'then `banana sync` updates the kit. To refresh this block, re-run `banana init` and use the copy it prints.'
  - agents-md.md and portable-directive.md do NOT include 'refreshes this block'.
- New test 'every wiring template line is 78 characters or fewer': `[...line].length <= 78` for every
  line of `text.split(/\r?\n/)`.

test/sync.test.mjs:
- Add `V3_AGENTS_MD_BLOCK`. Retitle the test named '…upgrades a v1 fence to v3' to '…upgrades a v1
  fence to the current version', and '…upgrades a real v2 block to v3…' to '…to the current version…'.
- New test 'e2e (#24, #25): sync upgrades a real v3 codex block to the current template, identity
  kept; second run byte-identical'. Host `# Codex notes\n\n${V3_AGENTS_MD_BLOCK}\nafter\n` at the
  sandbox home's codex AGENTS.md. Assert: bytes before and after the fence unchanged; the block equals
  `renderWiringTemplate('agents-md.md', { owner: 'owner-x', tag: 'alpha' })`; output includes
  `re-fenced <file>: v3 -> v${wiringTemplateVersion('agents-md.md')}`; a second run reports no changes
  and leaves the tree byte-identical (follow the file's existing helpers).

test/doctor.test.mjs:
- Add `V3_AGENTS_MD_BLOCK`. Comments, titles and messages that say the bundled template "is v3"
  (about lines 539, 561, 570) say "is newer" / "is past v2" instead. Assertions stay derived.
- New test 'stale fence (#24, #25): a real v3 agents-md block is flagged — banana sync for a home
  file, banana project for a project'. The v3 block in both the home codex AGENTS.md and the project
  AGENTS.md. Assert code 1 and both exact messages:
  `[stale-fence] ${homeAgents} fence is v3 but current is v${current} — run banana sync to re-fence`
  `[stale-fence] ${projectAgents} fence is v3 but current is v${current} — run banana project to re-fence`

test/project.e2e.test.mjs:
- Add `V3_AGENTS_MD_BLOCK`. New test 'e2e (#24, #25): project upgrades a real v3 block in a CRLF
  AGENTS.md — identity kept, CRLF kept, bytes outside untouched'. Host
  `asCrlf('# Repo notes\n\n' + V3_AGENTS_MD_BLOCK + '\n')`; run with owner and tag unset and the git
  user name set to 'Someone Else' (follow the file's helpers). Assert the file equals
  `asCrlf('# Repo notes\n\n') + asCrlf(renderWiringTemplate('agents-md.md', { owner: 'owner-x', tag: 'alpha' })) + '\r\n'`
  (adjust only if the existing CRLF tests show a different trailing shape; say so in the report); it
  has the current opener and no v3 opener; it includes 'state archive' and '`banana project`, run in
  a workspace'.

Run these and record the red set. test/readme.test.mjs needs no change: it already follows
`wiringTemplateVersion`, and it goes red until README's example opener says v4.

### L1 edits

E1 `templates/wiring/agents-md.md` — whole file becomes:

```
<!-- banana:begin v4 -->
## Continuity bootstrap (banana)

- **Identity:** you are `__AGENT_TAG__`; owner: `__OWNER__`. Sign every entry
  you author with your tag.
- **Protocol authority:** `~/.agents/canon/` — the harness-neutral continuity
  protocol shared by every agent and human on this machine (CONTINUITY.md,
  STANDARD.md, SESSION-LOG.md). All rules live behind this pointer, never in
  this block; on conflict, the canon wins. Read CONTINUITY.md before your
  first entry.
- **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
  sync · log · state lint · state archive). Install once:
  `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
  kit and refreshes the blocks in home instruction files, and
  `banana project`, run in a workspace, refreshes its AGENTS.md block.
  Not installed yet? Prefix `npx --yes github:Q9-Ahimsa/banana` instead.
  Kits can drift between machines: the brief prints the kit version, and
  `banana doctor` warns when a newer one exists.
- **Self-setup:** if this workspace (git repo or non-code topic dir) lacks
  continuity files, initialize it yourself per the canon's agent bootstrap
  section: run `banana project` from the workspace root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:` (`banana log close`).
<!-- banana:end -->
```

E2 `templates/wiring/claude-code.md` — line 1 becomes `<!-- banana:begin v4 -->`, and the Kit
bullet's roster line becomes `  sync · log · state lint · state archive). Install once:`.
Nothing else changes.

E3 `templates/wiring/portable-directive.md` — whole file becomes:

```
<!-- banana:begin v4 -->
## Continuity bootstrap (banana)

You are `__AGENT_TAG__`, one of several agents sharing file-based continuity
on this machine. Owner: `__OWNER__`. Sign every entry you author with your
tag.

- **Protocol authority:** `~/.agents/canon/` — read CONTINUITY.md there before
  your first entry; it owns every continuity rule (entry envelopes, session
  ritual, append-only integrity). This block is only a pointer — when it and
  the canon disagree, the canon wins.
- **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
  sync · log · state lint · state archive). Install once:
  `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
  kit. To refresh this block, re-run `banana init` and use the copy it
  prints. Not installed yet? Prefix `npx --yes github:Q9-Ahimsa/banana`
  instead. Kits can drift between machines: the brief prints the kit
  version, and `banana doctor` warns when a newer one exists.
- **Self-setup:** any workspace (git repo or non-code topic dir) lacking
  continuity files is yours to initialize per the canon's agent bootstrap
  section: run `banana project` from the workspace root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:` (`banana log close`).
<!-- banana:end -->
```

E4 README.md, the fence example (about line 83): `<!-- banana:begin v3 -->` -> `<!-- banana:begin v4 -->`.

E5 README.md, the `sync` paragraph (about lines 22-23): "re-applies any stale wiring blocks." becomes
"re-applies any stale wiring block in a home instruction file (`banana project` refreshes a
project's `AGENTS.md`)." Re-wrap that paragraph only, lines of 78 characters or fewer. The heading
'## Agents: start here' must stay where test/readme.test.mjs requires it.

E6 docs/DESIGN.md (about line 375): "is currently fenced at `v3`" -> "is currently fenced at `v4`".

E7 docs/adr/0006-global-page-limits-and-archive.md: directly under the bullet that begins
"- The machine-wiring roster still tells agents about `state lint` only", add this line:

```
  *Superseded 2026-10-14 by #24:* the roster now names `state archive`. The re-fence this
  bullet avoided is paid once, together with #25's refresh wording, in one v3 -> v4 bump.
```

E8 Re-fence the repo's own AGENTS.md, after the gates are green. From the worktree root:
`HOME=<scratch> USERPROFILE=<scratch> node bin/banana.mjs project --yes`, where `<scratch>` is a fresh
mkdtemp dir. Then `git status --short` must show AGENTS.md as the only file this command changed,
and `git diff AGENTS.md` must touch only lines inside the fence: the opener says v4, the identity
line keeps its existing tag and owner, the rest matches the new agents-md.md. If the command changed
anything else, stop and report; do not hand-edit AGENTS.md.

### L1 done when

- The red set is recorded (test names), then all green: `npm run check` exit 0, `npm test` 0 fail.
- One commit on the lane branch:
  `feat(wiring): roster names state archive; each block names its refresh command; fence v4 (#24, #25)`
  Body: two or three plain sentences, then `Closes #24` and `Closes #25`, then the trailer line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Lane L2 — #26 (on top of L1)

### L2 tests first (test/doctor.test.mjs unless named)

- Fixtures after the file's CURRENT_FENCE constant:
  `const STALE_FENCE = fencedBlock('- **Identity:** you are `alpha`; owner: `alice`.', 1);`
  `const STALE_FENCE_NO_IDENTITY = '<!-- banana:begin v1 -->\nno identity line here\n<!-- banana:end -->\n';`
  (the second is the issue's repro block, the same as sync.test.mjs's skip fixture).
- Fixture swap: every existing test that writes an identity-less stale block into a HOME file and
  expects `banana sync` changes that home fixture to `STALE_FENCE + '\n'`. The code map found them at
  about lines 521, 884, 903, 915, 942, 1061 and 1097; also swap the report-only ones at about 967
  and 994 for consistency. Project-file fixtures stay identity-less. Find them by reading, not by
  line number alone.
- New tests:
  - T1 'stale fence (#26): a stale home fence with no identity line names banana init — banana sync
    skips it'. Home codex AGENTS.md = STALE_FENCE_NO_IDENTITY, project AGENTS.md =
    STALE_FENCE_NO_IDENTITY. Assert deepEqual of the stale-fence messages, in this order:
    `[stale-fence] ${homeAgents} fence is v1 but current is v${current} — run banana init --harnesses codex to re-fence (banana sync skips a block with no owner/tag line)`
    `[stale-fence] ${projectAgents} fence is v1 but current is v${current} — run banana project to re-fence`
  - T2 'stale fence (#26): a stale home fence with an identity line keeps banana sync'. Codex
    AGENTS.md = STALE_FENCE. Assert deepEqual [`… — run banana sync to re-fence`] (full string).
  - T3 'stale fence (#26): each named remedy does what doctor says'. Codex = STALE_FENCE_NO_IDENTITY,
    CLAUDE.md = STALE_FENCE. (1) `runSync` with no exec (no npm, no network): the codex file is
    byte-identical and an err line starts with `skipped ` and names it. (2) Exactly one stale-fence
    finding remains, naming the codex file. (3) Parse `/— run banana init (.+?) to re-fence/` from it,
    feed `parseInitArgs([...printed.split(' '), '--yes'])` to `runInit` with a git user name of
    'alice' and the file's ENV. (4) Code 0, and the stale-fence list is now [].
  - T4 'stale fence (#26): owner without a tag still gets the init remedy'. A v1 block holding only
    an owner line (`owner: \`alice\``). Assert the init remedy, as sync's `||` test skips it too.
- test/sync.test.mjs: the existing skip test asserts the new message names
  `run banana init --harnesses codex to re-fence`.
- Run them and record the red set (expected: T1, T3, T4 and the sync message; T2 green).

### L2 edits

E1 lib/doctor.mjs import: `import { findFence } from './fence.mjs';` ->
`import { extractIdentity, findFence } from './fence.mjs';`

E2 lib/doctor.mjs, the fence loop in the upstream audit (`const wired = FILE_ADAPTERS.map(…)` through
the `findings.push` for 'stale-fence'). New code:

```js
  const wired = FILE_ADAPTERS.map((adapter) => {
    const spec = adapter.describe();
    return { target: join(home, spec.target), template: spec.template, harness: adapter.id };
  });
  // #19: when the project AGENTS.md is the very same file as a home adapter target, audit it
  // once, as the home file (the one banana sync, or init for an identity-less block, re-fences).
  if (!projectAgentsIsHomeFile(home, cwd)) {
    wired.push({ target: join(cwd, 'AGENTS.md'), template: 'agents-md.md', harness: null });
  }
  for (const { target, template, harness } of wired) {
    if (!existsSync(target)) continue;
    /** @type {string} */
    let text;
    /** @type {ReturnType<typeof findFence>} */
    let fence;
    try {
      text = readFileSync(target, 'utf8');
      fence = findFence(text);
    } catch {
      continue; // malformed markers already surface in the report section
    }
    if (fence === null) continue;
    const current = wiringTemplateVersion(template);
    if (fence.version < current) {
      let remedy = 'run banana project to re-fence';
      if (harness !== null) {
        // #26: sync re-fences a home block only when it can read the block's owner/tag back — the
        // same extractIdentity call and null test as lib/sync.mjs — and skips it otherwise.
        const { owner, tag } = extractIdentity(text.slice(fence.start, fence.end));
        remedy =
          owner === null || tag === null
            ? `run banana init --harnesses ${harness} to re-fence (banana sync skips a block with no owner/tag line)`
            : 'run banana sync to re-fence';
      }
      findings.push({
        type: 'stale-fence',
        message: `[stale-fence] ${target} fence is v${fence.version} but current is v${current} — ${remedy}`,
      });
    }
  }
```

Keep `readFileSync` inside the try: one doctor test links a directory named AGENTS.md, and reading
it throws EISDIR. Outside the try, doctor would exit 1 with `banana doctor: EISDIR`.
`adapter.id` must be a value `init --harnesses` accepts (claude-code, pi, codex); check it.

E3 lib/doctor.mjs comments: the file header's remedy list, the upstream-audit JSDoc remedy list, and
test/doctor.test.mjs's header comment each add: `banana init --harnesses <id>` for a home file
whose stale block has no owner/tag line (sync skips such a block — #26).

E4 lib/sync.mjs skip message:
`skipped ${target}: cannot recover owner/tag from the v${fence.version} block — re-run init` ->
`skipped ${target}: cannot recover owner/tag from the v${fence.version} block — run banana init --harnesses ${adapter.id} to re-fence`

E5 README.md:
- doctor row: after "`banana sync` for the canon and home instruction files," insert
  "`banana init --harnesses <id>` for a home file whose block has no identity line (sync skips it),".
- The fence paragraph's last sentence "Owner and tag are recovered from the existing block on
  re-fence, so `sync` needs no flags." gains: "A block with no identity line is skipped (`sync`
  never invents one); `banana doctor` then names `banana init --harnesses <id>`." Re-wrap that
  paragraph only, 78 characters or fewer.

E6 docs/DESIGN.md:
- Upstream-staleness bullet: after "(sync never touches project files)." add "A stale home block
  with no readable owner/tag line names `banana init --harnesses <id>` instead, with the reason:
  sync skips such a block (#26; doctor runs sync's own `extractIdentity` test)."
- Identity-preservation paragraph: "No existing fence, or a fence whose identity line can't be
  parsed, falls back to …" becomes "For `project` and `init`, no existing fence, or a fence whose
  identity line can't be parsed, falls back to …" (rest of that sentence unchanged), and after its
  "so identity loss is never silent." add "`sync` never falls back: it skips a stale home block
  whose identity it can't read and names `banana init --harnesses <id>` (#26)."
  Re-wrap the touched lines to the paragraph's existing width.

### L2 done when

- Red set recorded, then green: `npm run check` exit 0, `npm test` 0 fail.
- One commit on the lane branch:
  `fix(doctor): name banana init --harnesses <id> for a stale home block sync cannot re-fence (#26)`
  Body: two or three plain sentences, then `Closes #26`, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Integration (main)

- Fast-forward main to the lane branch. Gates on main. `git ls-files --eol` all `i/lf`.
- `node bin/banana.mjs doctor` in the repo: the project AGENTS.md is current (v4); home fences show
  stale v3 with `banana sync` until the release is synced.
- Review rounds on the merged diff until two rounds in a row find no product defect. Fixes go to a
  task-worker as exact edits.

## Release (needs the owner's go)

0.7.0 bump, push, `banana sync` on this machine (home fences v3 -> v4), doctor clean, issues closed
by the commit footers. Each other project needs `banana project` in its next session.

## Out of scope (note for the owner)

- An older kit running `project`/`init` over a newer block rewrites it to the older version
  (no downgrade guard). Pre-existing; a candidate follow-up issue.
- init's no-owner fallback hint drops `--harnesses`. Pre-existing.

## Review round 1 fixes (lane R1, on top of 9693fb7)

Round 1: 16 findings confirmed by refute-first verifiers: 3 product defects, 13 test gaps (9 tests
after merging duplicates). Two product defects predate this batch, but #26's new remedy puts users
on their path, so they ride this batch. Same rules as the lanes above.

Order: (1) gap tests G1-G6 with mutation proofs, on the unchanged lib/ code; (2) product fixes
P1-P3, tests first (red), then the edit (green); (3) gates; (4) one commit.

### G — test gaps (behavior is right; each test must kill its named mutant)

Prove each G test: it passes on the current code; then apply the named mutant to the lib file,
run the test file and see it fail; then undo the mutant (edit it back) and confirm with
`git diff --stat` that lib/ has no pending change. Record each mutant and the failing test.

- G1 test/doctor.test.mjs 'stale fence (#26): every home harness gets its own init remedy, sync's
  skip line names the same command, and that command re-fences only that file'. Loop over every
  FILE_ADAPTERS entry (import it from where doctor.test.mjs or lib/ already exports it). Per adapter:
  fresh sandbox home with the canon installed; create the dot-dirs of ALL file harnesses so plain
  init would detect them; write STALE_FENCE_NO_IDENTITY at that adapter's target only. Assert:
  (a) the stale-fence messages deepEqual
  [`[stale-fence] ${target} fence is v1 but current is v${current} — run banana init --harnesses ${adapter.id} to re-fence (banana sync skips a block with no owner/tag line)`];
  (b) `runSync` with no exec leaves the file byte-identical, and its err has a line
  `skipped ${target}: cannot recover owner/tag from the v1 block — run banana init --harnesses ${adapter.id} to re-fence`;
  (c) parse the command from doctor's message, run it via parseInitArgs/runInit (git user name
  'alice', `--yes`): code 0, doctor's stale-fence list is [], and no OTHER adapter's target file was
  created. Mutants: doctor hardcodes `--harnesses codex`; sync hardcodes `--harnesses claude-code`.
- G2 test/doctor.test.mjs 'stale fence (#26): identity text outside the fence does not count —
  doctor agrees with sync'. Codex file = 'Note: you are `alpha`; owner: `alice`.\n\n' +
  STALE_FENCE_NO_IDENTITY. Assert the init remedy, and that `runSync` skips the file. Mutant:
  doctor calls `extractIdentity(text)` instead of the fence slice.
- G3 test/doctor.test.mjs 'stale fence (#26): a tag without an owner still gets the init remedy'.
  Codex file = fencedBlock('- **Identity:** you are `alpha`.', 1) + '\n'. Assert the init remedy.
  Mutant: doctor's test narrowed to `tag === null`.
- G4 test/doctor.test.mjs 'stale fence: a directory where a home harness file belongs never aborts
  doctor'. mkdirSync the codex AGENTS.md path as a directory; canon installed; clean project. Assert
  runDoctor does not print `banana doctor: EISDIR`, and auditUpstream's stale-fence list is [].
  Mutant: move doctor's `text = readFileSync(…)` above its `try`.
- G5 test/templates.test.mjs "the repo's own AGENTS.md block is exactly what banana project renders
  today (C10)". Read ../AGENTS.md, `toLf`, `findFence`; take the identity with `extractIdentity` on
  the fence slice; assert the fence slice equals
  `renderWiringTemplate('agents-md.md', { owner, tag })` with its trailing newline handled the
  way findFence's end offset requires. Mutant: AGENTS.md opener set back to v3 (a data mutant).
- G6 test/templates.test.mjs 'docs/DESIGN.md states the current wiring fence version':
  `flat(design)` includes `is currently fenced at \`v${CURRENT_WIRING_VERSION}\``. Mutant: DESIGN.md
  says v3.

### P — product fixes (tests first, red, then the edit)

- P1 sync aborts on an unreadable home target and never reaches later stale files.
  Test (test/sync.test.mjs) 'sync: an unreadable home target is skipped, later stale files are still
  re-fenced': mkdirSync the pi AGENTS.md path as a directory; codex AGENTS.md = a v1 block with an
  identity line (`- **Identity:** you are \`alpha\`; owner: \`alice\`.`). runSync (no exec): code 0;
  an err line starts with `skipped ${piPath}: EISDIR`; the codex file now carries the current opener;
  auditUpstream reports no stale fence. Edit lib/sync.mjs fence loop:
  OLD
  ```js
      const text = readFileSync(target, 'utf8');
      /** @type {ReturnType<typeof findFence>} */
      let fence;
      try {
        fence = findFence(text);
      } catch (error) {
  ```
  NEW
  ```js
      /** @type {string} */
      let text;
      /** @type {ReturnType<typeof findFence>} */
      let fence;
      try {
        text = readFileSync(target, 'utf8');
        fence = findFence(text);
      } catch (error) {
  ```
  Contract change, decided: an unreadable home file is skipped with a `skipped <path>: <reason>`
  line and sync carries on (exit 0), like a file with malformed markers. Add one sentence saying so
  to docs/DESIGN.md's sync move 2.
- P2 `init --harnesses <id>` lists already-wired harnesses under "Not wired" and tells the user to
  paste the portable block into them (a second fence). Test (test/init.e2e.test.mjs or the file
  that already tests init's "Not wired" output): home with a CURRENT claude-code block (render the
  current claude-code.md with an identity) at the CLAUDE.md path, a v1 identity-less codex block, and
  an empty pi dot-dir (no AGENTS.md). runInit with `--harnesses codex --yes`, git user name 'alice'.
  Assert: output has no `claude-code — re-run init`; CLAUDE.md byte-identical; output still has
  `pi — re-run init` (an unwired harness keeps the paste advice). Edit lib/init.mjs:
  import `findFence` from './fence.mjs' (add it to the existing fence.mjs import), and replace
  `    const manual = FILE_ADAPTERS.filter((a) => !selected.includes(a.id));` with
  ```js
    // A harness whose file already carries a banana block needs no paste: pasting the portable
    // block there would add a second fence (#26 review).
    const manual = FILE_ADAPTERS.filter((a) => {
      if (selected.includes(a.id)) return false;
      const target = join(home, a.describe().target);
      try {
        return !existsSync(target) || findFence(readFileSync(target, 'utf8')) === null;
      } catch {
        return true;
      }
    });
  ```
- P3 README's sync row still says sync re-applies every stale fence. Test (test/readme.test.mjs)
  'README doctor and sync rows name the right refresh commands (#19, #25, #26)': the
  '| `banana doctor`' row includes '`banana sync`', '`banana init --harnesses <id>`' and
  '`banana project`'; the '| `banana sync`' row includes 'home wiring fence' and '`banana project`'.
  Edits: README.md sync row: `re-apply any wiring fence older than current;` ->
  `re-apply any home wiring fence older than current (a block with no owner/tag line is skipped; \`banana project\` refreshes a project's \`AGENTS.md\`);`
  docs/DESIGN.md sync move 2: after "(`lib/fence.mjs`'s identity preservation, #16)" insert
  "; a stale block whose owner/tag it can't read is skipped with a message naming
  `banana init --harnesses <id>` (#26), and an unreadable file is skipped the same way". Re-wrap
  the touched lines to the paragraph's width.

### R1 done when

- G1-G6 mutation proofs and P1-P3 red sets recorded; `npm run check` exit 0; `npm test` 0 fail.
- One commit: `fix(sync,init): skip unreadable home files; list only unwired harnesses; tests for #26 review`
  Body: two or three plain sentences, `Refs #26`, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review round 2 fixes (lane R2, on top of ea48f92)

Round 2: 4 test gaps confirmed (3 after merging a duplicate) and one help-text overclaim that two
reviewers filed as a nit. Main counts that overclaim as a product defect: it is the same class as
round 1's P3. Same rules and order as R1: G tests with mutation proofs first, then P4 tests-first,
then gates, then one commit.

- G7 test/readme.test.mjs, in 'README doctor and sync rows name the right refresh commands (#19,
  #25, #26)': `const prose = readFileSync(readmePath, 'utf8').replace(/\s+/g, ' ');` then assert it
  includes "re-applies any stale wiring block in a home instruction file (`banana project` refreshes
  a project's `AGENTS.md`)" and does not include 're-applies any stale wiring blocks'. Mutant: the
  README sync paragraph reverted to "…and re-applies any stale wiring blocks. Your own files —".
- G8 test/doctor.test.mjs, next to G3: for each of ['owner only', '- **Identity:** owner: `alice`.']
  and ['tag only', '- **Identity:** you are `alpha`.'], a test "stale fence (#26): sync really skips
  a half-identity block (<label>), as doctor's init remedy says": codex file = fencedBlock(body, 1) +
  '\n'; runSync with no exec; code 0; file byte-identical; err includes exactly
  `skipped ${file}: cannot recover owner/tag from the v1 block — run banana init --harnesses codex to re-fence`.
  Mutant: lib/sync.mjs `owner === null || tag === null` -> `owner === null && tag === null`.
- G9 test/doctor.test.mjs, next to G2: 'stale fence (#26): identity text after the fence does not
  count either — doctor agrees with sync'. Codex file = STALE_FENCE_NO_IDENTITY + '\nNote: you are
  `alpha`; owner: `alice`.\n'. Assert doctor's one message names
  'run banana init --harnesses codex to re-fence', and runSync leaves the file byte-identical with a
  `skipped ${file}` err line. Mutants (one at a time): doctor's slice -> `text.slice(fence.start)`;
  sync's slice -> `text.slice(fence.start)`.
- P4 `banana --help` says sync re-applies "stale wiring fences" (all of them). Test first in the
  file that already tests top-level help (test/bin.e2e.test.mjs or test/smoke.test.mjs): the help
  line for sync includes 'stale home wiring fences'. Edits: bin/banana.mjs help line
  `  sync      refresh the kit-owned canon and re-apply stale wiring fences` ->
  `  sync      refresh the kit-owned canon and re-apply stale home wiring fences`; lib/sync.mjs header
  comment, after "preserving the owner/tag the block was rendered with" add "; a block whose
  owner/tag can't be read, or a file that can't be read, is skipped with a message (#26)" and re-wrap
  that comment paragraph.

R2 done when: mutation proofs and the P4 red test recorded; `npm run check` exit 0; `npm test` 0
fail; one commit `test(doctor,sync,readme): pin #26 identity parity and #25 README prose; help names home fences`
with body sentences, `Refs #24 #25 #26`, and the Co-Authored-By line above.

## Review round 3 fixes (lane R3, on top of 121da9f)

Round 3: no product defect; 4 test gaps confirmed (3 after merging a duplicate), 2 nits. Main takes
the DESIGN intro nit (the other, STATE.md, is main's at close). Same rules and order as R1.

- G10 test/init.e2e.test.mjs, after the '(#26 review): init --harnesses <id> does not tell the user
  to paste…' test: 'e2e (#26 review): init --harnesses <id> still lists a deselected harness whose
  file has no banana block'. CLAUDE.md = '# my own notes, no banana block\n'; codex AGENTS.md = the
  identity-less v1 block; runInit(parseInitArgs(['--harnesses', 'codex', '--yes'])) with the file's
  sandbox/env/io helpers and git user name 'alice'. Assert code 0; CLAUDE.md byte-identical; output
  includes 'claude-code — re-run init'. Mutants: the filter becomes `return !existsSync(target);`;
  `findFence(…) === null` becomes `false`.
- G11 same file: 'e2e (#26 review): a deselected harness file with a corrupt fence never aborts init
  --harnesses <id>'. CLAUDE.md = '# my notes\n<!-- banana:begin v3 -->\nhalf a block, end marker
  lost\n'; codex as above. Assert code 0; the codex file carries the current agents-md opener;
  CLAUDE.md byte-identical; output includes 'claude-code — re-run init'. Mutants: the filter's
  try/catch removed; `catch { return true; }` -> `catch { return false; }`.
- G12 test/readme.test.mjs: 'README fence paragraph says sync skips a block with no identity line and
  names the init remedy (#26)': the whitespace-flattened README includes 'A block with no identity
  line is skipped (`sync` never invents one); `banana doctor` then names
  `banana init --harnesses <id>`.' Mutant: that sentence deleted from README.
- N1 docs/DESIGN.md intro: "`sync` (propagates upstream canon and wiring changes)" -> "`sync`
  (propagates upstream canon and home wiring changes)". Re-wrap that paragraph only. Pin it in
  test/templates.test.mjs next to the DESIGN fence-version test:
  `flat(design).includes('`sync` (propagates upstream canon and home wiring changes)')` (red first).

R3 done when: mutation proofs and the N1 red test recorded; `npm run check` exit 0; `npm test` 0
fail; one commit `test(init,readme): pin init's Not-wired filter and the #26 README sentence` with
body sentences, `Refs #26`, and the Co-Authored-By line above.

## Review round 4 fixes (lane R4, on top of bb806a7)

Round 4: 1 product defect, 2 test gaps. The defect is the write-side twin of round 1's P1: one
stale home file sync cannot WRITE (a read-only attribute, EACCES) throws to runSync's outer catch,
exit 1, and every later file stays stale. The v3 -> v4 bump makes sync write every wired home file
on every machine. Main extends the same fix to the canon loop (P6): it has the identical shape
(one unwritable canon file stops the canon files after it and the whole fence sweep).
Decided contract (extends P1): sync never lets one file it cannot read or write stop the others;
each such file gets a `skipped <path>: <reason>` err line, sync carries on and exits 0, and
doctor still reports whatever stayed stale. A failure to read the kit's own bundled files stays
fatal (that is a broken kit, not a user file).

- P5 lib/sync.mjs fence loop: `adapter.wire(home, { owner, tag }, wiringDir);` becomes
  ```js
      try {
        adapter.wire(home, { owner, tag }, wiringDir);
      } catch (error) {
        err(`skipped ${target}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
  ```
  Test first, test/sync.test.mjs next to P1's test: 'sync: an unwritable home target is skipped,
  later stale files are still re-fenced'. CLAUDE.md = a v1 block with an identity line, then
  `chmodSync(claudePath, 0o444)`; codex AGENTS.md = a v1 block with
  `- **Identity:** you are \`alpha\`; owner: \`alice\`.`. Probe: if a write to claudePath still
  succeeds (POSIX root), `t.skip`. Restore 0o644 in `t.after`. runSync with no exec. Assert code 0;
  an err line starts with `skipped ${claudePath}: `; the codex file carries the current opener;
  auditUpstream's stale-fence list names only claudePath.
- P6 lib/sync.mjs canon loop: the `writeKitFile(target, bundled)` call (NOT the bundled read)
  goes in a try/catch that prints `skipped ${target}: <reason>` and continues. Test first, same
  file: 'sync: an unwritable canon file is skipped; the other canon files and the fences are still
  refreshed'. Install the canon, make one installed canon file stale (different text) and 0o444,
  make another canon file stale and writable, and put a v1 identity block in codex AGENTS.md.
  Probe and restore as in P5. Assert code 0; a `skipped <that canon path>: ` err line; the other
  canon file now equals the bundled text; the codex file carries the current opener.
- Docs: docs/DESIGN.md sync move 2, "and an unreadable file is skipped the same way (a `skipped
  <path>: <reason>` line, exit 0, later files still refreshed)" -> "and a file it can't read or
  write — a wiring file or a canon file — is skipped the same way (a `skipped <path>: <reason>`
  line, exit 0, later files still refreshed)". lib/sync.mjs header comment: "or a file that can't
  be read," -> "or a file that can't be read or written (canon included),". Re-wrap only the
  touched lines.
- G13 test/canon.test.mjs, after the '#20d H52' ADR test: 'docs/adr/0006 records that #24
  superseded its state-lint-only roster bullet': the file's `flatten` of ADR 0006 includes
  '*Superseded 2026-10-14 by #24:* the roster now names `state archive`.' Mutant: delete the two
  note lines.
- G14 test/templates.test.mjs, after the DESIGN intro test: 'docs/DESIGN.md names the #26 init
  remedy where it describes doctor and sync': `flat(design)` includes each of
  'A stale home block with no readable owner/tag line names `banana init --harnesses <id>` instead, with the reason: sync skips such a block (#26;',
  "a stale block whose owner/tag it can't read is skipped with a message naming `banana init --harnesses <id>` (#26)",
  "`sync` never falls back: it skips a stale home block whose identity it can't read and names `banana init --harnesses <id>` (#26).",
  and the new P5/P6 wording "and a file it can't read or write". Mutants: each phrase deleted.

Order: G13-G14 with mutation proofs first (G14's last phrase is red until the docs edit; record
it), then P5 and P6 tests-first, then gates, then one commit
`fix(sync): skip a home or canon file it cannot write, keep refreshing the rest` with body
sentences, `Refs #24 #26`, and the Co-Authored-By line above.

## Review round 5 fixes (lane R5, on top of 189bf92)

Owner ruling, 2026-10-14 (raised by a side note on the exit-0 contract from P1/P5/P6):
sync exit = "Exit 1 if any failed (Recommended)"; canon files = "Same rule (Recommended)".
So: sync still finishes every other file, then exits 1 when any file could not be read or
written. Deliberate skips keep exit 0: a block with no owner/tag line, and a file whose markers
are malformed (both existed before this batch). Round 5 itself: no product defect, 3 test gaps.

Order: G15-G17 with mutation proofs first (on the current lib/ code), then X1 tests-first (red),
then gates, then one commit.

- X1 lib/sync.mjs. Add `let failed = 0;` next to `let changes = 0;`. Canon loop catch: add
  `failed += 1;` before `continue;`. Fence loop: split the read from the marker parse so they can
  be told apart:
  ```js
      /** @type {string} */
      let text;
      try {
        text = readFileSync(target, 'utf8');
      } catch (error) {
        err(`skipped ${target}: ${error instanceof Error ? error.message : error}`);
        failed += 1;
        continue;
      }
      /** @type {ReturnType<typeof findFence>} */
      let fence;
      try {
        fence = findFence(text);
      } catch (error) {
        err(`skipped ${target}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
  ```
  Wire catch: add `failed += 1;` before `continue;`. Replace the final summary and return with:
  ```js
    if (failed > 0) {
      out(`sync: ${changes} change(s)`);
      err(`banana sync: ${failed} file(s) could not be read or written — see the skipped lines above`);
      return { code: 1 };
    }
    out(changes === 0 ? 'sync: no changes — canon and fences current' : `sync: ${changes} change(s)`);
    return { code: 0 };
  ```
  Tests first, test/sync.test.mjs:
  - The unreadable-home-target test, the unwritable-home-target test and the unwritable-canon test
    now assert `code` 1 (message: 'a file sync could not read or write fails the run, after the
    rest is done'), keep their "later files still refreshed" assertions, and assert an err line
    `banana sync: 1 file(s) could not be read or written — see the skipped lines above`.
  - The identity-less skip test and the corrupt-fence skip test keep `code` 0 (deliberate skips).
  - New: 'sync: a read/write failure never prints "canon and fences current"': with one unwritable
    home file and nothing else to change, out has 'sync: 0 change(s)' and no line containing
    'canon and fences current'.
  Mutants to kill afterwards: each `failed += 1` removed (three, one at a time); the final
  `return { code: 1 }` -> `{ code: 0 }`; the corrupt-fence catch also counting `failed`.
- Docs: docs/DESIGN.md sync move 2: "(a `skipped <path>: <reason>` line, exit 0, later files still
  refreshed)" -> "(a `skipped <path>: <reason>` line; later files are still refreshed, then sync
  exits 1)". lib/sync.mjs header comment: after "is skipped with a message (#26)" add "; a file it
  could not read or write still makes sync exit 1 once the rest is done". Keep G14's pinned
  phrases intact. Re-wrap only the touched lines.
- G15 test/doctor.test.mjs, after G1: 'stale fence (#26): the init remedy leaves every other
  already-wired harness file alone'. All file-harness dot-dirs exist; CLAUDE.md = '# mine\n\n' +
  STALE_FENCE + '\n'; pi and codex = STALE_FENCE_NO_IDENTITY. runInit(parseInitArgs(['--harnesses',
  'codex', '--yes'])) with ENV, a throwing prompt stub and git user name 'alice'. Assert code 0;
  CLAUDE.md and the pi file byte-identical; the stale-fence messages are exactly the claude-code
  sync remedy and the pi `init --harnesses pi` remedy. Mutant: init's wire loop also re-wires a
  deselected harness whose file already has a fence.
- G16 test/init.e2e.test.mjs, in 'e2e: fresh init installs the canon dir and STATE.md plus wiring
  for detected harnesses', after the 'Other tools (no adapter)' assertion: the whitespace-flattened
  output includes 'To refresh this block, re-run `banana init` and use the copy it prints.' and
  does not include 'refreshes this block'. test/hermes.test.mjs, after the sender-header test:
  'hermes (#25): the delivered directive carries the portable refresh sentence, never a file-only
  one' — `hermes.compose({ owner: 'alice' }).directive` flattened includes that sentence and
  includes neither 'refreshes this block' nor 'refreshes the blocks in home instruction files'.
  Mutants: lib/init.mjs's paste block renders 'claude-code.md'; adapters/hermes.mjs renders
  'claude-code.md'.
- G17 test/sync.test.mjs, in the unwritable-home-target test: also take `lines` from
  `collectedIo()` and assert no line starts with `re-fenced ${claudePath}`. Mutant: the wire
  catch's `continue` deleted.

R5 done when: mutation proofs and the X1 red set recorded; `npm run check` exit 0; `npm test` 0
fail; one commit `fix(sync): exit 1 when a file could not be read or written, after the rest is done`
with body sentences (name the owner ruling), `Refs #24 #26`, and the Co-Authored-By line above.

## Review round 6 fixes (lane R6, on top of 10c7ae3)

Round 6: 4 product findings, 3 test gaps, 1 nit. Two product findings are in sync and ride this
lane (Q1, Q2). Two are in the hermes adapter's delivery (POSIX sh runs every backticked span of the
directive; on Windows cmd.exe cuts the directive at its first line feed). Both predate this batch
and need their own design; they go to the owner as a scope question, not into this lane.

- Q1 sync's summary says "no changes — canon and fences current" after a DELIBERATE skip (no
  owner/tag line, malformed markers) while that fence stays stale. lib/sync.mjs: add
  `let skipped = 0;` next to `let failed = 0;`; in the findFence catch (the one WITHOUT
  `failed += 1`) add `skipped += 1;` before `continue;`; in the `owner === null || tag === null`
  branch add `skipped += 1;` after the err(...) call; the exit-0 summary becomes
  `out(changes === 0 && skipped === 0 ? 'sync: no changes — canon and fences current' : `sync: ${changes} change(s)`);`.
  Exit codes do not change. Test first, test/sync.test.mjs: 'sync: a skipped stale block never gets
  a "canon and fences current" summary' — for each of the identity-less v1 block and
  '<!-- banana:begin v2 -->\nno end marker here\n': fresh sandbox home, one runSync to install the
  canon, then write that content to the CLAUDE.md path, run again: code 0; no line contains
  'canon and fences current'; lines include 'sync: 0 change(s)'. Mutants: each `skipped += 1`
  removed; the summary condition back to `changes === 0`.
- Q2 a canon dir sync cannot create (`mkdirSync` throws, e.g. a file sits at that path) stops sync
  before the fence loop. lib/sync.mjs: delete the standalone `mkdirSync(canonDir, { recursive: true });`
  above the canon loop, and make it the first statement inside the canon loop's existing try (before
  `result = writeKitFile(target, bundled);`). Test first: 'sync: a canon dir it cannot create never
  stops the fence refresh' — write a regular file at `<home>/.agents/canon`, a v1 identity block in
  codex AGENTS.md; runSync: code 1; an err line starts with `skipped ${join(canonDir, CANON_FILES[0])}: `;
  the codex file carries the current opener. Mutant: mkdirSync moved back outside the try.
- G18 test/sync.test.mjs: 'sync: every file it could not read or write is counted in the exit-1
  line' — pi AGENTS.md path is a directory (EISDIR) and CLAUDE.md holds a v1 identity block made
  0o444 (probe and t.skip if still writable; restore 0o644 guarded by existsSync in t.after). Assert
  code 1 and the err line `banana sync: 2 file(s) could not be read or written — see the skipped lines above`.
  Mutant: the failure line hard-codes 1, or one `failed += 1` becomes `failed = 1`.
- G19 test/sync.test.mjs: 'sync: a kit missing one of its own canon files stays fatal — no skip
  line, nothing re-fenced' — use the file's sandboxKitRoot helper, delete one bundled canon file,
  put a v1 identity block in codex AGENTS.md; runSync with that kitRoot: code 1; an err line starts
  with 'banana sync: ' and includes 'ENOENT'; no err line starts with 'skipped '; the codex file is
  byte-identical. Mutant: the canon try widened to cover the bundled read.
- G20 test/templates.test.mjs, in 'docs/DESIGN.md names the #26 init remedy where it describes
  doctor and sync': add the phrase 'later files are still refreshed, then sync exits 1'. Mutant:
  DESIGN back to "exit 0".
- N2 docs/DESIGN.md sync move 2: after "then sync exits 1" add "; the deliberate skips — no
  owner/tag line, malformed markers — keep exit 0". Keep every pinned phrase intact (G14, G20);
  re-wrap the paragraph only.

Order: G18-G20 with mutation proofs first, then Q1 and Q2 tests-first, then N2, then gates, then
one commit `fix(sync): honest summary after a deliberate skip; a canon dir it cannot create never stops the fences`
with body sentences, `Refs #26`, and the Co-Authored-By line above.

Owner ruling, 2026-10-14: the hermes delivery defects found in round 6 = "New issue, next batch
(Recommended)". Filed as #27; out of scope here.

## Review round 7 fixes (lane R7, on top of d830a0c)

Round 7: 1 product finding, 2 test gaps, 1 pre-existing nit (left for a follow-up). The product
finding predates this batch, but the v4 agents-md text names `banana project` as every
workspace's refresh, and the bump sends every project there: `runProject` creates LOGBOOK.md even
when the session log records the owner's deferral. The canon (CONTINUITY.md bootstrap step 2) says
the `project` command creates the listed files, and its LOGBOOK.md item makes a `DECISION:` line
containing `defer LOGBOOK.md` in `.agents/session.log` the owner's deferral, with the operational
test `grep "DECISION:.*defer LOGBOOK.md" .agents/session.log`. The canon wins, so the kit runs the
canon's own test.

- P7 lib/project.mjs. Before the LOGBOOK.md step, compute the seed path and the deferral (move
  `const agentsDir = join(cwd, '.agents');` and `const seedTarget = join(agentsDir, 'session.log');`
  up; keep `mkdirSync(agentsDir, …)` and the seed's createIfMissing where they are, so the order of
  "created" lines does not change):
  ```js
    // Canon CONTINUITY.md bootstrap step 2: a `DECISION:` line containing `defer LOGBOOK.md` in the
    // session log is the owner's deferral. The kit runs the canon's own test and keeps it.
    const logbookDeferred =
      existsSync(seedTarget) && /DECISION:.*defer LOGBOOK.md/.test(readFileSync(seedTarget, 'utf8'));
  ```
  then `if (!logbookDeferred && createIfMissing(logbookTarget, logbook)) created.push(logbookTarget);`,
  and after the `created` lines are printed:
  `if (logbookDeferred && !existsSync(logbookTarget)) out(`kept LOGBOOK.md deferred (a DECISION line in ${seedTarget})`);`
  Tests first, test/project.e2e.test.mjs (follow its helpers):
  - 'e2e (#25 review): project keeps a recorded LOGBOOK.md deferral while it refreshes the block' —
    workspace with `.agents/session.log` holding a line 'DECISION: defer LOGBOOK.md (owner)', a
    STATE.md, no LOGBOOK.md, and AGENTS.md holding V3_AGENTS_MD_BLOCK. Run project non-interactively.
    Assert code 0; LOGBOOK.md does not exist; the AGENTS.md block now has the current opener; output
    includes 'kept LOGBOOK.md deferred'.
  - 'e2e (#25 review): text about deferring outside a DECISION line does not defer LOGBOOK.md' —
    same, but the log line is 'NOTE: we may defer LOGBOOK.md later'. Assert LOGBOOK.md is created.
  Mutants: the `logbookDeferred` guard removed; the regex loosened to /defer LOGBOOK.md/.
  Docs: lib/project.mjs header comment "Creates LOGBOOK.md, STATE.md, and the .agents/session.log
  seed" gains "(LOGBOOK.md unless the session log records the owner's `defer LOGBOOK.md` decision,
  canon CONTINUITY step 2)". README.md project row "with `LOGBOOK.md`, `STATE.md`, …" gains, after
  the file list, "(`LOGBOOK.md` is skipped when `.agents/session.log` records a `defer LOGBOOK.md`
  decision)". Re-wrap only touched lines.
- G21 test/readme.test.mjs, the sync-row phrase list: add 'a block with no owner/tag line is
  skipped'. Mutant: that clause deleted from the README sync row.
- G22 test/templates.test.mjs, the DESIGN phrase list ('docs/DESIGN.md names the #26 init remedy…'):
  add 'the deliberate skips — no owner/tag line, malformed markers — keep exit 0' and
  "For `project` and `init`, no existing fence, or a fence whose identity line can't be parsed,
  falls back to". Mutants: each phrase deleted.

Order: G21-G22 with mutation proofs first, then P7 tests-first, then gates, then one commit
`fix(project): keep a recorded LOGBOOK.md deferral; pin the sync and DESIGN skip wording`
with body sentences, `Refs #25`, and the Co-Authored-By line above.

## Review round 8 fixes (lane R8, on top of ddd96ef)

Round 8: 1 product finding (two reviewers, same line), 3 test gaps, 1 pre-existing nit. The product
finding is a gap in round 7's own doc list: `banana --help` still says project always creates
LOGBOOK.md. Main grepped every surface for the claim; only bin/banana.mjs:288 and the README row
(already fixed) state it. Main also takes the README "Bootstrap model" nit, so a fence bump's
`banana project` step is stated where the README explains how updates travel.

- P8 bin/banana.mjs top-level help: `  project   initialize a workspace (git repo or topic dir) with LOGBOOK.md, STATE.md, and .agents/session.log`
  -> `  project   initialize a workspace (git repo or topic dir) with LOGBOOK.md (unless the session log defers it), STATE.md, and .agents/session.log`.
  Test first, test/bin.e2e.test.mjs next to the 'stale home wiring fences' help test: top-level
  `--help` stdout includes 'LOGBOOK.md (unless the session log defers it)'.
- N3 README.md "Bootstrap model": "so upstream updates propagate via `sync` instead of re-wiring."
  -> "so rule changes propagate via `sync` instead of re-wiring; when a wiring block itself changes
  (a fence version bump), `sync` refreshes the home blocks and each workspace runs `banana project`."
  Re-wrap that paragraph only. Test first in test/readme.test.mjs: the flattened README includes
  'when a wiring block itself changes (a fence version bump), `sync` refreshes the home blocks and each workspace runs `banana project`'.
  The README human-section line limit test must stay green.
- G23 test/project.e2e.test.mjs, after the NOTE-line test: 'e2e (#25 review): a DECISION line on
  another topic plus a later mention of the deferral does not defer LOGBOOK.md' — session log
  'DECISION: pick the shorter name\nNOTE: we may defer LOGBOOK.md later'; assert LOGBOOK.md is
  created. Mutants: the regex gains the `s` flag; the test becomes
  `text.includes('DECISION:') && text.includes('defer LOGBOOK.md')`.
- G24 same file: 'e2e (#25 review): a recorded deferral with LOGBOOK.md already on disk prints no
  "kept deferred" line' — deferral line recorded, LOGBOOK.md already exists ('# existing logbook\n');
  assert code 0, LOGBOOK.md byte-identical, no output line contains 'kept LOGBOOK.md deferred'.
  Mutant: the `&& !existsSync(logbookTarget)` guard dropped.
- G25 test/readme.test.mjs: the README `project` row includes "(`LOGBOOK.md` is skipped when
  `.agents/session.log` records a `defer LOGBOOK.md` decision)". Use the file's table-row helper.
  Mutant: that parenthetical deleted.

Order: G23-G25 with mutation proofs first, then P8 and N3 tests-first, then gates, then one commit
`fix(help,readme): project help names the LOGBOOK.md deferral; README says a fence bump needs banana project`
with body sentences, `Refs #25`, and the Co-Authored-By line above.

## Review rule from round 9 on (owner ruling, 2026-10-15)

Owner: "Tighten the rule (Recommended)". Product = wrong behavior or false text in lines this batch
changed (`git diff f100603 HEAD`), or a remedy doctor or sync prints that fails as printed. Every
other pre-existing defect is a note, collected for one follow-up issue (filed on the owner's go).
Still two clean rounds in a row. Before round 9, main swept bin/ usage strings, README, DESIGN,
CONTEXT, docs/agents, canon, templates, ADRs and lib/ header comments for claims about behavior
this batch changed (re-apply, refresh, LOGBOOK, exit, skip, Not wired, v3): none is stale. The
README states sync's new exit code nowhere, so R8b adds it.

## R8b (on top of bdd482f)

- README.md `banana sync` row: after "(a block with no owner/tag line is skipped; `banana project`
  refreshes a project's `AGENTS.md`)" add "; a file it cannot read or write is skipped too, and sync
  exits 1 once the rest is done". Test first, test/readme.test.mjs sync-row phrase list: add
  'a file it cannot read or write is skipped too, and sync exits 1 once the rest is done'.
- One commit `docs(readme): sync row states the exit 1 on a read/write failure`, body sentence,
  `Refs #26`, and the Co-Authored-By line above.

Owner ruling, 2026-10-15: the compaction-prep hook enters banana as "Next batch, design first
(Recommended)"; filed as #28. Out of scope here.

## Review round 9 fixes (lane R9, on top of 54a68ac)

Round 9 (tightened rule): no product defect — the first clean round. 3 test gaps; main takes two
wording notes in lines this batch wrote. The third note (init's paste advice for a file with
malformed markers) is pre-existing and goes to the follow-up list.

- G26 test/sync.test.mjs 'sync: every file it could not read or write is counted in the exit-1
  line': make it three failures in adapter order write, read, write — CLAUDE.md v1 identity block
  0o444, the pi AGENTS.md path a directory, and codex AGENTS.md a v1 identity block
  (`- **Identity:** you are \`alpha\`; owner: \`alice\`.`) 0o444; restore both modes in one
  `t.after` guarded by existsSync; assert code 1 and
  `banana sync: 3 file(s) could not be read or written — see the skipped lines above`. Add a
  comment that the write/read/write order is what lets a `failed = 1` in either fence catch
  undercount. Mutants: lib/sync.mjs wire catch `failed += 1` -> `failed = 1`; read catch the same.
- G27 same file, 'sync: a canon dir it cannot create never stops the fence refresh': after the
  `skipped ${join(canonDir, CANON_FILES[0])}: ` assertion add
  `assert.ok(errLines.includes(`banana sync: ${CANON_FILES.length} file(s) could not be read or written — see the skipped lines above`), errLines.join('\n'));`.
  Mutant: canon catch `failed += 1` -> `failed = 1`.
- G28 same file, before that test: 'sync: a home instruction file with no banana block is no skip —
  the summary says canon and fences current' — first runSync installs the canon (code 0); write
  '# my own notes, no banana block\n' to the CLAUDE.md path; run again: code 0, errLines deepEqual
  [], lines include 'sync: no changes — canon and fences current'. Mutant: `skipped += 1` added to
  the `if (fence === null) continue;` branch.
- N4 README.md: the doctor row's "for a home file whose block has no identity line (sync skips it)"
  -> "for a home file whose block has no owner/tag line (sync skips it)"; the fence paragraph's "A
  block with no identity line is skipped" -> "A block with no owner/tag line is skipped". Update the
  matching pin in test/readme.test.mjs (the fence-paragraph test's phrase and title) first, red,
  then the README. Re-wrap only the touched paragraph.
- N5 bin/banana.mjs help: the project line "… STATE.md, and .agents/session.log" -> "…, STATE.md,
  .agents/session.log, and a wired AGENTS.md block". Test first in test/bin.e2e.test.mjs next to
  the project help test: stdout includes '.agents/session.log, and a wired AGENTS.md block'. Keep
  the existing 'LOGBOOK.md (unless the session log defers it)' pin green.

Order: G26-G28 with mutation proofs first, then N4 and N5 tests-first, then gates, then one commit
`test(sync): count every read/write failure; README and help wording for #26 and #25` with body
sentences, `Refs #25 #26`, and the Co-Authored-By line above.

## Review round 10 fixes (lane R10, on top of 8e3eb95)

Round 10: 1 product defect (P10) and 3 test gaps; the clean-round count goes back to 0. Two
pre-existing notes go to the follow-up list: a `$` in an owner or tag is mangled on every re-render
(`replaceAll` with a string treats `$&`, `$'`, `$$` as patterns); doctor's auditProject and its
rotation loop read `.agents/session.log` with no guard, so an unreadable log crashes doctor.

- P10 lib/project.mjs: the round-7 deferral check (P7) reads `.agents/session.log` with no guard.
  If the log exists but cannot be read (a directory at that path, or read denied), project exits 1
  before it re-fences and AGENTS.md stays at the old version. Before this batch project never read
  the log. Main's call (ASSUMED: the owner's sync rule — report a file it cannot read, finish the
  rest, exit 1 — applied to project; confirm at the release ask):
  - Read the log only while LOGBOOK.md is missing; the deferral matters only then. With LOGBOOK.md
    on disk, project never reads the log (the pre-batch behavior).
  - LOGBOOK.md missing and the log unreadable: do not create LOGBOOK.md (a deferral there cannot be
    checked); still create STATE.md if missing and refresh the AGENTS.md block; then print on err
    `skipped LOGBOOK.md: cannot read <seedTarget> to check for a deferral (<reason>)` and
    `banana project: 1 file could not be read — see the skipped line above`; return
    `{ code: 1, created, wired }`.
  Code, replacing the `const logbookDeferred = …` statement and the `const logbookTarget` line:
  ```js
      // Canon CONTINUITY.md bootstrap step 2: a `DECISION:` line containing `defer LOGBOOK.md` in the
      // session log is the owner's deferral. The kit runs the canon's own test and keeps it. The test
      // matters only while LOGBOOK.md is missing. A log it cannot read answers neither way: LOGBOOK.md
      // is left alone, the rest is done, and project exits 1 (the same rule as sync).
      const logbookTarget = join(cwd, 'LOGBOOK.md');
      let logbookDeferred = false;
      /** @type {string | null} */
      let unreadableLog = null;
      if (!existsSync(logbookTarget) && existsSync(seedTarget)) {
        try {
          logbookDeferred = /DECISION:.*defer LOGBOOK.md/.test(readFileSync(seedTarget, 'utf8'));
        } catch (error) {
          unreadableLog = error instanceof Error ? error.message : String(error);
        }
      }
  ```
  The create line becomes
  `if (!logbookDeferred && unreadableLog === null && createIfMissing(logbookTarget, logbook)) created.push(logbookTarget);`
  and, after the `wired AGENTS.md -> …` out line:
  ```js
      if (unreadableLog !== null) {
        err(`skipped LOGBOOK.md: cannot read ${seedTarget} to check for a deferral (${unreadableLog})`);
        err('banana project: 1 file could not be read — see the skipped line above');
        return { code: 1, created, wired };
      }
  ```
  Header comment: after "decision, canon CONTINUITY step 2)" say that a session log it cannot read
  leaves LOGBOOK.md alone and makes project exit 1 once the rest is done. Re-wrap only that comment.
  Tests first in test/project.e2e.test.mjs, after 'a recorded deferral with LOGBOOK.md already on
  disk prints no "kept deferred" line' (scriptedIo has no `err`, so err lines land in `lines`):
  - T1 'e2e (#25 review): a session log project cannot read never stops the block refresh':
    repoSandbox; `mkdirSync(join(repo, '.agents', 'session.log'), { recursive: true })` (exists,
    reading throws EISDIR); STATE.md '# state\n'; AGENTS.md = V3_AGENTS_MD_BLOCK + '\n'; no
    LOGBOOK.md. runProject({ owner: null, tag: null, yes: true }, { cwd: repo, io, gitUserName: () => null }).
    Assert: code 1; AGENTS.md includes fenceBegin(CURRENT_FENCE); LOGBOOK.md does not exist; a line
    starts with `skipped LOGBOOK.md: cannot read ${join(repo, '.agents', 'session.log')} to check for a deferral (`;
    lines include 'banana project: 1 file could not be read — see the skipped line above'.
  - T2 'e2e (#25 review): with LOGBOOK.md on disk project never reads the session log': same
    fixture plus LOGBOOK.md '# logbook\n'. Assert: code 0; AGENTS.md includes
    fenceBegin(CURRENT_FENCE); no line starts with 'skipped '; LOGBOOK.md unchanged.
  Mutants to kill (record each): try/catch removed (the round-7 code); `!existsSync(logbookTarget) &&`
  dropped from the read guard; `unreadableLog === null &&` dropped from the create line; the
  unreadable branch returns code 0.
- N6 README.md project row: "(`LOGBOOK.md` is skipped when `.agents/session.log` records a
  `defer LOGBOOK.md` decision)" -> "(`LOGBOOK.md` is skipped when `.agents/session.log` records a
  `defer LOGBOOK.md` decision, and left alone when that log cannot be read; project then exits 1
  once the rest is done)". Update the pin in test/readme.test.mjs 'README project row names the
  LOGBOOK.md deferral' first (red), then the README. If the README command table turns out to be
  generated from a source file, edit that source and regenerate instead.
- G29 test/sync.test.mjs, directly after the G28 test: 'sync (#26): a CURRENT home block with no
  owner/tag line is no skip — sync agrees with doctor'. First runSync installs the canon (code 0);
  write `${fenceBegin(wiringTemplateVersion('agents-md.md'))}\nno identity line here\n<!-- banana:end -->\n`
  to the codex AGENTS.md path; run again: code 0; errLines deepEqual [] (message 'only a STALE
  block with no owner/tag line is skipped'); lines include 'sync: no changes — canon and fences
  current'; the file is byte-identical; `auditUpstream(home, sandbox(t)).filter((finding) => finding.type === 'stale-fence')`
  deepEqual []. Mutant: move `if (fence.version >= current) continue;` from above the
  extractIdentity line to just above the `try { adapter.wire(...) }` block.
- G30 test/readme.test.mjs 'README doctor and sync rows name the right refresh commands (#19, #25,
  #26)': after the loop over the three backticked commands, assert the doctor row includes
  "`banana sync` for the canon and home instruction files, `banana init --harnesses <id>` for a home file whose block has no owner/tag line (sync skips it), `banana project` for a project's `AGENTS.md`"
  ('the doctor row says which file each command fixes'). Mutant: README doctor row "owner/tag line"
  -> "identity line".
- G31 test/templates.test.mjs 'docs/DESIGN.md names the #26 init remedy where it describes doctor
  and sync': the phrase "and a file it can't read or write" -> "and a file it can't read or write —
  a wiring file or a canon file — is skipped the same way" (match the DESIGN text exactly,
  whitespace-normalized as the test already does). Mutant: delete " — a wiring file or a canon
  file —" from docs/DESIGN.md.

Order: G29-G31 with mutation proofs first; then P10 (T1, T2 red, then the code, then the mutants);
then N6 tests-first; then gates; then one commit
`fix(project): an unreadable session log never stops the block refresh` with body sentences,
`Refs #25 #26`, and the Co-Authored-By line above.

## Review round 11 fixes (lane R11, on top of 7322cfc)

Round 11 (tightened rule): no product defect — clean round 1 of 2. 5 test gaps confirmed; two
describe the same missing test, and one test covers three of them, so 3 tests. One pre-existing
note for the follow-up list: doctor reports clean for a home harness file it cannot read, while
sync exits 1 on it every run (doctor's read sits in the same `catch { continue; }` as the
malformed-markers note; merge the two there).

- G32 test/doctor.test.mjs, next to 'stale fence (#26): a stale home fence with an identity line
  keeps banana sync': 'stale fence (#26): a v1-form identity line (agent tag / Owner) keeps banana
  sync — doctor agrees with sync'. Using the file's sandbox and canon helpers, set the codex
  AGENTS.md to `fencedBlock('- **Your agent tag:** \`alpha\`. Owner: \`alice\`.', 1) + '\n'`.
  Assert `auditUpstream(home, cwd).filter((f) => f.type === 'stale-fence').map((f) => f.message)`
  deepEquals [`[stale-fence] ${file} fence is v1 but current is v${current} — run banana sync to re-fence`].
  Then runSync with no exec: code 0, a line `re-fenced ${file}: v1 -> v${current}`, no err line
  starting 'skipped ', and the stale-fence list is now []. Mutants (lib/doctor.mjs, the
  `const { owner, tag } = extractIdentity(text.slice(fence.start, fence.end));` line): (a) v2-only
  inline regexes `owner: \`([^\`]+)\`` (no /i) and `you are \`([^\`]+)\`` in place of
  extractIdentity; (b) extractIdentity for the tag but a case-sensitive owner regex
  `/owner:\*{0,2}\s*\`([^\`]+)\`/`.
- G33 test/project.e2e.test.mjs, after 'e2e (#25 review): with LOGBOOK.md on disk project never
  reads the session log': 'e2e (#25 review): an unreadable session log still creates a missing
  STATE.md, and the skip lines go to stderr'. repoSandbox; `mkdirSync(join(repo, '.agents',
  'session.log'), { recursive: true })`; no STATE.md, no LOGBOOK.md, no AGENTS.md. A local io with
  separate `out` and `err` arrays (typed `string[]`) and a prompt that throws 'unexpected prompt'.
  runProject({ owner: 'alice', tag: 'alpha', yes: true }, { cwd: repo, io, gitUserName: () => null }).
  Assert: code 1; STATE.md exists; LOGBOOK.md does not; an err line starts with
  `skipped LOGBOOK.md: cannot read ${logPath} to check for a deferral (`; err lines include
  'banana project: 1 file could not be read — see the skipped line above'; no out line starts with
  'skipped ' or 'banana project: 1 file'. Mutants: STATE.md creation guarded by
  `unreadableLog === null &&`; the skip line sent through `out` instead of `err`.
- G34 test/sync.test.mjs, after 'sync: every file it could not read or write is counted in the
  exit-1 line': 'sync: a deliberate skip in the same run is never counted in the exit-1 line'.
  The pi AGENTS.md path is a directory (EISDIR); the codex AGENTS.md is
  '<!-- banana:begin v1 -->\nno identity line here\n<!-- banana:end -->\n' (a deliberate skip).
  Assert: code 1; an err line starts with `skipped ${codexPath}: cannot recover owner/tag`; err
  lines include FAILED_LINE (the 1-file line). Mutant: the no-owner/tag branch's `skipped += 1` ->
  `failed += 1`.

Order: each test, then its mutants (record each), then gates, then one commit
`test: pin doctor on v1 identity blocks, project on an unreadable log, sync's failure count`
with body sentences, `Refs #25 #26`, and the Co-Authored-By line above.

## Review round 12 fixes (lane R12, on top of 4c0451d)

Round 12 (tightened rule): no product defect — clean round 2 of 2, so the review loop stops. Two
test gaps; both only add assertions, so they are proven by mutants and gates, with no further
review round.

- G35 test/project.e2e.test.mjs 'e2e (#25 review): a session log project cannot read never stops
  the block refresh': directly after the
  `lines.includes('banana project: 1 file could not be read — see the skipped line above')`
  assertion add:
  ```js
    assert.ok(!lines.some((line) => line.includes('kept LOGBOOK.md deferred')), lines.join('\n'));
    assert.ok(lines.includes(`wired AGENTS.md -> ${join(repo, 'AGENTS.md')}`), lines.join('\n'));
    assert.ok(
      lines.some((line) => line.startsWith(`skipped LOGBOOK.md: cannot read ${join(repo, '.agents', 'session.log')} to check for a deferral (EISDIR`)),
      lines.join('\n'),
    );
  ```
  (use the test's own log-path variable if it has one). Mutants (lib/project.mjs): the kept-deferred
  guard loses `logbookDeferred &&`; the `if (unreadableLog !== null) { … return }` block moves above
  the `wired AGENTS.md -> …` out line; `(${unreadableLog})` becomes `()`.
- G36 test/sync.test.mjs: after each of these three assertions add a reason check —
  the unwritable-home-target test's `startsWith(`skipped ${claudePath}: `)`, the unwritable-canon
  test's `startsWith(`skipped ${lockedPath}: `)`, and the canon-dir test's
  `startsWith(`skipped ${join(canonDir, CANON_FILES[0])}: `)`:
  ```js
    assert.ok(
      errLines.some((line) => line.startsWith(`skipped ${P}: `) && /^E[A-Z]+\b/.test(line.slice(`skipped ${P}: `.length))),
      errLines.join('\n'),
    );
  ```
  with P the same path expression. Do not pin one error code (EPERM on Windows, EACCES on POSIX,
  EEXIST for the canon dir). Mutants (lib/sync.mjs): the wire catch's and the canon catch's
  `${error instanceof Error ? error.message : error}` reason removed (each one separately).

Order: G35 then G36, each with its mutants (record each), then gates, then one commit
`test: pin project's unreadable-log output and sync's skip reasons` with body sentences,
`Refs #25 #26`, and the Co-Authored-By line above.
