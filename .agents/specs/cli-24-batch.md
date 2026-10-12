# cli-24 — batch: #18, #19, #22, #23

- **Source issues:** GitHub #18 (`log supersede` cannot target duplicate ids written by one agent), #19 (`sync` counts line endings as a change, and doctor names the wrong remedy for a project fence), #22 (README command table out of date), #23 (the owner handle appears in fixtures and help examples, and the deny-list skips test/, bin/ and lib/).
- **Baseline:** main 2965f94. 1036 tests: 1034 pass, 2 skipped, 0 fail. `npm run check` is clean.
- **Release target:** 0.6.0 (see Release).
- **Canon change:** none in any lane.
- **Verified by main before dispatch:** git runs with `core.autocrlf=true` (system gitconfig) and the repo has no `.gitattributes`, so commits store LF and `git diff` cannot see a working-copy line-ending flip. `LogEntry` has `date` (lib/sessionlog.mjs:44). `validateOwnerToken` accepts `none` (lib/log.mjs:469-473). No supersede test pins stderr on the `--target-agent` path (test/log.test.mjs:774-793 asserts the exit code and log text only).
- **Build:** four parallel lanes. Each lane is one worker in its own git worktree, branched from 2965f94. Every lane works TDD: write the tests, watch them go red, then implement. One integration merge follows.
- **For workers:** this spec and the files it names are your only context.

**Rules for every lane**
- Find lines by their content, not by line number. Other lanes shift lines. Line numbers below refer to main 2965f94.
- Keep each file's line endings. The critiques' grep for CR at end of line found the following; re-check before you edit.
  - CRLF: every lib/*.mjs except lib/version.mjs, bin/banana.mjs, README.md, docs/DESIGN.md, and every test/*.test.mjs except the LF ones listed below.
  - LF: lib/version.mjs, test/log.test.mjs, test/sessionlog.test.mjs, test/version.test.mjs, AGENTS.md, .agents/goal/packet.md, .agents/session.log.
  - New files are written LF.
- Fixtures and examples use placeholder names only: `alice`, `bob`, `testagent`, `claude`. Never write a real person's name or handle, a machine name, an executable path or a drive-letter path anywhere, test comments included. Lane 23's scan fails on all of them.
- No lane bumps the version, and no lane edits canon/.
- No lane writes a record file (.agents/session.log, LOGBOOK.md, STATE.md, .agents/goal/). Main records each lane's result (C18, C19).
- Gates for every lane: `npm run check`, `npm test` (report the count), `git diff --check`, a privacy grep over added lines (the four patterns at test/canon.test.mjs:54-57), and line endings kept (`git diff --stat` must show no whole-file rewrite). Prove each listed mutation: apply it, see the named test go red, revert it. Report the files changed, the test count before and after, and each mutation with the test that caught it.

## Owner rulings (2026-10-13)

**O1 — #18: what ships for duplicate ids.** Retirement is keyed by id alone: `supersessionSources` builds its map keyed by `{feature}.{n}` (lib/sessionlog.mjs:325-353; main re-read it). So no selector can retire just one of two entries that share an id.

Ruling: "--all only (Recommended)". Ship `--all` and drop `--target-date`. The ambiguity error names `--all`, plus `--target-agent` when the authors differ. `--target-agent` gets a WARN that it retires every copy. This ruling amends acceptance criteria 1-2 of #18; the close comment explains the dropped flag.

**O2 — #18 post-release cleanup.** us-008.1 is also a stale same-agent pair (.agents/session.log:147 and :272). Its 07-05 copy's NEXT is addressed to the owner (owner token `user`) and names the T3/T3-R review and the T10 ship. That review passed (session.log:280), and several releases shipped since.

Ruling: "Retire all 8 (Recommended)": us-001.1 to us-008.1.

## Calls made by claude

- **C1.** COMMANDS moves to a new side-effect-free module, lib/commands.mjs. Reason: bin reads argv and exits at top level (bin/banana.mjs:13, :271-527), so a test cannot import from it. Rejected alternatives:
  - an is-main guard: on a POSIX npm global install, argv[1] is a symlink, so the guard may stop the installed CLI (ASSUMED);
  - parsing the hand-written help at :280-287;
  - parsing the unknown-command stderr (:296): three test files need the list.
- **C2.** One README row for `state`, following the log row's precedent (README.md:77). The heading becomes `### Commands`, with no count. The archive detail goes in its own subsection.
- **C3.** Three new exports: `STATE_VERBS` (lib/state.mjs:100), `ARCHIVE_REASONS` (:103) and `CLOCK_GATES` (lib/state-archive.mjs:323). Reason: a test that hard-codes these lists is exactly the drift #22 fixes.
- **C4.** test/smoke.test.mjs:8 and test/bin.e2e.test.mjs:35 switch to importing the list. It is the same drift bug, and smoke's copy is already stale at six.
- **C5.** The #18 ambiguity error names `--target-agent <tag>` only when the remaining entries' authors differ, and always `--all on its own` (O1).
- **C6.** #18 `--all`:
  - It copies title and phase from the newest candidate: the last active-log match, else the newest archive's last match.
  - It cannot be combined with `--target-agent` (exit 1, the same idiom as the `--body -` check at lib/log.mjs:254-256).
  - With only one candidate it is accepted.
- **C7.** (Dropped with `--target-date`, O1.)
- **C8.** #19: a host file's style is judged from its text outside the fence. The splice never changes that text, so the result is idempotent. A host with no line break outside the fence counts as LF. This is documented rather than coded: the kit always ends a fence it writes with a line break (lib/fence.mjs:127-129).
- **C9.** #19 also routes init's canon loop (lib/init.mjs:177-185) through `writeKitFile`. It is the same bug on the same files, for one call site.
- **C10.** #19: `renderWiringTemplate` returns LF, so the rendered block no longer depends on how the kit was checked out.
- **C11.** #19: doctor's stale-canon messages say `run banana sync`, matching the new fence messages and :444.
- **C12.** #19 leaves alone the template files that are only created when missing (lib/project.mjs:64-68, lib/init.mjs:95-99). They are user-owned and never compared.
- **C13.** #23:
  - The placeholder is `alice`. It appears in none of the affected fixtures, apart from one parse-only `--tag` at test/state.test.mjs:3620.
  - The scan is a new file covering bin/, lib/, adapters/ and test/.
  - The exempt detector texts are read from test/canon.test.mjs's own source, not rebuilt from RegExp objects, so there is no escaping assumption.
  - The AGENTS.md bullet is a definite edit: it is a repo rule, not canon.
- **C14.** Lane 22 owns every README.md hunk, including #19's doctor-row and sync-row wording. Lane 19 does not touch README.
- **C15.** New files are LF. Reasons: there is no .gitattributes; LF files already exist in lib/ and test/; and every test that reads a file splits on any line ending. The critique asked for CRLF for the #23 file; that is rejected for one uniform rule.
- **C16.** #19: when a kit write happens, it keeps the target file's own line-ending style, and a new file is LF. Reasons: it matches `sniffEol` (lib/log.mjs:661-666), `dominantEol` (lib/state-archive.mjs:203-218) and "a CRLF page stays CRLF" (docs/DESIGN.md:938), and it is the only rule that keeps a fenced host free of mixed endings.
- **C17.** #22: canon/CONTINUITY.md:698-701 ("five reasons", "seven/thirty-day thresholds") stays as written. It is the v1.7 history entry under `## Changes from v1` (:547), and the normative bullet (:217-232) already lists six reasons. No lane edits canon.
- **C18.** Lanes write no record files. Four worktrees appending to one append-only log would conflict on every rebase, so main records each lane's result in its own cli.24 entry.
- **C19.** .agents/goal/packet.md stays as written. It is the record of a past goal run, and records are append-only.

## Lane 18 — `log supersede --all` (O1 = `--all` only)

**Files:** lib/log.mjs, bin/banana.mjs, docs/DESIGN.md, test/log.test.mjs, test/bin.e2e.test.mjs.

There is no `--target-date` flag. O1 dropped it: retirement is id-keyed, so a date selector could not narrow what is retired.

**Changes**

1. lib/log.mjs `LogFlags` typedef: after `targetAgent`, add `@property {boolean} all supersede's --all`.
2. `VERB_SPECS.supersede`: `boolean` becomes `['dry-run', 'quiet', 'all']`. `valued` is unchanged.
3. `buildFlags`:
   - Inside `if (verb === 'supersede')`, after the `--status` check, add:
     ```js
     if (p.boolean['--all'] && p.valued['--target-agent'] !== undefined) {
       throw new Error('--all retires every entry under the id - it cannot be combined with --target-agent');
     }
     ```
     A plain `Error` maps to exit 1, the same idiom as the `--body -` check (lib/log.mjs:254-256). Confirm that by reading the bin's error mapping before you rely on it.
   - In the return object, after `targetAgent`, add `all: p.boolean['--all'] ?? false,`.
4. Replace `findSupersedeTarget`. The candidate collection and the zero-candidate throws (lines 1003-1017 on main) stay byte-identical.
   ```js
   /**
    * Resolve a supersede target (#18). Retirement is id-keyed on the read side
    * (sessionlog.mjs supersessionSources): the one SUPERSEDES line retires every
    * candidate sharing the id, whatever is picked here. The pick only decides
    * which entry the new one copies title/phase from.
    * @param {{active: LogEntry[], archives: SessionArchive[], feature: string, n: number, targetAgent: string|null, all: boolean}} args
    * @returns {{entry: LogEntry, archiveFile: string|null, candidates: {entry: LogEntry, archiveFile: string|null}[]}}
    */
   function findSupersedeTarget({ active, archives, feature, n, targetAgent, all }) {
     // ...unchanged collection + zero-candidate throws...
     if (all) {
       // Newest candidate: candidates hold active-log matches first, then archives in
       // ascending name order, so the newest is the last active match, else the last one.
       const inActive = candidates.filter((c) => c.archiveFile === null);
       const pick = inActive.length > 0 ? inActive[inActive.length - 1] : candidates[candidates.length - 1];
       return { entry: pick.entry, archiveFile: pick.archiveFile, candidates };
     }
     let pool = candidates;
     if (targetAgent !== null) {
       pool = pool.filter((c) => c.entry.agent === targetAgent);
       if (pool.length === 0) throw new StateError(`no ${feature}.${n} entry authored by '${targetAgent}'`);
     }
     if (pool.length > 1) {
       const headings = pool.map((c) => c.entry.heading).join(' | ');
       if (new Set(pool.map((c) => c.entry.agent)).size > 1) {
         throw new StateError(
           `${feature}.${n} is ambiguous (${pool.length} entries) - pass --target-agent <tag> to pick the one to copy, or --all on its own; ` +
             `SUPERSEDES is id-keyed, so either way every entry under the id is retired: ${headings}`
         );
       }
       throw new StateError(
         `${feature}.${n} is ambiguous (${pool.length} entries by one author) - pass --all on its own to retire every entry under the id: ${headings}`
       );
     }
     return { entry: pool[0].entry, archiveFile: pool[0].archiveFile, candidates };
   }
   ```
   Verify the archive order claim in the comment against the collection code before you keep it.
5. `doSupersede`:
   - The call becomes `findSupersedeTarget({ active, archives, feature: targetFeature, n: targetN, targetAgent: flags.targetAgent, all: flags.all })`.
   - Keep the two existing `note:` lines (1262-1263) unchanged. Directly after them, on the same stderr channel those lines use, add:
     ```js
     if (found.candidates.length > 1) {
       const headings = found.candidates.map((c) => c.entry.heading).join(' | ');
       io.err(
         flags.all
           ? `note: --all — this entry retires all ${found.candidates.length} ${targetFeature}.${targetN} entries: ${headings}`
           : `WARN: SUPERSEDES is id-keyed — this entry retires all ${found.candidates.length} ${targetFeature}.${targetN} entries, not only the one picked: ${headings}`
       );
     }
     ```
   - Nothing else changes. The new entry is still one entry with one `SUPERSEDES:` line. The WARN and the note also fire under `--dry-run`.
6. bin/banana.mjs `LOG_SUPERSEDE_USAGE`:
   - Its usage block lists every flag the verb accepts, ending with `[--target-agent <tag>] [--all]`. Today it omits `--target-agent`; add it. Keep the existing line-wrap and indent style:
     ```
     Usage: banana log supersede <feature>.<n> --tag <agent> --reason <text> --status <s>
                     [--next-owner <o>] [--next <text>] [--title <text>] [--phase <p>]
                     [--feature <slug>] [--body <line>]... [--dry-run] [--quiet]
                     [--target-agent <tag>] [--all]
     ```
     Check this flag list against `VERB_SPECS.supersede` after your edit: every valued, repeatable and boolean flag appears once.
   - Keep the "Correct or retire…canon-sanctioned." paragraph. After it, insert:
     ```
     Duplicate ids: when <feature>.<n> names more than one entry, pick the one to
     copy title/phase from with --target-agent, or pass --all on its own.
     SUPERSEDES is id-keyed: every entry under the id is retired either way.
     ```
   - The examples and the exit-code line stay unchanged.
7. docs/DESIGN.md:
   - **(i)** At :136-137, replace "A hand-mangled log with two entries … (see GitHub #18)." with: "A log with two entries at the same `{feature}.{n}` (a hand-mangled heading, a collided `n`, or two build loops restarting one slug at `.1`) therefore has both retired together. `banana log supersede` says so instead of hiding it (#18; see the `log` write contract's duplicate-id bullet). Retiring exactly one of two same-id entries would need a qualified `SUPERSEDES:` grammar, which is a canon change and is deliberately not made."
   - **(ii)** At :150, replace "after a hand-mangled heading" with "after a hand-mangled heading, a collided `n`, or a build loop restarting a slug at `.1`".
   - **(iii)** Insert a new bullet after the collided-`n` bullet that ends at :386: "- **Duplicate-id supersede (#18).** `supersede <feature>.<n>` collects every entry under the id across the active log and the archives. When more than one remains after `--target-agent`, it refuses (exit 2). The error names `--target-agent <tag>` when the remaining entries' authors differ, and always `--all` on its own. `--target-agent` only picks the entry whose title/phase the new entry copies: the written `SUPERSEDES: {feature}.{n} ({reason})` line is id-keyed and retires every entry under the id, and the tool prints a `WARN:` saying so. `--all` retires the id outright and copies from the newest candidate (the last active-log match, else the newest archive's last match); it cannot be combined with `--target-agent` (exit 1). Either way, exactly one entry with one `SUPERSEDES:` line is written. A date selector was considered and dropped (owner ruling): it could not narrow what is retired."

**Tests (red first).** Write them all, then run `node --test test/log.test.mjs test/bin.e2e.test.mjs` and confirm the new ones fail.

Shared conventions:
- Today in the tests is 2026-08-12 (`LOCAL_NOW`, test/log.test.mjs:28).
- Use the existing `run`, `makeProject`, `makeArchive`, `readLog` and `SEED` helpers, plus `parseSessionLog`/`supersededIds` (already imported at :8).
- Every supersede argv in these tests ends with `--reason x --status complete --next-owner t --next y` unless stated otherwise.
- Add the helper `projectWithSameAgentDup()`: SEED + `\n## [2026-08-01] testagent dup.1 | build — first loop\nSTATUS: complete\nNEXT: testagent — pick up story 2\n\n## [2026-08-02] testagent dup.1 | review — second loop\nSTATUS: complete\nNEXT: testagent — pick up story 2 again\n`.

The tests:
- **T1** · test/log.test.mjs · `parseLogArgs: supersede maps --all`
  - Asserts: with `--all`, `all === true`; without it, `all === false`.
  - Kills: the VERB_SPECS entry or the mapping left out.
- **T2** · `parseLogArgs: --all cannot be combined with --target-agent`
  - Asserts: `assert.throws`, matching `/--all retires every entry under the id - it cannot be combined with --target-agent/`.
  - Kills: deleting the exclusivity check.
- **T3** · `supersede (#18): a same-agent duplicate id is ambiguous without a flag - the error names --all on its own, not --target-agent`
  - Asserts: code 2; err matches `/dup\.1 is ambiguous \(2 entries by one author\)/` and `/--all on its own/`; err does not match `/--target-agent/` or `/--target-date/`; the log is byte-identical.
  - Kills: the message always naming `--target-agent` (the issue's bug); returning `pool[0]`.
- **T4** · `supersede (#18): --all writes exactly one entry whose one SUPERSEDES line retires every same-agent dup.1`
  - Asserts: code 0; out `['dup.2']`; exactly one parsed entry `dup`/2; exactly one `/^SUPERSEDES: dup\.1 \(x\)$/gm`; `supersededIds(...)` has `dup.1`; both n=1 entries are still present; the heading matches `/dup\.2 \| review — second loop/`; err matches `/note: --all — this entry retires all 2 dup\.1 entries/`.
  - Kills: `--all` ignored; one entry per candidate; copying from the first candidate.
- **T5** · `supersede (#18): the author check runs on the narrowed pool - --target-agent is not re-offered`
  - Fixture: alice 08-01 `alice first`, alice 08-02 `alice second`, bob 08-03 `bob third`, all `dup.1`.
  - Asserts, with `--target-agent alice` only: code 2; err matches `/2 entries by one author/` and `/--all on its own/`; err does not match `/pass --target-agent/`.
  - Kills: building the author check from `candidates` instead of `pool`.
- **T6** · `supersede (#18): --all prefers the active log over an archive`
  - Fixture: active log SEED + `## [2026-08-02] testagent dup.1 | build — active copy` (STATUS/NEXT lines); `makeArchive(dir,'2026-Q1.log','## [2026-02-01] testagent dup.1 | build — archived copy\nSTATUS: complete\nNEXT: t — x\n')`.
  - Asserts: out `['dup.2']`; log matches `/dup\.2 \| build — active copy/`; err matches `/retires all 2 dup\.1 entries/`; err does not match `/resolved from archive/`.
  - Kills: picking `candidates[candidates.length-1]`.
- **T7** · `supersede (#18): --all with every candidate archived copies the newest archive's match`
  - Fixture: active log SEED + one unrelated `other.1` entry; archives `2026-Q1.log` (2026-02-01 `q1 copy`) and `2026-Q2.log` (2026-05-01 `q2 copy`).
  - Asserts: code 0; out `['dup.2']`; log matches `/dup\.2 \| build — q2 copy/`; err matches `/resolved from archive .*2026-Q2\.log/` and `/retires all 2 dup\.1 entries/`.
  - Kills: always using `inActive[last]` (TypeError); using `candidates[0]` for archive-only sets.
- **T8** · `supersede (#18): --all on a unique id is a plain supersede with no retirement note`
  - Argv: `['supersede','cli.1','--tag','testagent','--reason','x','--status','complete','--next-owner','t','--next','y','--all']`, run on `projectWithClosedCli1()`.
  - Asserts: code 0; log matches `/SUPERSEDES: cli\.1 \(x\)/`; err does not match `/retires all/`.
  - Kills: a note firing on `>= 1` candidates.
- **T9** · `supersede (#18): --target-agent WARNs that the id-keyed line retires every entry under the id`
  - Fixture: the alice/bob pair from the existing test at :774.
  - Asserts, with `--target-agent alice`: code 0; err matches `/WARN: SUPERSEDES is id-keyed — this entry retires all 2 dup\.1 entries, not only the one picked/`; `supersededIds` has `dup.1`.
  - Kills: a WARN gated on `--all`, or no WARN.
- **T10** · test/bin.e2e.test.mjs (after the stub `--help` test at :241-246) · ``bin: `banana log supersede --help` documents --target-agent and --all``
  - Asserts: status 0; stdout starts with `Usage: banana log supersede`; stdout includes `--target-agent <tag>`, `--all` and `SUPERSEDES is id-keyed`; stdout does not include `--target-date`; stderr is `''`.
  - Kills: help text not updated.
- The existing test at :774 stays green unchanged: its pair differs by author, so the message still names `--target-agent`.

**DoD.**
- Gates as above. Expected: +10 tests.
- Mutations to prove: the ones named in T3, T4, T5, T6, T7, T8 and T9.

## Lane 19 — line endings in kit writes, and doctor's remedy text

**Files:** lib/fence.mjs, lib/wiring.mjs, lib/sync.mjs, lib/init.mjs, lib/doctor.mjs, docs/DESIGN.md, test/fence.test.mjs, test/adapters.test.mjs, test/sync.test.mjs, test/doctor.test.mjs, test/init.e2e.test.mjs, test/project.e2e.test.mjs. Not README.md (Lane 22 owns it).

**Order.**
1. Write the new tests, and at the same time relax the byte-equality assertions (relaxed, they pass both before and after the change).
2. Watch the new tests go red.
3. Implement.
4. Commit init's canon loop (C9) and test I1 as their own commit.

**Changes**

1. lib/fence.mjs:
   - Extend the header comment: "Also owns the kit's line-ending rule (#19): a line-ending difference is never a change; a write keeps the target's own style (LF for a new file)."
   - After `fencedBlock`, add these exports:
     ```js
     /** Text with every CRLF line break turned into LF; a lone CR is content, not a line break. @param {string} text @returns {string} */
     export function toLf(text) { return text.replace(/\r\n/g, '\n'); }

     /** The style a text already uses (#19): '\r\n' when CRLF breaks outnumber bare-LF ones, else '\n' (ties and break-less text are LF). @param {string} text @returns {'\r\n' | '\n'} */
     export function eolOf(text) {
       const crlf = (text.match(/\r\n/g) ?? []).length;
       const lf = (text.match(/\n/g) ?? []).length - crlf;
       return crlf > lf ? '\r\n' : '\n';
     }

     /** Text with every line break rewritten in the given style. @param {string} text @param {'\r\n' | '\n'} eol @returns {string} */
     export function withEol(text, eol) {
       const lf = toLf(text);
       return eol === '\n' ? lf : lf.replaceAll('\n', '\r\n');
     }

     /**
      * Install or refresh a kit-owned whole file — the canon (#19). Line endings alone are never a
      * change; a real change keeps the existing file's style (eolOf); a new file is LF.
      * @param {string} filePath @param {string} text the kit's content, any style
      * @returns {{ created: boolean, changed: boolean }}
      */
     export function writeKitFile(filePath, text) {
       const before = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
       if (before !== null && toLf(before) === toLf(text)) return { created: false, changed: false };
       writeFileSync(filePath, withEol(text, before === null ? '\n' : eolOf(before)));
       return { created: before === null, changed: true };
     }
     ```
   - New `spliceFence` body:
     ```js
     blockVersion(block);
     const found = findFence(text);
     // #19: the block takes the host's style, judged from the text OUTSIDE the fence — the splice never
     // changes that text, so a second apply judges the same style. Break-less outside text is LF.
     const outside = found === null ? text : text.slice(0, found.start) + text.slice(found.end);
     const eol = eolOf(outside);
     const fitted = withEol(block, eol);
     if (found !== null) return text.slice(0, found.start) + fitted + text.slice(found.end);
     if (text === '') return fitted + eol;
     const sep = text.endsWith('\n') ? eol : eol + eol;
     return text + sep + fitted + eol;
     ```
   - Add to the `spliceFence` JSDoc: "The block is written in the host's line-ending style (eolOf of the text outside the fence; LF when new or break-less)."
   - Add to the `applyFence` JSDoc: "Its byte compare runs against a block already fitted to the host, so a CRLF host carrying the same block reports changed: false."
2. lib/wiring.mjs:
   - Import `toLf` from './fence.mjs'.
   - `renderWiringTemplate` returns `toLf(raw).replaceAll('__OWNER__', owner).replaceAll('__AGENT_TAG__', tag).trimEnd()`.
   - Its `@returns` becomes "fenced block, markers included, LF line breaks whatever the template file uses (#19), no trailing newline".
3. lib/sync.mjs:
   - Imports become `existsSync, mkdirSync, readFileSync` (drop the unused `writeFileSync`, verified to be used only at :270) and `extractIdentity, findFence, writeKitFile`.
   - Canon loop body (:265-273):
     ```js
     const target = join(canonDir, name);
     const bundled = readFileSync(join(kitRoot, 'canon', name), 'utf8');
     const { created, changed } = writeKitFile(target, bundled);
     if (!changed) continue;
     out(`${created ? 'installed' : 'refreshed'} ${target}`);
     changes += 1;
     ```
   - Header comment at :6: replace "to the bundled canon byte-for-byte" with "to the bundled canon's text — a line-ending difference alone is never a change (#19, lib/fence.mjs writeKitFile)".
   - Append to the canon-loop comment: "Compared modulo CRLF/LF; a write keeps the installed file's own line endings (LF when new)."
   - All output strings stay unchanged.
4. lib/init.mjs:
   - Import `readPreservedIdentity, writeKitFile`.
   - The loop at :177-185 becomes:
     ```js
     const result = writeKitFile(target, bundled);
     if (!result.changed) continue;
     if (result.created) created.push(target);
     else out(`refreshed ${target}`);
     ```
     The `target` and `bundled` lines stay as they are.
5. lib/doctor.mjs:
   - `wired` entries gain `remedy: 'banana sync'` for the FILE_ADAPTERS entries and `remedy: 'banana project'` for `join(cwd, 'AGENTS.md')`. Destructure `{ target, template, remedy }`.
   - Messages, verbatim:
     - `[stale-fence] ${target} fence is v${fence.version} but current is v${current} — run ${remedy} to re-fence`
     - `[stale-canon] ${canonDir} missing — run banana sync to install the canon`
     - `` `but the kit bundles rev ${bundled} — run banana sync to refresh the canon` ``
   - Header comment, :8-9 becomes: "…and any wired fence block older than its current template (remedy: `banana sync` for a home harness file, `banana project` for the project's AGENTS.md — #19). Exit 0 clean, 1 when any audit hits."
   - JSDoc at :326-328 becomes: "Both drift states are mechanical. Each finding names the command that fixes it: `banana sync` for the canon and home harness files, `banana project` for the project's AGENTS.md (sync never touches project files — #19). Unwired files (missing or fence-less) are skipped, matching the re-fencing commands' own eligibility rule (only already-fenced files)."
6. docs/DESIGN.md:
   - **(i)** Item 2 at :250-255: retitle it "**Canon + fence refresh (v1.2; compare rule #19).**" and change "byte-for-byte" to "to the bundled canon's text". The rest stays.
   - **(ii)** Before "**Known limitation…**" (:257), insert: "**Line endings (#19).** A line-ending difference is never a change. The canon refresh compares text with CRLF read as LF, so a canon file whose text matches the kit's modulo CRLF/LF is left untouched and prints nothing; a fence re-apply is gated on the block's version number, never its bytes. When sync does write, the target keeps the style it already has: a refreshed canon file keeps its own, and a re-fenced block takes the style of its host's text outside the fence (CRLF when CRLF line breaks outnumber LF ones, else LF; a host with no line break outside the fence counts as LF). A file the kit creates is LF, and rendered wiring templates are LF however the kit was checked out. The rule lives in `lib/fence.mjs` (`toLf`, `eolOf`, `withEol`, `writeKitFile`, `spliceFence`); `init` installs the canon through the same `writeKitFile`, and `init`/`project` write fences through the same `spliceFence`."
   - **(iii)** At :287, replace "Both findings name `sync` as the remediation." with "`stale-canon` names `banana sync`; `stale-fence` names the command that re-fences that file (#19): `banana sync` for a home harness file, `banana project` for the project's `AGENTS.md` (sync never touches project files)."
   - **(iv)** At :349, after "second run must be byte-identical)." insert "The block is written in the line-ending style of the host's text outside the fence, LF for a new file, so a CRLF file stays CRLF (#19)."
   - **(v)** At :350, change `v2` to `v3` (test/templates.test.mjs:77 pins v3).

**Tests.** Use local helpers in each test file: `asLf = s => s.replace(/\r\n/g,'\n')`, `asCrlf = s => asLf(s).replace(/\n/g,'\r\n')`, `hasBareLf = s => /(^|[^\r])\n/.test(s)`.

test/fence.test.mjs (BLOCK_V1, BLOCK_V2 and `fencedBlock` are already there):
- **F1** · `eolOf: CRLF only when CRLF line breaks outnumber bare LF; ties and break-less text are LF (#19)`
  - Asserts: `'a\r\nb\r\n'` gives CRLF; `'a\nb\n'` gives LF; `'a\r\nb\n'` gives LF; `'a\r\nb\r\nc\n'` gives CRLF; `''` and `'one line'` give LF.
  - Kills: an "any CRLF wins" rule.
- **F2** · `withEol / toLf: CRLF<->LF without doubling, lone CR untouched (#19)`
  - Asserts: `withEol('a\nb\r\nc','\r\n')==='a\r\nb\r\nc'`; `withEol('a\r\nb\n','\n')==='a\nb\n'`; `toLf('a\rb\r\n')==='a\rb\n'`.
  - Kills: a naive replace that turns CRLF into CR-CR-LF.
- **F3** · `spliceFence writes a replaced block in the CRLF host's style; bytes outside the fence untouched (#19)`
  - Asserts: `spliceFence('head\r\n\r\n'+asCrlf(BLOCK_V1)+'\r\ntail\r\n', BLOCK_V2) === 'head\r\n\r\n'+asCrlf(BLOCK_V2)+'\r\ntail\r\n'`.
  - Kills: a verbatim replace (:125).
- **F4** · `spliceFence appends to a CRLF host in CRLF (#19)`
  - Asserts: with `host='# notes\r\nkeep\r\n'`, the result `=== host+'\r\n'+asCrlf(BLOCK_V1)+'\r\n'`.
  - Kills: a hard-coded `'\n'` (:128-129).
- **F5** · `spliceFence fits a CRLF block into an LF host, and a new file is LF (#19)`
  - Asserts: `spliceFence('a\n', asCrlf(BLOCK_V1))` contains no `\r`; `spliceFence('', asCrlf(BLOCK_V1)) === BLOCK_V1+'\n'`.
  - Kills: fitting toward CRLF only.
- **F6** · `spliceFence is idempotent on a mixed host: style judged outside the fence (#19)`
  - Setup: `host='a\r\nb\r\nc\r\n'+fencedBlock('l1\nl2\nl3\nl4\nl5\nl6',1)+'\r\n'`, `nb=fencedBlock('x',2)`, `s1=spliceFence(host,nb)`, `s2=spliceFence(s1,nb)`.
  - Asserts: `s1 === s2`; the fence region of s1 includes `\r\n` and has no bare LF.
  - Kills: judging the style from the whole text.
- **F7** · `applyFence on a CRLF host already carrying the same block reports unchanged and writes nothing (#19)`
  - Kills: comparing against an unfitted block.
- **F8** · `writeKitFile: a CRLF-only difference is no change and writes nothing, both directions (#19)`
  - Asserts: returns `{created:false,changed:false}` and the bytes are unchanged.
  - Kills: an exact compare.
- **F9** · `writeKitFile: a real change keeps the existing file's style; a new file is LF (#19)`
  - Asserts:
    - `'old\r\n'` + `'new\nline\n'` gives `'new\r\nline\r\n'`;
    - `'old\n'` + `'new\r\nline\r\n'` gives `'new\nline\n'`;
    - a missing file + `'a\r\nb\r\n'` gives `{created:true,changed:true}` and `'a\nb\n'`.
  - Kills: verbatim writes.

test/adapters.test.mjs (override-dir tests at :149-194):
- **A1** · `renderWiringTemplate returns LF whatever line endings the template file uses (#19)`
  - Setup: copy templates/wiring into a temp dir and rewrite claude-code.md there as CRLF.
  - Asserts: the render contains no `\r` and equals the render from an LF copy.
  - Kills: dropping `toLf`.

test/sync.test.mjs (helpers `sandboxKitRoot`, `snapshot`, `assertTreesIdentical`, `collectedIo`, `V1_BLOCK` exist):
- **S1** · `#19: a canon file that differs from the kit only in line endings is no change — nothing printed, nothing written`
  - Setup: in home/.agents/canon, write each kitRoot canon file's flipped twin (`asLf` if it contains `\r\n`, else `asCrlf`); run `runSync(parseSyncArgs([]),{home,io,kitRoot})`.
  - Asserts: code 0; no line matches `/^(installed|refreshed) /`; the lines include `sync: no changes — canon and fences current`; the trees are identical.
  - Kills: `existing === bundled`.
- **S2** · `#19: a real canon change keeps the installed file's line-ending style`
  - CRLF case: rewrite kitRoot CONTINUITY.md as `asLf(...)`; home file `'<!-- banana:canon rev 1.1 -->\r\nstale\r\n'`. Asserts: `refreshed` is printed; `asLf(file)===asLf(kit)`; `!hasBareLf(file)`.
  - LF case: kitRoot file forced to CRLF, home file stale and LF. Asserts: the result has no `\r`.
  - Kills: a verbatim refresh, on any checkout.
- **S3** · `#19: a canon file sync creates is written with LF`
  - Setup: kitRoot canon forced to CRLF; empty home.
  - Asserts: `installed` is printed 3 times; no `\r`; the text equals the kit's.
  - Kills: a verbatim create.
- **S4** · `#19: a harness file at the current fence version is no change whatever its line endings`
  - Setup: home .claude/CLAUDE.md = `asCrlf` of `# mine` plus the current `renderWiringTemplate('claude-code.md',{owner:'alice',tag:'claude'})`.
  - Asserts: no `re-fenced` line; bytes unchanged.
  - Characterization: green from the start. Kills: replacing the version gate (:297) with a bytes compare.
- **S5** · `#19: re-fencing a CRLF harness file writes the new block in CRLF; bytes outside the fence untouched; second run byte-identical`
  - Setup: home .claude/CLAUDE.md = `asCrlf` of `# My instructions\n\nuser prose above\n\n${V1_BLOCK}\nuser prose below\n`.
  - Asserts: the `v1 -> v${CURRENT_FENCE}` line is printed; the slices outside the fence are unchanged; the block region has `\r\n` and no bare LF; a second run prints `no changes` and the trees are identical.
  - Kills: verbatim splicing.
- **Relax.** Add `sameText(a,b) = asLf(readFileSync(a,'utf8')) === asLf(readFileSync(b,'utf8'))`.
  - Replace the `readFileSync(X).equals(readFileSync(Y))` canon asserts at test/sync.test.mjs:130-133, 417-420, 605-608, 673-676, 753-756, 771-774 and 809-812, and at test/init.e2e.test.mjs:116-118 and 197-200.
  - At test/sync.test.mjs:897-901, wrap both sides in `asLf`.
  - Rename test/sync.test.mjs:119 to `e2e: sync refreshes a stale canon to the bundled text and upgrades a v1 fence to v3`.
  - Change test/init.e2e.test.mjs:200's message to `stale canon file refreshed to the bundled text`, and :118's to `canon/${name} is the bundled canon's text`.

test/doctor.test.mjs:
- **D1** · `stale fence (#19): each stale fence names the command that re-fences it — banana sync for a home file, banana project for the project AGENTS.md`
  - Setup: `installCanon(home)`; home/.codex/AGENTS.md and cwd/AGENTS.md each = `fencedBlock('# continuity wiring',1)+'\n'`.
  - Asserts: the stale-fence messages deep-equal the two verbatim strings, with `current = wiringTemplateVersion('agents-md.md')`.
  - Kills: a single message; keying the remedy on template or basename (codex's home file is also AGENTS.md).
- Tighten the existing tests:
  - :586 also asserts `'— run banana project to re-fence'` is present and `'run banana sync to re-fence'` is absent;
  - :523 and :567 assert `'— run banana sync to re-fence'`;
  - :494 asserts `'run banana sync to refresh the canon'`;
  - :508 asserts `'run banana sync to install the canon'`.
- Header comment at :7-10 becomes "…each flagged with exit 1 and a finding naming its fix command (banana sync, or banana project for the project AGENTS.md — #19)".

test/init.e2e.test.mjs:
- **I1** · `#19: a canon file that differs from the kit only in line endings is no change for init`
  - Setup: seed the flipped twins; `runInit(parseInitArgs(['--owner','alice','--yes']),{home,env:NO_PATH,io})`.
  - Asserts: no line starts with `refreshed `; `result.created` holds no canon path; the canon bytes are unchanged.
  - Kills: reverting init.mjs:181.

test/project.e2e.test.mjs:
- **P1** · `#19: a CRLF project AGENTS.md already carrying the current block reports (already current)`
  - Setup: model on that file's existing re-run test. Run project once, rewrite AGENTS.md as `asCrlf` of its text, then run again.
  - Asserts: the AGENTS.md output line includes `(already current)`; bytes unchanged.
  - Pins the user-visible behaviour of lib/project.mjs:147-150.

**DoD.**
- Gates as above. Expected: +18 tests.
- Mutations to prove: S1, F4, F6, F9, A1, D1, I1.

## Lane 22 — README command table, derived from the CLI

**Files:** lib/commands.mjs (new, LF), bin/banana.mjs, lib/state.mjs, lib/state-archive.mjs, README.md, test/readme.test.mjs, test/commands.test.mjs (new, LF), test/smoke.test.mjs, test/bin.e2e.test.mjs.

**TDD order.** ESM imports are linked before any test runs, so readme.test.mjs fails as a whole file until steps 1-3 exist.
1. Write test/commands.test.mjs and the readme tests, and see the link failure.
2. Do steps 1-3 below.
3. See each of the six readme tests red, one per README defect.
4. Do step 5, and everything goes green.

**Steps**

1. **lib/commands.mjs**, new:
   ```js
   // The CLI's command vocabulary — every `banana <command>` word bin/banana.mjs
   // dispatches, in its top-level help order. Single-sourced here, not in bin/,
   // because bin/banana.mjs runs on import (it reads process.argv and dispatches
   // at top level), so a test can't import a constant from it; the README drift
   // tests (test/readme.test.mjs, #22) read this list. `version` is not a member:
   // bin answers it (with --version/-v) before the COMMANDS guard runs.

   /** @type {string[]} */
   export const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync', 'log', 'state'];
   ```
2. **bin/banana.mjs:**
   - Add `import { COMMANDS } from '../lib/commands.mjs';` after the `node:path` import (:6).
   - Delete :12.
   - At :518-519, the comment's opening lines become `// Unreachable: the COMMANDS guard above already rejects anything not in the` / `// COMMANDS vocabulary (lib/commands.mjs), and every member of COMMANDS has a dispatch arm`. The rest of the comment continues unchanged.
3. **Exports:**
   - lib/state.mjs:100 `export const STATE_VERBS`;
   - lib/state.mjs:103 `export const ARCHIVE_REASONS`;
   - lib/state-archive.mjs:323 `export const CLOCK_GATES`.
4. **Test files that switch to the import:**
   - test/smoke.test.mjs: delete :8 and import COMMANDS. Rename :36 to `bin --help lists every command in lib/commands.mjs COMMANDS`.
   - test/bin.e2e.test.mjs: delete :35 and import COMMANDS beside :29. Rename :89 to `bin: top-level --help and -h exit 0 and list every COMMANDS entry`.
5. **README.md:**
   - **(i)** Replace :44-50 with:
     ```markdown
     - **User-owned surfaces:** `~/.agents/STATE.md`, session logs, logbooks —
       created if missing, their content never rewritten by the kit. The one
       exception is `banana state archive`, which moves one named line off the
       global `STATE.md` into `STATE-archive.md` (`--reason trimmed` only copies
       it) — see "Archiving a global STATE line" below.
     ```
   - **(ii)** Change :60 to `### Commands`.
   - **(iii)** Replace :68 with `Offline, `sync` warns and carries on, and `doctor` skips its check silently.` This is an adjacent correction: sync warns (lib/sync.mjs:4-5) and doctor is silent (lib/doctor.mjs:419).
   - **(iv)** Replace :70 to the end of the file with the block below. The file ends with one newline.
     - The doctor and sync rows carry #19's wording.
     - The fence paragraph narrows "Every write" to instruction-file writes. This is an adjacent correction: the AGENTS.md rule is that config-file writes go through lib/fence.mjs.
     - The sync row's "silent-warns" becomes "warns and carries on", to match (iii).
     ```markdown
     | Command | What it does |
     |---|---|
     | `banana init` | detect installed harnesses, install the canon into `~/.agents/canon/`, wire the bootstrap block into each instruction file. Non-interactive: `--owner`, `--tag`, `--harnesses`, `--yes`. `--deliver` also runs the Hermes one-shot delivery command instead of only printing it |
     | `banana project` | initialize the current workspace (git repo or non-code topic dir) with `LOGBOOK.md`, `STATE.md`, `.agents/session.log`, and a wired `AGENTS.md` continuity block. Non-interactive: `--owner`, `--tag`, `--yes` |
     | `banana brief <feature> --tag <agent>` | compile a per-intent context brief — feature-scoped, deterministic, no LLM calls. No feature arg lists the active slugs |
     | `banana doctor` | audit wiring versions, canon staleness, and log liveness; each stale finding names its fix — `banana sync` for the canon and home instruction files, `banana project` for a project's `AGENTS.md`. Also a best-effort remote-version check (silent offline). `--verify` prints per-harness recital commands |
     | `banana sync` | run the kit's own update step (best-effort; warns and carries on offline), then refresh the kit-owned canon and re-apply any wiring fence older than current; a line-ending difference alone is never a change |
     | `banana log stub\|append\|close\|supersede` | stamp session-log entries — the envelope (heading, STATUS/NEXT composition, concurrency-guard continuation) is computed, never hand-typed. `banana log <verb> --help` for usage |
     | `banana state lint\|archive` | `lint [--global]`: check a `STATE.md` page against the canon's mechanical invariants — `./STATE.md`, or `~/.agents/STATE.md` with `--global`; verdicts FAIL / WARN / PASS, never reads the clock. `archive --global --match <text> --reason <reason> --tag <agent> [--dry-run]`: move one line off the global page into `~/.agents/STATE-archive.md` (see "Archiving a global STATE line" below). `banana state <verb> --help` for usage |

     `banana version` prints the installed kit version. Under npx, use that bare
     word: npm keeps `--version` and `-v` for itself, so they never reach banana.

     Every write into an agent's instruction file is a fenced, version-marked
     block (`<!-- banana:begin v3 -->` … `<!-- banana:end -->`): re-running is
     idempotent, and content outside the fence is never touched. Owner and tag
     are recovered from the existing block on re-fence, so `sync` needs no flags.

     ### Archiving a global STATE line

     `banana state archive` moves one top-level bullet off `~/.agents/STATE.md`.
     It copies the line verbatim into the append-only `~/.agents/STATE-archive.md`
     first, then removes it from the page. If that empties the line's section,
     the command writes back that section's own placeholder line. `--dry-run`
     prints the record and the action and writes nothing.

     - `--global` is required. Project pages keep their history in `LOGBOOK.md`
       instead.
     - `--match <text>` is a case-sensitive substring of the bullet's own line.
       It must pick exactly one bullet; byte-identical duplicates archive the
       first. A bullet wrapped onto a second line is refused: join it into one
       line first.
     - `--tag <agent>` names the agent recording the move.
     - `--reason <reason>` is one of six:
       - `expired`: a Recently-closed line whose `(closed YYYY-MM-DD)` stamp is
         more than 7 days before today.
       - `inactive`: an Active-threads line whose `(as of YYYY-MM-DD)` stamp is
         more than 14 days before today. Refused if the thread's project page is
         newer than the stamp; that thread's own session refreshes the stamp
         instead.
       - `dormant`: a Backlog (owned) line whose `(queued YYYY-MM-DD)` stamp is
         more than 21 days before today.
       - `closed`: a finished Active-threads line. Afterwards, add its one-line
         Recently-closed entry by hand; the command prints a reminder.
       - `trimmed`: copy only. The page is left as it is; shorten the line in
         place by hand.
       - `removed`: anything else the owner drops.

     `trimmed` and `removed` work in any of the four sections; every other
     reason refuses a line outside its own section. `expired`, `inactive` and
     `dormant` also read the clock: they refuse (exit 2) while the matched line's
     own stamp is not yet past its limit, or is dated after today. A line with
     no stamp at all needs `--reason removed`.

     A pasted secret (a credential, token or key) is never archived, not even as
     a copy: delete it from the page by hand.
     ```
6. **test/readme.test.mjs:**
   - Change the comment at :11 to `// The canonical invocation per the wiring templates (templates.test.mjs NPX_INVOCATION).`
   - Delete :14-15.
   - Add imports: `COMMANDS` (lib/commands.mjs), `fenceBegin` (lib/fence.mjs), `wiringTemplateVersion` (lib/wiring.mjs), `ARCHIVE_REASONS, STATE_VERBS` (lib/state.mjs), `CLOCK_GATES` (lib/state-archive.mjs).
   - Add the constants `CURRENT_FENCE_BEGIN = fenceBegin(wiringTemplateVersion('claude-code.md'))` and `ARCHIVE_HEADING = '### Archiving a global STATE line'`.
   - Add these helpers. Both split on `/\r?\n/`; use a reverse `for` loop, not `findLast` (target es2022):
     - `tableRows(text)`: for each line matching `/^\| `banana ([a-z]+)/`, push `{cmd: m[1], line}`.
     - `sectionFlat(text, heading)`: the lines after `heading` up to the next `/^#{1,6}\s/`, joined, with `/\s+/g` replaced by `' '`. Returns `null` if the heading is absent.
   - Replace the test at :34-42 with the tests below.

**Tests (red first)**
- **R1** · readme · `README.md command table has exactly one row per CLI command, and the state row names every state verb`
  - Asserts: none missing, none unknown, none duplicated between the `tableRows` words and COMMANDS; the state row's first cell (`line.split(' | ')[0]`) includes every STATE_VERBS entry.
  - Kills: a command without a row (today `state`); a stale or duplicate row; a whole-README `includes` check; a third state verb with no row. Do not simplify this back to `text.includes`: that version passes on today's README.
- **R2** · `README.md command table sits under a Commands heading with no count`
  - Asserts: the nearest heading above the `| Command |` line exists; it matches `/command/i`; it does not match `/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/i`.
  - Kills: "The six commands"; a deleted heading (it would fall back to `### Bootstrap model`).
- **R3** · ``README.md command rows list every flag their command's --help usage names``
  - Asserts: for each cmd, collect the `--[a-z][a-z-]*` tokens from `banana <cmd> --help`. For `state`, add the first line of `banana state <verb> --help` for each STATE_VERBS entry. Every token must match `` new RegExp(`${flag}(?![a-z-])`) `` against that row.
  - Kills: a missing `--deliver` or project flags (today); a new top-level or state-verb flag with no README row.
  - Known survivor: a row naming a flag the CLI has dropped. A reverse check would wrongly fail the log row.
- **R4** · `README.md fence example carries the version the wiring templates write`
  - Asserts: every `/<!-- banana:begin v\d+ -->/g` in the README equals CURRENT_FENCE_BEGIN, and there is at least one.
  - Kills: the v2 example; a template bump that leaves the README behind.
- **R5** · `README.md archive section covers --global, all six reasons (trimmed copy-only) and each reason's own clock gate`
  - Asserts, on the flattened section:
    - it includes ``'`--global` is required'``;
    - it includes `` `\`${r}\`:` `` for each ARCHIVE_REASONS entry;
    - it includes ``'`trimmed`: copy only. The page is left as it is'``;
    - for each `[reason, {keyword, limit}]` of `Object.entries(CLOCK_GATES)`, it matches `` new RegExp(`\`${reason}\`: [^\`]*\`\\(${keyword} YYYY-MM-DD\\)\` stamp is more than ${limit} days`) ``.
  - Kills: prose saying trimmed removes the line; a dropped or added reason; swapped gates or numbers; a changed constant.
- **R6** · ``README.md documents the bare `banana version` subcommand``
  - Asserts: the README includes ``'`banana version`'``.
- **K1** · test/commands.test.mjs · `bin's unknown-command guard names exactly lib/commands.mjs COMMANDS`
  - Asserts: `spawnSync(process.execPath,[binPath,'peel'])` gives status 1 and trimmed stderr `` `banana: unknown command 'peel' (expected ${COMMANDS.join('|')})` ``.
  - Kills: bin keeping a private COMMANDS copy.
- The existing tests 'opens by saying', 'npx one-liner', 'canon dir path', 'human section ≤ 40' and '--version' stay unchanged.

**DoD.**
- Gates as above. Expected: +6 tests net (−1 removed, +6 readme, +1 commands).
- Mutations to prove: delete the state row (R1 red); change the heading to "The seven commands" (R2 red); drop `--deliver` (R3 red); revert to v2 (R4 red); swap 14 and 21 (R5 red); add a private `const COMMANDS` to bin with one entry removed (K1 red).

## Lane 23 — placeholder owner in fixtures, and a deny-list over the source tree

**Files:** test/deny-list.test.mjs (new, LF), test/state-archive.test.mjs, test/state.test.mjs, test/sessionlog.test.mjs, bin/banana.mjs, lib/state.mjs, AGENTS.md.

**Part A — test/deny-list.test.mjs.** Write it first.

Hard rule: none of the four forbidden strings may appear in this file outside its FORBIDDEN_PATTERNS block, in any letter case. That covers test names, comments, strings and messages. Build every planted string from the patterns themselves.

```js
// The deny-list over the source tree (#23). canon/ and templates/ keep their
// own scans (test/canon.test.mjs, test/templates.test.mjs); this file covers
// every dir the typecheck covers (tsconfig.json include): bin/, lib/,
// adapters/, test/. Fixtures, help examples and comments use a placeholder
// owner such as `alice`, never a real person's name or handle.
//
// Two things are sanctioned, each stripped as a substring, never by skipping
// a line or a file: the public repo slug (the kit's distribution coordinate),
// and the deny-list entries themselves, byte-exact, which live in exactly
// three files: test/canon.test.mjs, test/templates.test.mjs and this one.
// This file scans itself: nothing forbidden appears here outside the
// FORBIDDEN_PATTERNS block; planted test text is built from the patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SCANNED_DIRS = ['bin', 'lib', 'adapters', 'test'];
const REPO_SLUG = '<copy the REPO_SLUG string value from test/templates.test.mjs:147 verbatim>';

// Byte-identical to test/canon.test.mjs:54-57 and test/templates.test.mjs:149-152.
const FORBIDDEN_PATTERNS = [
  <copy the four lines test/canon.test.mjs:54-57 verbatim>
];

const OWNER_PATTERN = FORBIDDEN_PATTERNS[0];
const PLANTED_HANDLE = OWNER_PATTERN.re.source;
const DENY_LIST_CARRIERS = ['test/canon.test.mjs', 'test/deny-list.test.mjs', 'test/templates.test.mjs'];

/**
 * A file's deny-list entry lines, trimmed, trailing comma dropped.
 * @param {string} text
 * @returns {string[]}
 */
function entryLines(text) {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => /^[ \t]*\{ name: '[^']*', re: \//.test(line))
    .map((line) => line.trim().replace(/,$/, ''));
}

// The exempt entry texts, read from the canonical copy's SOURCE — never rebuilt
// from the RegExp objects, so no escaping assumption is involved.
const DETECTOR_LITERALS = entryLines(readFileSync(join(repoRoot, 'test', 'canon.test.mjs'), 'utf8'));
```

Then add these functions, following the idiom of test/templates.test.mjs:46-55:
- `walk(rel)`: recursive; returns repo-relative paths with forward slashes.
- `scannedFiles()`: `SCANNED_DIRS.flatMap(walk)`.
- `forbiddenReferencesIn(text)`: split on `/\r\n|\r|\n/`. For each line: `replaceAll(REPO_SLUG,'')`, then `replaceAll` each DETECTOR_LITERALS entry with `''`, then push `` `line ${i+1}: ${name}` `` for each pattern whose `re` tests true on what is left.

**Tests**
- **D1** · `bin/, lib/, adapters/ and test/ carry zero machine-specific references (#23)`
  - Asserts: every hit across `scannedFiles()`, reported as `` `${rel} ${hit}` ``, deep-equals `[]`. The failure message reads: "forbidden references; use a placeholder owner such as alice (only the repo slug and the deny-list entries are exempt):" followed by the list.
- **D2** · `the scan reaches every source dir`
  - Asserts: SCANNED_DIRS deep-equals `JSON.parse(readFileSync(join(repoRoot,'tsconfig.json'),'utf8')).include.map((g) => g.split('/')[0])` (tsconfig.json:12 is plain JSON); `scannedFiles()` contains bin/banana.mjs, lib/state.mjs, adapters/claude-code.mjs and test/deny-list.test.mjs.
  - Kills: a dir in tsconfig but not scanned; a walk that returns nothing.
- **D3** · `the deny-list entries live in exactly three files, each carrying the same entries in the same order`
  - Asserts:
    - `DETECTOR_LITERALS.length === FORBIDDEN_PATTERNS.length`;
    - the scanned files containing any literal, sorted, deep-equal DENY_LIST_CARRIERS;
    - for each carrier, `entryLines(text)` deep-equals DETECTOR_LITERALS.
  - Kills: a fifth entry added to one carrier only; copies drifting apart; a fourth file smuggling in a copied entry.
- **D4** · `negative control: a planted handle is caught in any letter case, with its line number`
  - Asserts: `` forbiddenReferencesIn(`first line\n- ${PLANTED_HANDLE.toUpperCase()} — review the shipped slice\n`) `` deep-equals `` [`line 2: ${OWNER_PATTERN.name}`] ``.
  - Kills: a stubbed function; line numbering off by one; a lost `/i`.
- **D5** · `negative control: only the full repo slug is exempt, as a substring`
  - Asserts:
    - `` `npx --yes github:${REPO_SLUG} --owner ${PLANTED_HANDLE}` `` gives one owner hit;
    - `` `owner: ${REPO_SLUG.split('/')[0]}` `` gives one owner hit;
    - `` `${REPO_SLUG} ${REPO_SLUG}` `` gives `[]`.
  - Kills: skipping slug lines; a slug shortened to the account name; `replace` used instead of `replaceAll`.
- **D6** · `negative control: only a byte-exact deny-list entry is exempt, as a substring`
  - Asserts:
    - `` `  ${DETECTOR_LITERALS[0]},` `` gives `[]`;
    - `` `${DETECTOR_LITERALS[0]} ${DETECTOR_LITERALS[0]}` `` gives `[]`;
    - `` `  ${DETECTOR_LITERALS[0]}, // ${PLANTED_HANDLE}` `` gives one owner hit;
    - `` `  { name: 'owner', re: /${PLANTED_HANDLE}/i },` `` (kept inside the assert call, so no source line starts with it) gives one owner hit.
  - Kills: a line-skip exemption; a shape-based exemption; `replace` used instead of `replaceAll`.
- **Accepted survivor:** a non-recursive walk. No scanned dir has a subdirectory today.

**Red-first.**
1. Stub `forbiddenReferencesIn` as `return [];`. D4-D6 go red; D1 passes vacuously.
2. Implement the function. D1 goes red with exactly 31 hits: bin/banana.mjs ×2, lib/state.mjs ×1, test/sessionlog.test.mjs ×1, test/state.test.mjs ×10 lines, test/state-archive.test.mjs ×17 lines.
3. Do Part B, and everything goes green.

**Part B — data edits.**
- Find the handle as the `owner:` value in AGENTS.md:34.
- Replace every occurrence with `alice` in test/state-archive.test.mjs, test/state.test.mjs, test/sessionlog.test.mjs, bin/banana.mjs and lib/state.mjs. That is 32 occurrences on 31 lines, all lowercase. test/state.test.mjs:1764 has two on one line: change both arguments, so it stays a deliberate no-op.
- Find lines by content. Expected results:
  - bin/banana.mjs:73: `  banana log close myapp --tag testagent --status complete --next-owner alice --next "review the shipped form"`
  - bin/banana.mjs:76: `  banana log close myapp --tag testagent --status complete --next-owner alice --next 'review the shipped form'`
  - lib/state.mjs:602: ``(F8/F11: `-  alice`,`` (keep the two spaces)
  - test/sessionlog.test.mjs:173: `  assert.equal(nextOwner('NEXT: alice+claude — pair on the review'), 'alice+claude');`
- User-visible change: `banana log close --help` now shows `--next-owner alice`.
- Hardening: in the test at test/state.test.mjs:2815, add `assert.notEqual(text, CLEAN_STATE, 'sanity: the replace must hit the CLEAN_STATE Next bullets');` right after the `const text = CLEAN_STATE.replace(...)` line. This kills a search string left stale at :2817, which would otherwise make the test pass silently.
- AGENTS.md (LF): after the "Public records" bullet (:11-13) and outside the fenced block, add: "- Sample data: fixtures, help examples and code comments use placeholder names (`alice`, `bob`), never a real person's name or handle. `test/deny-list.test.mjs` enforces this over bin/, lib/, adapters/ and test/ (canon/ and templates/ have their own scans); its scanned dirs are checked against the tsconfig include list."

**DoD.**
- Gates as above. Expected: +6 tests; 1042 standalone (1040 pass, 2 skipped).
- Mutations to prove: D1 (revert one replacement), D3 (a fifth entry in canon.test.mjs only), D5 (account-name slug), D6 (line-skip).
- Follow-up, filed by claude after merge and named in the close-out NEXT: test/state.test.mjs:1762-1768's title claims "fenced Next", but :1764 is a no-op replace.

## Cross-lane

| File | Lane 18 | Lane 19 | Lane 22 | Lane 23 |
|---|---|---|---|---|
| bin/banana.mjs | LOG_SUPERSEDE_USAGE :80-97 | — | import after :6, delete :12, comment :518-519 | :73, :76 |
| lib/state.mjs | — | — | :100, :103 export | :602 comment |
| lib/state-archive.mjs | — | — | :323 export | — |
| docs/DESIGN.md | :134-137, :150, after :386 | :250-257, :287, :349-350 | — | — |
| README.md | — | — (rows written by 22) | all hunks | — |
| test/bin.e2e.test.mjs | new test after :246 | — | :29, :35, :89 | — |
| AGENTS.md | — | — | — | new bullet after :13 |

**Merge order: 22 → 19 → 18 → 23.**
- Lane 22 goes first: it owns README and the bin import.
- Lane 19 next: the largest lib change.
- Lane 18 then: its :80-97 hunk sits three unchanged lines from Lane 23's :76.
- Lane 23 goes last: it is the tripwire, so its scan runs over every lane's fixtures.

**Integration re-checks**
1. After each merge, run `npm run check && npm test` and record the count.
2. README's doctor and sync rows (Lane 22) agree with lib/doctor.mjs's merged messages (`run banana sync to re-fence` / `run banana project to re-fence`).
3. Lane 22's R3 flag test stays green after Lane 18: Lane 18 does not touch LOG_USAGE, and the log row points to `banana log <verb> --help`. If any lane adds a `--flag` token to a top-level usage or a state-verb usage line, add it to that README row.
4. Lane 23's D1 is green over every merged fixture, and D3 still finds exactly three carriers. No lane's new test may contain an entry-shaped line.
5. bin/banana.mjs carries all three lanes' hunks; LOG_CLOSE_USAGE says `alice`.
6. EOL: git runs with core.autocrlf=true, so `git diff` cannot show a working-copy line-ending flip. Main snapshots each tracked file's CR and LF counts before dispatch. After each merge, compare every changed file against the snapshot: a CRLF file must have no bare LF, and an LF file no CR. Fix any flip before release.
7. Privacy grep over the paths the scan does not cover. Run the four patterns from test/canon.test.mjs:54-57 over `git diff 2965f94 -U0 -- README.md docs .agents AGENTS.md | grep '^+'`. Only the repo slug may hit.
8. Projected merged count, unverified: 1036 + 10 + 18 + 6 + 6 = 1076 tests (1074 pass, 2 skipped). Record the real number.

## Release

- **Version: 0.5.0 → 0.6.0**, bumped by the integration pass after all four merges.
  - Why minor: #18 adds CLI surface (`--all`; pre-1.0 new surface goes to a minor), #19 changes sync and doctor output, and #22/#23 change the docs and help text.
  - Why bump at all: doctor's origin check compares the remote package.json version with the local one (lib/doctor.mjs:431-444). An unbumped release never tells installed kits they are behind.
- **Records.** The repo has no CHANGELOG file; the LOGBOOK is the release record.
  - Add a `kit.18 | SESSION` entry and, after the push, a `kit.19 | RELEASE` entry, in the existing WHAT/DONE/ref/NEXT shape (LOGBOOK.md:96-114).
  - WHAT should name each issue's user-visible change: supersede `--all` and the id-keyed WARN on `--target-agent`; sync ignores line-ending-only differences and keeps each file's style; doctor names `banana project` for a project fence; the README command table derived from the CLI; the placeholder owner and source-tree deny-list.
  - Lanes write no record files; main records each lane's result in cli.24 (C18).
- **Post-release, on the owner machine:** push; run `banana sync` (expect "kit updated: v0.5.0 -> v0.6.0" and no canon change, since no canon text changed — expected, unverified until the run); check home files are byte-identical to a pre-sync backup; `banana doctor` is clean; close #18, #19, #22 and #23 with evidence.
- **Cleanup.** Retire the duplicate handoffs in this repo's own .agents/session.log: us-001.1 to us-007.1 (session.log:91-139 and :212-263), and us-008.1 (O2). Run once per N, from the repo root:
  - `banana log supersede us-00N.1 --all --tag claude --title "retire stale story NEXT us-00N.1" --reason "stale story handoff; both loops finished and shipped" --status complete --next-owner none --next "consumed by the loop"`
  - The title and NEXT follow the us-009.2/us-010.2 precedent (session.log:532-540).
  - Each run prints `note: --all — this entry retires all 2 us-00N.1 entries: …` and outputs `us-00N.2`.
  - session.log is 684 lines now (verified). About 5 lines per entry will take it past 700 (ROTATION_LINES, lib/sessionlog.mjs:22), so the rotation WARN is expected from that point on. It is advisory; rotation is a separate later step.
  - Verify: `banana brief <another-feature> --tag claude` lists no us-00N.1 handoff.

## Amendments from critique

No critique raised a blocker.

**#18**
- Applied:
  - `--all` hint says "on its own" (Lane 18 step 4, T3, T7).
  - Archive-only `--all` test (T11).
  - Unique-id argv spelled out (T12).
  - Rotation WARN stated as certain, 684 lines verified (Release).
  - Unsorted-dates fixture (T5).
  - Picker-from-pool test (T9).
  - Em dash in the WARN and the note; StateError keeps ` - `, matching :1016 and :1027.
  - AC2 narrowing recorded (C5).
  - DESIGN :150 and bullet wording (step 7).
  - Cleanup `--title` (Release).
  - EOL facts (rules).
- O1 = `--all` only: Lane 18 was rewritten to that form by main. The date-selector tests are dropped; the narrowed-pool test survives as T5, and the WARN on `--target-agent` is T9.
- Owner rulings: O1, O2 (2026-10-13).

**#19**
- Applied:
  - Citation fixes: adapters override tests are at :149-194; dominantEol is at :203-218.
  - init no-change test (I1).
  - packet.md lines (step 7): struck by main; the file stays as written (C19).
  - CRLF keep-style case uses an LF kit (S2).
  - Blind spot handled by option (b), a documented doc line (C8, DESIGN ii).
  - Two stale comments.
  - DESIGN :350 v3 (README :79 handled by Lane 22).
  - tsc risk restated: tsconfig has no noUnusedLocals (tsconfig.json:9), so the import is dropped for hygiene only.
  - doctor cwd = home recorded as a risk.
  - project.e2e characterization (P1).
- The line-ending question became call C16. Init scope became call C9.

**#22**
- Applied:
  - State verbs checked in the row (R1).
  - State-verb flags (R3).
  - Heading test matches `/command/i` (R2).
  - bin :519 comment.
  - Hermes sentence dropped (iii).
  - Per-reason CLOCK_GATES regex (R5).
  - TDD order stated.
  - New lib file LF.
  - Adjacent corrections labelled.
  - Lane 23 named in the hotspots.
  - Flag-test survivor noted.
  - Stderr-parse alternative recorded (C1).
- Recorded as verified by the critique (lib/state-archive.mjs:836-846), not re-read here: the closed and trimmed reminders. The placeholder write-back stays unverified.
- The canon history-text question became call C17.

**#23**
- Applied:
  - Count fixed to 1042.
  - Two-way carrier check (D3).
  - Line-skip mutation (D6).
  - Account-name mutation (D5).
  - The String(re) fallback replaced by deriving literals from canon.test.mjs source.
  - `replaceAll` asserts.
  - Non-recursive-walk survivor accepted.
  - Self-scan rule covers all four patterns.
  - AGENTS.md bullet made definite; SCANNED_DIRS checked against tsconfig.
  - The :1764 follow-up has an owner.
- Rejected: CRLF for the new file. C15 sets one LF rule, and the scan works with any line ending.
