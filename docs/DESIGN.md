# banana — design spec (authoritative for this build)

> The task packet at `.agents/goal/packet.md` holds the done-whens. This file holds the WHY and the
> exact behavioral contracts. A fresh-context iteration reads both before implementing anything.

## What banana is

A harness-neutral continuity kit. It installs a file-based coordination protocol shared by every
AI agent (Claude Code, Pi, Codex, Hermes, …) and human on a machine, so that work survives session
death and no agent's private memory becomes load-bearing. Five commands: `init` (machine wiring),
`project` (repo init), `brief` (per-intent context compiler), `doctor` (audits), `sync` (propagates
upstream canon and wiring changes).

## The architecture being shipped (canon v1.3)

The protocol's v1 lives at the canon source paths listed in prd.json. v1.1 adds the
**pollution-control architecture**:

1. **Hot/cold surface tiering.** Hot = auto-loaded every session: projections only (global STATE,
   project STATE), one page each, facts only. Cold = chronology and entry bodies (LOGBOOK.md,
   session.log bodies): never auto-loaded, grep-on-demand only.
2. **Closed allowlist entry ritual.** A session reads exactly: its compiled brief (see below).
   Nothing else by default. Counter-failure: anything visible gets woven into plans, so relevance
   filtering must happen before context load, not after.
3. **Headings-not-bodies.** For other agents'/features' in-flight work, a session may see entry
   HEADINGS (awareness that work exists) but not bodies (no exposure to approach). Counter-failure:
   anchoring on another session's approach.
4. **48h ghost rule.** A `STATUS: in-progress` entry older than 48h is a ghost: flagged in briefs
   and by doctor; the next session in that project closes it as `abandoned` via a superseding
   entry. Counter-failure: dead claims steering live sessions.
5. **Snapshot session lifecycle (BEGIN/WORK/CLOSE).** BEGIN: declare intent (feature slug), compile
   brief, treat it as a snapshot. WORK: no mid-session re-reads of shared state; the session's own
   open log entry is the cohesion anchor (re-read it after compaction). CLOSE: land the plane —
   close entry with owned NEXT, promote project-worthy events, rebuild stale projections; conflicts
   with concurrently-landed work reconcile here, not mid-flight. Counter-failure: shared files
   changing under a session mid-task.
6. **Preserved v1 invariants** (unchanged, restated in canon): append-only + `SUPERSEDES:`
   corrections, agent attribution in every entry, owned `NEXT:`, rebuild-don't-patch projections,
   pointers-not-payloads, event-triggered writes.

Canon v1.1 must carry a "Changes from v1" section listing exactly the additions above.

### v1.2 additions

v1.2 adds the **agent-first bootstrap and upstream model** on top of v1.1; nothing from v1.1 is
removed. Mirrors canon's "Changes from v1" items 9-12 (`canon/CONTINUITY.md`):

9. **Agent bootstrap section.** A zero-context agent self-initializes any bare workspace (git repo
   or non-code topic dir) from the canon alone: which files to create, the entry envelope, the
   session ritual. Counter-failure: cold landings producing ad-hoc or absent record-keeping.
10. **Upstream/sync surface ownership.** `~/.agents/canon/` is kit-owned and sync-overwritable
    (`sync` refreshes it freely); STATE pages, session logs, and logbooks are user-owned and never
    overwritten by the kit — created only if missing. Counter-failure: stale-protocol drift on
    wired machines, and updaters trampling user record surfaces.
11. **Version markers.** Every canon file opens with a machine-readable marker,
    `<!-- banana:canon rev X.Y -->`, giving `doctor` and `sync` a mechanical staleness check.
    Counter-failure: undetectable canon drift.
12. **Topic-grain workspaces.** A workspace needing continuity may be a git repository or a
    non-code topic directory (research notes, a course, an ops runbook) — the protocol and the
    kit's `project` command apply to both. Counter-failure: continuity gated on version control,
    leaving non-code work recordless.

Canon v1.2 carries these as part of the same "Changes from v1" section, numbered 9-12 following
v1.1's items 1-8.

### v1.3 additions

v1.3 amends the **project-STATE maintenance discipline** (ADR 0001,
`docs/adr/0001-state-rebuild-on-close.md`); nothing from v1.2 is removed. Mirrors canon's
"Changes from v1" item 13 (`canon/CONTINUITY.md`):

13. **Rebuild-on-close.** Project STATE pages only: mid-arc surgical section patches are legal,
    each ensuring the dirty-marker line (`> ⚠ patched since last rebuild — log is authority`) as
    the final line of the header block; the close-time rebuild's judgment-free trigger extends to
    promotion OR standing marker, and the rebuild removes the marker. Recovery is lazy: a standing
    marker obliges nothing at open. The global page is unchanged (rebuilt whole, never patched).
    Enforcement — doctor and `state lint` WARN on a standing marker — ships with the state-lint
    work, not this amendment. Counter-failure: per-touch rebuild cost driving silent
    rebuild-skipping; loud staleness (the marker) replaces silent staleness.

### v1.4 additions

v1.4 amends the **ghost surfaces** (ADR 0003, `docs/adr/0003-log-auto-continuation.md`); nothing
else changes. Mirrors canon's "Changes from v1" item 14 (`canon/CONTINUITY.md`):

14. **Supersession-aware ghosts.** An entry named by a `SUPERSEDES:` reference is retired from
    ghost surfaces (brief, doctor, by-hand scan) regardless of its own status line; the superseding
    entry carries the liveness clock and is itself subject to the 48h rule. Motivated by `log`'s
    auto-continuation (ADR 0003): without the carve-out, every continuation would manufacture a
    permanent false ghost from its predecessor. Counter-failure: zombie ghost flags on corrected
    history burying the real ones.

## `brief` — behavioral contract

`banana brief <feature> --tag <agent>` writes a brief to stdout, compiled from the project's
continuity files. Include / exclude:

| Include | Exclude |
|---|---|
| target feature's session.log entries: the most recent CLOSED entry and every entry whose own STATUS isn't terminal (open, missing, or off-vocabulary — #8, F4), full bodies; older closed entries, heading only (#8) | other features' entry BODIES; any entry retired by a SAME-STREAM `SUPERSEDES:` reference, whatever its own STATUS, always heading only (#8 follow-up 2, narrowed to same-stream by F3) |
| headings only of the last 5 entries from other features | other projects' content |
| the TARGET feature's own `NEXT:` lines whenever Feature history rendered that entry in full (F1); every OTHER feature stream's LATEST entry (by log position, over ALL entries, then skipped if THAT entry is retired by any-stream `SUPERSEDES:` — F5) — its `NEXT:` lines, if owned by `--tag` or unowned (#8 follow-up 3) | NEXT owned by other agents; for other features, any NEXT from a stream's non-latest entry, or from a stream whose latest entry is itself retired |
| project STATE.md verbatim (one page by contract) | global STATE (machine grain, not project) |
| ghosts: any in-progress entry older than 48h, flagged | Entries retired by a `SUPERSEDES:` reference are excluded (supersession-aware, canon CONTINUITY v1.4 / ADR 0003; stream-agnostic — a cross-stream rename/move still resolves the ghost, F9). |

Every section header carries a `ref:` line naming its source file (the brief is an index into the
record, not a replacement for it). Deterministic only — no LLM calls, pure text processing.

**Target-feature grain (#8, follow-up 2; narrowed by adversarial-review F3/F4).** Among the target
feature's own entries, only the most recent CLOSED entry and every entry whose own `STATUS:` is NOT
terminal show in full (heading, ghost flag where it applies, body); every OLDER closed entry shows as
its heading line only — log order is kept throughout, entries are never reordered or dropped.
"Closed" is classified by TERMINAL_STATUSES membership (`complete`/`blocked`/`abandoned`), not by
`isOpen`'s exact `in-progress` match (F4): an entry whose `STATUS:` line is missing, or off-vocabulary
(e.g. `STATUS: in progress`), is therefore NOT closed and shows in full too, rather than silently
losing its body. An entry named by a `SUPERSEDES:` reference from a superseder in the SAME feature
stream is never shown in full regardless of its own `STATUS:` — excluded from both the
full-vs-heading decision and from candidacy for "most recent closed" (F3: narrowed from "any
superseder" — a CROSS-stream supersede, e.g. a rename/move where a different feature's entry retires
this one, keeps the body in full instead, or briefing the renamed-away feature would carry no content
at all). Ghost-flag suppression on the inline `[GHOST ...]` line stays on the FULL, stream-agnostic id
set regardless (F9): the canon's ghost retirement doesn't care which feature did the retiring, so a
cross-stream-retired open entry still shows its body but never its ghost flag. Same-vs-cross-stream is
read from `lib/sessionlog.mjs`'s `supersessionSources` (a `Map<id, entry[]>` of superseders per
retired id); `supersededIds` (the ghost-facing, stream-agnostic id set) is now derived from it. This
reuses the session-log parsing seam rather than a second parser. The point is compression: a feature
with a long closed history no longer pays for every past entry's full body on every brief read, only
its most recent resolution plus whatever is still open. **Duplicate ids (F6):** retirement is
id-keyed — a `SUPERSEDES:` line retires EVERY entry sharing that id, not just the one instance a
writer meant. A hand-mangled log with two entries at the same `{feature}.{n}` therefore has both
retired together; there is no cheap fix for this (see GitHub #18).

**Handoffs — live, not historical (#8 follow-up 3; F1/F5 fix a self-contradiction and a
resurfacing bug).** Per canon entry-ritual item 5, `NEXT:` lines are drawn from the surfaces the
brief already exposes — and the target feature's own full bodies (Feature history, above) are one of
them. So `## Handoffs` uses TWO eligibility rules, not one:
- **The TARGET feature's own entries (F1):** eligible whenever Feature history rendered that exact
  entry in full — the SAME set the grain paragraph above computes, not a separate "is it this
  stream's latest entry" test. Gating the target feature on "latest entry" hid a live NEXT on its
  last CLOSE whenever a newer OPEN entry (with no NEXT yet) existed — a real bug on the kit's own log
  (cli.15's NEXT dropped out because cli.16/cli.17 were open with none).
- **Every OTHER feature stream:** canon's resume rule ("read the latest STATUS/NEXT") still applies.
  The LATEST entry is taken by LOG POSITION, not by id (F6: retirement is id-keyed, and two entries
  can share an id after a hand-mangled heading; see GitHub #18) — over ALL entries first, THEN a
  retired winner is skipped (F5: filtering retirement BEFORE picking "latest" let an older NEXT
  resurface when the stream's true latest entry was itself retired; a same-stream continuation is
  unaffected, since it's the last entry by position and therefore never the one retired). Retirement
  here uses the FULL, stream-agnostic id set (a retired entry's `NEXT:` is dead whoever retired it) —
  not the same-stream-only set the target-feature grain uses.

Either way, only `NEXT:` lines owned by `--tag` or unowned are eligible (unowned handoffs still
surface — the canon wants those visible, not just tag-owned ones), and a stream/entry with no `NEXT:`
at all contributes nothing — including an OPEN entry with no `NEXT:` yet: that means someone is
already working it, not that the record has nothing to say.

**Kit-version and dirty-status lines (#8, follow-up 4).** Directly under the compiled brief's title
blockquote — discovery mode has no title blockquote and does not carry these two lines — before the
blank line and `## State lint`: a `kit: v<version>` line, sourced from `readKitVersion(kitRoot)` in
`lib/version.mjs` (`kit: unknown` when it returns `null`; never a network call), then a
`STATE: <status>` line reporting the project STATE.md's dirty-marker status — `STATE: dirty (patched
since last rebuild; the log is authority)` when the standing marker is present, `STATE: clean` when
STATE.md exists without it, `STATE: none` when there is no project STATE.md, `STATE: unreadable` when
it exists but can't be read (kept distinct from `none` so this line never contradicts the
`## State lint` section's own `unreadable (...)` verdict for the same file, printed a few lines
below). The marker is detected by reusing `lib/state.mjs`'s own detection
(`DIRTY_MARKER_LINE`/`checkDirtyMarker`, over the same fence/comment-blanked text `prepareText` gives
`state lint`), never a second parser. `compileBrief`/`runBrief` take an injected `kitRoot` (default
the bundled kit's own root) — the same test-seam pattern as `home`; `bin/` never passes it.

**`## State lint` section (#14).** Both modes (a compiled feature brief, and discovery mode with no
feature) print a `## State lint` section immediately after the brief's header block, before
`## Project state` / any other content — the brief is the session-start guarantee that a lint
nobody runs by hand still gets surfaced. Built from `lib/state.mjs`'s `collectStateLint({ cwd, home
})` (no subprocess, no argv parsing) and `formatStateLintLines`, so the finding text is byte-for-byte
the same `state lint` itself would print. Content, in order: a `project: <VERDICT> · global:
<VERDICT>` summary line (`<VERDICT>` is the lint's own summary text with no `state lint: ` prefix —
`PASS`, `WARN (N warn)`, `FAIL (N fail, M warn)`, `none (<reason>)` when the target page doesn't
exist, or `unreadable (<reason>)` when it exists but can't be read); then every finding line exactly
as `state lint` prints it, project findings first, then global (no findings — no extra lines); then,
only when either side's verdict is FAIL, one closing line: `Fix these before relying on the page: a
FAIL means STATE no longer projects its sources.` Lint never changes `brief`'s exit code or stops it
from printing the rest of the brief — an existing-but-unreadable STATE.md degrades to a `(STATE.md
exists but could not be read)` placeholder in `## Project state` rather than throwing. `brief`'s
runner takes an injected `home` (only `bin/` resolves `os.homedir()`), same as `state lint --global`.

## `sync` — behavioral contract

`banana sync` is the explicit updater (ADR 0002, `docs/adr/0002-local-shim-sync-as-updater.md`):
the installed shim never updates itself, and version skew across machines is surfaced, never
silently prevented. Three moves, in order:

0. **Kit-update step (v2, #6; re-reviewed #6c).** When an `exec` dependency is injected (the real
   CLI always injects `lib/proc.mjs`'s `makeExec()`; library callers/tests may omit it, which skips
   this step silently — today's callers keep today's behavior), sync runs `npm install -g
   github:Q9-Ahimsa/banana` ahead of moves 1 and 2. **Resolving the actual install tree.** `npm
   install -g` writes to the npm global prefix, which is NOT necessarily the launched tree
   (`kitRoot`) sync started from — never true on the npx cold-bootstrap path, where `kitRoot` is
   npx's own cache copy of the kit, not the global prefix. Sync resolves the candidate install root
   via `npm root -g` joined with the kit's own `package.json` `name` (never hard-coded) — only a
   non-empty, ABSOLUTE `npm root -g` result is ever trusted (#6c F2); empty or relative output
   resolves against cwd on every later read, so it is treated as "the lookup found nothing" instead.
   **Tree selection (#6c F4, orchestrator ruling).** On a successful install, the candidate install
   tree is adopted only if it is *kit-shaped*: a readable `package.json`, the first bundled canon
   file, and the `templates/wiring/` dir must all be present. A non-kit-shaped candidate falls back
   to the launched tree, exit 0, with one line naming the fallback — never an exit-1 ENOENT. Between
   a kit-shaped install tree and the launched tree, the NEWER version wins (`compareVersions`); a
   tie favors the install tree (the global path is then left unchanged); an unparseable version on
   either side favors the launched tree. The version line printed is one of:
   - `kit installed: v<after>` — nothing was readable at the install root before this run;
   - `kit updated: v<before> -> v<after>` — the install (or, with no separate install tree, the
     launched) tree's own version rose;
   - `kit current: v<x>` — unchanged (a null version prints as `unknown`, never the literal
     `vnull`);
   - `kit: the installed copy is v<old>, older than this run's v<new> — refreshing from v<new>` —
     the install tree is kit-shaped but OLDER than the launched tree; a downgrade is never silent.

   Moves 1-2 below read from whichever tree won — the launched tree, or a newly adopted install
   tree — not unconditionally `kitRoot`, so a single sync run propagates what it just installed
   without a process restart. On failure — non-zero exit, an `error` field set (a spawn failure or a
   timeout), or anything else short of `code === 0` — it prints one warning line through `err`, `kit
   update skipped (<reason>) — refreshing from the launched copy`, where `<reason>` is the `error`
   message, else the first non-empty stderr line, else `exit <code>`, and moves 1-2 proceed from the
   launched tree unchanged. **Exception: a timeout on the tree moves 1-2 are about to read from**
   (the resolved install root is `null` — the lookup itself failed or never ran — or, path identity
   normalized (#6c F1/F7: `path.resolve()`, case-folded on win32), names the same location as the
   launched tree) skips moves 1-2 entirely instead, warning `kit update timed out — the kit may be
   half-installed; re-run banana sync`, because the interrupted install may have left that exact
   tree half-written. A timeout on a *different*, resolved install tree (the npx cold-bootstrap
   path, or any other failure kind) is safe and still refreshes — the ticket's own requirement.
   Either way the exit code is unaffected.
1. **Fresh reads (load-bearing).** Every canon file and wiring template moves 1-2 use is read from
   disk during THIS run, after move 0 — via the resolved root above, threaded into the
   wiring-template lookups too (`lib/wiring.mjs`'s `wiringDir` override on
   `renderWiringTemplate`/`wiringTemplateVersion`/`adapter.wire`).
2. **Canon + fence refresh (v1.2, unchanged by #6).** Refreshes `~/.agents/canon/` to the bundled
   canon byte-for-byte, then re-applies the fenced wiring block to every already-wired harness file
   whose block version is older than the current template, preserving the owner/tag the block was
   rendered with (`lib/fence.mjs`'s identity preservation, #16). User-owned surfaces (STATE.md,
   session logs, logbooks, anything outside a fence) are never touched, and unwired files are never
   created.

**Known limitation, documented not built around:** a canon file or adapter that is *new* in a
release is not picked up mid-run — the running process keeps the file list (`CANON_FILES`,
`FILE_ADAPTERS`) it started with, so a fresh addition lands on the *next* sync invocation, not the
one that just updated the kit.

The real process runner behind the kit-update step is `lib/proc.mjs`'s `makeExec()`: built on
`node:child_process` spawn — for trusted, FIXED argument lists only (sync's own hardcoded npm
invocations), never for untrusted input — never throws or rejects: every failure mode (spawn error,
non-zero exit, a timeout) resolves to `{ code, stdout, stderr, error? }` so callers branch on the
result, not `try`/`catch`. On win32 it joins command+args into ONE string for spawn under
`shell: true` (a separate args array there makes Node concatenate unescaped — Node's own DEP0190
warning — and corrupts any argument containing a shell metacharacter). A timeout kills the WHOLE
process tree, not just the immediate child: `shell: true` makes that immediate child a wrapper
(cmd.exe on win32), and a plain `.kill()` on it leaves whatever it launched running orphaned. win32
uses `taskkill /T /F`; POSIX spawns the child `detached: true` and kills the process group.
stdout/stderr are decoded as utf8 at the stream level (`setEncoding('utf8')`), not concatenated as
raw Buffer chunks — otherwise a multi-byte character split across a chunk boundary corrupts into
U+FFFD.

## `doctor` — audit contract

Reports: detected harnesses; fence-block versions found in wired files. Audits (exit 1 if any hit):

- **Project liveness (v1.1):** in-progress entries older than 48h · unowned `NEXT:` lines ·
  project STATE.md "as of" older than the newest LOGBOOK entry date · any continuity file over 700
  lines. Entries retired by a `SUPERSEDES:` reference are excluded (supersession-aware, canon
  CONTINUITY v1.4 / ADR 0003).
- **Upstream staleness (v1.2):** `stale-canon` — the home canon dir (`~/.agents/canon/`) is missing,
  or an installed canon file's version marker is older than the kit's bundled canon · `stale-fence`
  — any wired fence block (home adapters plus the project's `AGENTS.md`) is older than its
  template's current version. Both findings name `sync` as the remediation.

`--verify` prints (never executes) per-harness headless recital commands.

**Remote check (v2 upstream model, #6, ADR 0002).** When a `fetch` dependency is injected (the
real CLI always injects `globalThis.fetch`), doctor makes one best-effort GET of
`https://raw.githubusercontent.com/Q9-Ahimsa/banana/main/package.json` and compares its `.version`
against the local kit's (`lib/version.mjs`'s `readKitVersion`/`compareVersions`, single-sourced
with #8's brief). Remote ahead of local prints one advisory line as its OWN paragraph AFTER the
whole Audits block, set off by a blank line: `advice: kit v<local> is behind origin v<remote> — run
banana sync` — never inline inside the Audits block (printing it there, after "clean — no
findings" or after the finding count, reads as contradicting either one, when it is neither a
finding nor part of the count). Any failure is silent: no `fetch` injected, a rejection (network
error or the 2000ms `AbortController` timeout's own abort), a non-2xx response, unparseable JSON,
or a missing/unparseable version on either side. The `AbortController`'s timer is cleared in a
`finally` wrapping BOTH the fetch AND the `response.json()` read — clearing it right after the
fetch alone would leave a stalled response body hanging doctor forever, since nothing would ever
fire the abort a stuck `.json()` needs to reject. The line is advice only — it is never a `Finding`
and never affects the exit code: only-origin-ahead still exits 0, existing local findings still
exit 1 regardless of the remote state.

**`BANANA_ORIGIN_URL` — test seam (#6b).** The real bin (`bin/banana.mjs`, doctor arm only) reads
this env var and threads it through as `deps.originUrl` to `checkOriginAhead`, which prefers it
over `lib/doctor.mjs`'s exported `DEFAULT_ORIGIN_URL` constant (the real
`raw.githubusercontent.com` URL). Undefined falls through to the default, so real runs are
unaffected. This lets a real-bin regression test (`test/bin.e2e.test.mjs`) point doctor's fetch at
a local `node:http` server instead of the network — the seam is read in exactly one place, the
doctor dispatch arm, and nowhere else in the command surface.

**Exit via `process.exitCode`, not `process.exit()` (#6b).** The doctor dispatch arm sets
`process.exitCode = result.code` and lets the module finish, instead of calling `process.exit()`
like every other dispatch arm. On Windows (Node 24.x observed), calling `process.exit()` at any
point after a real `fetch` aborts the process — `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 76`, a libuv fail-fast abort (0xC0000409; Git Bash
reports it as exit 127) — regardless of `AbortController` cleanup, a `connection: close` header, or
idle keep-alive sockets (which don't hold the event loop open on their own). Letting the loop drain
naturally avoids it; doctor still exits promptly (well under a second against a real network fetch,
since nothing else holds the loop open once `checkOriginAhead` resolves). Because the doctor arm no
longer calls `process.exit()`, `bin/banana.mjs`'s bottom-of-file "no dispatch arm" invariant guard
(originally unconditional, relying on every arm above it to have already exited) is scoped to skip
`cmd === 'doctor'` — see the guard's own comment.

A LOCAL origin server could not reproduce the crash itself, despite trying plain HTTP, TLS with a
self-signed cert, hostname-based DNS resolution, a gzip-encoded body matching the real origin's own
`Content-Encoding: gzip`, an artificial response delay, and the machine's real LAN IP instead of
loopback — individually and combined. Only the real network trips the assertion. Because of that,
`test/bin.e2e.test.mjs` carries two tiers for doctor's real fetch: four tests against a local
`BANANA_ORIGIN_URL` double, always run, that guard the CONTRACT the fix preserves (exact exit codes
for a clean sandbox and a seeded finding, the advice line, a silent 500, and a ≤5s exit budget — an
un-cleared timer anywhere in the doctor path blows that budget once `process.exit()` is gone, since
the loop then waits the timer out instead of being torn down); and one test against the REAL origin,
opt-in only (skipped unless `BANANA_NETWORK_TESTS=1`), asserting no `Assertion failed` in stderr and
an exit code in `{0, 1}` — this is the one that actually goes red (the real abort) before the fix
and green after, meant to be run by hand, never as part of the default gate (no external network in
the default suite).

## Adapter contract

Each adapter module exposes `detect(home)`, `describe()`, and either `wire(home, opts)` (file
adapters) or `compose(opts)` (write-through adapters). File adapters write ONLY via `lib/fence.mjs`
(insert-or-replace a version-marked block, `<!-- banana:begin vN -->` … `<!-- banana:end -->`,
creating the file if missing, preserving everything outside the fence byte-for-byte — idempotency
is THE contract: second run must be byte-identical). Every shipped wiring template
(`templates/wiring/*.md`) is currently fenced at `v2`. **Identity preservation (#16):** when a
fence-writing path rewrites or upgrades an EXISTING fence, it reads the agent tag and owner off
that fence's own identity line (`lib/fence.mjs`'s `readPreservedIdentity`/`extractIdentity` —
single-sourced there for every fence-writing path: `project`'s own `AGENTS.md` write, `init`'s
per-adapter wiring, and `sync`'s stale-fence upgrades) and carries them into the new block
unchanged, even as it upgrades everything else (version, template text). An explicit value the
command was given for this run (`project`'s and `init`'s `--tag`/`--owner`) wins over a preserved
one — `init` resolves this per adapter target, so a machine wired at different times with
different `--owner`/`--tag` values keeps each file's own identity independently; `sync` takes no
such flags, so a preserved value always wins there. No existing fence, or a fence whose identity
line can't be parsed, falls back to the command's normal default computation (`init`'s per-adapter
fallback is this run's resolved owner and the adapter's own default tag) — the unparseable case
also prints exactly one warning line naming the file, so identity loss is never silent. The hermes
adapter never writes files: it
composes a directive (sender header + protocol summary + agent tag) and the one-shot command
string; delivery only behind an explicit `--deliver` flag. Rationale: another agent's memory is
written through the agent, never at its files.

## `log` — write contract

`banana log stub|append|close|supersede` is the single writer of
`.agents/session.log`; lib/log.mjs owns zero grammar literals (heading
format, PHASE/STATUS vocabulary, ghost math all live in `lib/sessionlog.mjs`)
and orchestrates argv parsing, field validation, target resolution, and the
write itself. The concurrency model is protocol-visible — other harnesses
that write the log by hand build against these same rules:

- **Single-buffer, single-append atomicity.** Every invocation composes the
  full text to append (heading plus body lines, or checkpoint/close lines)
  as one string, then issues exactly one `appendFileSync` call. Never
  per-line writes, never read-modify-write of existing bytes — the file's
  prior content is read only to decide what to append, never rewritten.
- **No locks; collided-`n` is a soft error (canon §7).** `nextN` reads
  the active log plus every `.agents/sessions/*.log` archive and takes
  max(n)+1 at call time; two concurrent writers can race and land the same
  `n` for a feature. The tool does not retry or lock — a duplicate `n` is
  a recoverable, human-visible anomaly, not a crash.
- **Grep-unit adjacency + auto-continuation (ADR 0003).** append/close
  decide whether their target entry is still safe to append under by
  checking the file's last `/^## \[/` line (the same grep canon's own
  audits use), not the last *parsed* entry — a hand-mangled heading is
  invisible to the parser but still poisons the grep. When the target
  heading is no longer last, the tool writes the canon-prescribed
  continuation entry itself (new heading, `SUPERSEDES:` the entry left
  open above) instead of writing under a stranger's heading; `--no-continue`
  opts out with a refusal (exit 2) instead of writing anything.
- **Never creates files.** A missing `.agents/session.log` (or a
  legacy-only log) is a state error naming `banana project` as the fix —
  `log` never creates the file or the `.agents` directory.
- **Never rewrites existing bytes.** Every write is an append past the
  current end-of-file (after sniffing the file's EOL style and separator
  needs); no existing line is ever edited or removed.
- **Never touches legacy logs.** `.claude/session.log` (the pre-v2
  grammar) is read-only historical context to `doctor`/`brief` at most and
  is never scanned by `nextN`/`loadSessionHistory` and never written.
- **Post-close state-lint early catch (#14).** After a SUCCESSFUL,
  non-dry-run write that leaves an entry in a terminal status —
  `log close` (always terminal by construction; `in-progress` is rejected
  earlier), or `log stub` with a terminal `--status`
  (complete\|blocked\|abandoned) — `log` prints the same
  project+global verdict/finding content as `brief`'s `## State lint`
  section (`lib/state.mjs`'s `formatStateLintLines`), with no markdown
  heading (log's other output is plain status lines, not a markdown
  document). Never changes `log`'s exit code — a FAIL verdict still exits 0
  on a successful write. `--dry-run` never lints (nothing was closed).
  `--quiet` suppresses ONLY the summary line, and only when both project and
  global are PASS or the target page doesn't exist — findings and the
  fix-it closing line always print regardless of `quiet`. `append`,
  `supersede`, and a non-terminal `stub` never lint. `log`'s runner takes an
  injected `home` (only `bin/` resolves `os.homedir()`), same as `brief`.

## `state lint` — verdict contract

`banana state lint` mechanically lints a STATE.md page against the canon's
invariants — **lint never grades content.** Every verdict is reproducible
from file bytes alone, so no check ever reads the clock (no `now` is
injected anywhere in `lib/state.mjs`). Verdict tiers:

- **FAIL** — a mechanical invariant is broken.
- **WARN** — ambiguous residue a model should look at.
- **PASS** — neither.

**No-print data seam (#14).** `collectStateLint({ cwd, home })` runs both project and global lint
without printing, returning `{ project, global }`; each side is `{ verdict, findings }` (found and
linted — `verdict` is the summary text with no `state lint: ` prefix, `findings` are pre-formatted
`TIER [type] <file>: message` lines, FAILs first), `{ none: reason }` (the target file doesn't
exist), or `{ unreadable: reason }` (it exists but couldn't be read — `reason` is the exact message
`runStateLint` itself would print for that failure). `runStateLint` itself now routes through this
function — one code path for every consumer of finding text, CLI included.
`formatStateLintLines(collected, { quiet })` renders a collected pair into the printable lines
`brief`/`log` both use (see their own contracts above).

Exit codes: `0` PASS or WARN-only · `1` any FAIL · `2` usage error or the
target STATE.md is missing/unreadable. Output is one line per finding
(FAILs first, then WARNs), `FAIL [type] <file>: <message>` / `WARN [type]
<file>: <message>`, then a final summary line — `state lint: FAIL (N fail, M
warn)` / `state lint: WARN (M warn)` / `state lint: PASS`. `STATE_CAP_CHARS`
(10000, ADR 0004) is measured after the full text-preparation pipeline below.

**Text preparation** (review hardening 2026-09-28; `lib/state.mjs`'s
`prepareText`, run before any check, including by `lintProjectState` and
`lintGlobalState` themselves — calling either directly on raw file content is
safe, not just going through `runStateLint`): normalize line endings (CRLF
**and** lone-CR old-Mac endings both become LF) and strip every U+FEFF
byte-order-mark (not only one at file start — a BOM glued directly in front
of a heading mid-document is just as real a character as one at position 0),
then blank fenced code regions (``` ``` ``` or `~~~`, matching delimiter,
unterminated blanks to EOF) and `<!-- ... -->` HTML comments (single- or
multi-line) — every line either touches becomes an empty line, so line
indexes stay stable and every check below sees only real page content, never
quoted example text or explanatory markup. A section heading (or an as-of/
stamp date, or the dirty marker) that exists ONLY inside a fence or comment
does not count; one that exists for real elsewhere on the page is unaffected
by a decoy copy sitting in a fence. The retired-header phrase is narrower
still (#11 Part 1b): it is only ever looked for in the HEADER BLOCK (every
line before the first `## ` heading — the same boundary `stateAsOf` uses,
ADR 0004), never the body, so a bullet that merely quotes or describes the
retired rule in prose does not trip it, fenced or not.

**Project mode** (`banana state lint`, default) lints `<cwd>/STATE.md`;
`<cwd>/LOGBOOK.md` and `<cwd>/.agents/session.log` are optional comparison
inputs (missing files skip the checks that need them, not a finding on their
own).

| Tier | type | Fires when |
|---|---|---|
| FAIL | `missing-section` | one of the six required headings (`## Now`, `## Truths`, `## Next`, `## Blocked`, `## Watch`, `## Dead ends`) has no matching heading line (qualifier-tolerant, below) |
| FAIL | `over-cap` | page length exceeds `STATE_CAP_CHARS` |
| FAIL | `unowned-next` | a top-level bullet in the `## Next` section (qualifier-tolerant, below) fails the shared owner matcher (below) |
| FAIL | `as-of-missing` | no `as of YYYY-MM-DD` date in the header, and it is not the fresh-page exception (bootstrap placeholder `as of (date)` with zero LOGBOOK.md entries) |
| FAIL | `as-of-malformed` | the header's `as of` value is date-SHAPED but not a real calendar date (`2026-13-45`, `2026-09-31`, ...) — mutually exclusive with `as-of-missing`: a malformed date IS an attempt, so it never also reports "missing" |
| FAIL | `stale-vs-logbook` | the as-of date is older than the newest LOGBOOK.md entry date (equal passes) |
| WARN | `stale-vs-session-log` | the as-of date is older than the newest `.agents/session.log` entry date (equal passes) — WARN, not FAIL: see ADR 0004 |
| WARN | `dirty-marker` | the standing rebuild-on-close marker (ADR 0001) is present |
| WARN | `retired-header` | the page's HEADER (not the body — #11 Part 1b) still carries the pre-amendment "rebuilt whole, never patched" rule — this project-mode message points to ADR 0001 (rebuild-on-close); see the global-mode table below for the counterpart message (ADR 0005) |

**Heading matcher** (shared machinery — `missing-section` and locating a
section's body, e.g. `## Next`, for the owner-matcher scan, both use this
ONE matcher; a page qualifying its headings — `## Watch (tripwires ...)` —
must never silently skip a body scan, which would print identically to a
clean PASS). A `## <Name>` heading is present iff some (post-preparation)
line, trailing whitespace trimmed, matches `^## <Name>(?:\s.*)?$` with
`<Name>` regex-escaped: the exact section name, optionally followed by
whitespace and then any qualifier text. Real project pages qualify their
headings this way — `## Truths (durable studio doctrine)`, `## Watch
(tripwires — mirrored as ADR revisit-triggers)` both count as their section.
A name-glued suffix does NOT count: `## Watchlist` does not satisfy `Watch`,
`## Nextsteps` does not satisfy `Next` — the qualifier must be
whitespace-separated from the name, not appended directly onto it. (Fixed
2026-09-28, phase 1b: the original exact-line matcher false-positived
`missing-section` on three real pages that qualify their headings — see ADR
0004.) A **duplicated** heading is scanned under every occurrence, not just
the first (review hardening 2026-09-28) — a second `## Next` block's bullets
are not silently invisible to the unowned-bullet scan. A section's body ends
at the next heading of level 1 or 2 (`# ` or `## `) — a deeper `###`/`####`
heading or a `---` rule does not end it (also review hardening: the original
boundary check only recognized `## `, letting a bullet after a later `# `
H1 bleed into the wrong section's scan).

**Owner matcher** (shared machinery — project `unowned-next` and global
`backlog-unowned` both use it): a top-level bullet is 0-1 leading spaces,
then `-`, `*`, `+` or a numbered marker (`\d+[.)]`), then a space or tab
(review hardening 2026-09-28 — originally only `^[-*] ` (dash/asterisk, no
`+`/numbered/indented forms); indented bullets (2+ spaces or a leading tab),
prose, blank lines and `###` sub-headings are still not top-level. A
placeholder is ONLY a bullet whose full (trimmed) text is byte-equal to one
of the literal bullets shipped in `templates/project-STATE.md` /
`templates/global-STATE.md` (any `__OWNER__` token in a template bullet
matches either the literal token or a real single-token owner, so a
freshly-bootstrapped page's substituted placeholders still count) — review
hardening 2026-09-28: "any bullet whose content starts with `(`" was too
broad and silently exempted real content
(`- (paused) rebuild the projection`) from every check. A non-placeholder
bullet is owned iff its content matches `owner — text` (em-dash U+2014), the
owner token itself carries no em-dash, and the owner token — after stripping
ONE layer of emphasis from each end (the alternation tries `***`/`___`
before `**`/`__` before `*`/`_`, so a triple-wrapped word unwraps in one pass
per side instead of needing an open-ended repeat that would also eat into a
literal word's own underscores) — is not `unowned` (case-insensitive) or the
literal `__OWNER__`. The literal, unsubstituted `__OWNER__` bootstrap
placeholder token is always unowned (checked before the placeholder-pattern
check, so its own wrapping underscores can't hide it from the comparison —
see `lib/state.mjs`'s `classifyOwnerBullet`).

**As-of / freshness-stamp date parsing** (shared `lib/doctor.mjs` helper
`stateAsOf`, single-sourced — review hardening 2026-09-28): searched only in
the HEADER block (every line before the first `## ` heading, after text
preparation above), case-insensitive `as of`, taking the LAST match in that
block — a header may legitimately mention an earlier date in prose before
its own real as-of clause, and body text (a `## Dead ends` sentence, say)
must never date an otherwise-undated page. A date-shaped value is validated
as a REAL calendar date (a `Date.UTC` round-trip — `2026-13-45`,
`2026-09-31`, `2026-02-30` all "succeed" at construction time but roll into a
different date rather than throwing); an impossible value is
`as-of-malformed`/`thread-stamp-malformed`, distinguishable from no date at
all. A bullet's freshness stamp (`(as of YYYY-MM-DD)`) reuses the same
real-date validation and is matched case-insensitively too (`(As of
2026-09-28)` counts) but is otherwise exact by design: `(as of 2026-09-28,
rebuilt)` is not a match — the closing paren must follow the date
immediately. If a bullet carries more than one stamp, the OLDEST one governs
staleness comparison (conservative: if any reading could be stale, treat it
as stale).

**Global mode** (`banana state lint --global`, #13) lints
`<home>/.agents/STATE.md` instead — a single input, no LOGBOOK.md/session.log
comparison (the global page has none). `home` is always injected through
`runStateLint`'s deps; `lib/state.mjs` never reads the real HOME itself, only
`bin/` resolves `--global`'s home to `os.homedir()`.

| Tier | type | Fires when |
|---|---|---|
| FAIL | `missing-section` | one of the four required headings — `## Active threads`, `## Backlog (owned)`, `## Watch`, `## Recently closed (context for next session)` — has no matching heading line (qualifier-tolerant, above; the parenthetical in the last two names is part of the required name, not an optional qualifier — a bare `## Recently closed` does not satisfy it) |
| FAIL | `over-cap` | page length exceeds `STATE_CAP_CHARS` (same constant, same measurement) |
| FAIL | `thread-unstamped` | a non-placeholder top-level `## Active threads` bullet has no `(as of YYYY-MM-DD)` freshness stamp |
| FAIL | `thread-no-pointer` | same bullet has no `→` pointer (independent of the stamp check — both can fire on the same bullet) |
| FAIL | `thread-stale` | the bullet's pointer resolves to a readable target STATE.md whose own as-of date is LATER than the bullet's stamp (equal passes); only evaluated when both a valid stamp and a resolved, dated target exist |
| FAIL | `thread-stamp-malformed` | the bullet's freshness stamp is date-shaped but not a real calendar date — mutually exclusive with `thread-unstamped`: a malformed stamp IS an attempt |
| FAIL | `backlog-unowned` | a top-level `## Backlog (owned)` bullet fails the owner matcher |
| WARN | `thread-unverifiable` | the bullet has a pointer, but it does not resolve to a readable file named `STATE.md` (a memory file, a missing path, a relative path, ...) |
| WARN | `thread-target-undated` | the pointer resolves to a readable STATE.md with no `as of YYYY-MM-DD` date (incl. the bootstrap placeholder) |
| WARN | `retired-header` | the page's HEADER (not the body — #11 Part 1b) still carries the pre-amendment "rebuilt whole, never patched" rule — this global-mode message points to ADR 0005 (per-thread edits, #15) |
| WARN | `line-over-limit` | a non-placeholder top-level bullet's FULL text (its own line plus any continuation lines) exceeds its section's char limit (`SECTION_LINE_LIMITS`, #20, ADR 0006): `## Active threads` 400 · `## Backlog (owned)` 300 · `## Watch` 350 · `## Recently closed (context for next session)` 250 |
| WARN | `closed-undated` | a non-placeholder `## Recently closed` bullet has no valid `(closed YYYY-MM-DD)` stamp (#20) — covers both "no stamp" and "every stamp present is date-shaped but impossible" |
| WARN | `closed-expired` | a non-placeholder `## Recently closed` bullet's `(closed …)` stamp is more than `CLOSED_EXPIRY_DAYS` (7) before the #20 reference date (equal to 7 passes) — only evaluated when the bullet has a valid stamp and the page has a reference date |
| WARN | `thread-inactive` | a non-placeholder `## Active threads` bullet's `(as of …)` stamp is more than `THREAD_INACTIVE_DAYS` (30) before the #20 reference date (equal to 30 passes) — only evaluated when the bullet has a valid stamp and the page has a reference date |

Global mode never flags `dirty-marker`: ADR 0005's per-thread edits (#15)
introduced no marker convention for a mid-arc patched global page, so there
is no standing-marker state to flag. It DOES flag `retired-header` (added by
#15): ADR 0005 (2026-09-29) retired the whole-rebuild rule in favor of
per-thread edits, so a page still carrying the old header is stale — the same
shape as project mode's own `retired-header` check, just pointing at a
different migration (ADR 0005, not ADR 0001).

**#20 reference date, line limits, closed expiry, thread inactivity** (ADR
0006). The global page has no numeric cap on any individual bullet (only
the whole-page `over-cap`), and nothing ever shrinks it — `line-over-limit`,
`closed-undated`, `closed-expired`, and `thread-inactive` are the four WARNs
that surface the residue a model should prune, all deliberately WARN (not
FAIL): each fix needs judgment (what to cut, what a Backlog line should
say), so the page-wide `over-cap` FAIL stays the mechanical backstop.
`line-over-limit` measures a bullet's FULL text — its own marker line plus
any continuation lines beneath it, up to the next top-level bullet or
section heading, trailing blank lines dropped — unlike the Active-threads
stamp/pointer scan above, which deliberately reads a bullet as ONE physical
line only (a different rule for a different purpose). The **reference
date** every date comparison here uses is the newest real calendar date
among the page's own non-placeholder `(as of …)`/`(closed …)` stamps —
never the clock (this module never reads it) and never just the first stamp
on the page, since per-thread edits land bullets out of date order; with no
valid stamp anywhere, both date checks are skipped. A `(closed YYYY-MM-DD)`
stamp is parsed with the exact same hardened shape/case/real-date rules as
the Active-threads `(as of YYYY-MM-DD)` stamp (just a different keyword);
a bullet carrying more than one valid stamp of either kind compares against
the OLDEST (conservative, mirrors F6). The Recently-closed placeholder's
wording changed with #20 (the old pointer-only phrasing is replaced by one
naming the `(closed YYYY-MM-DD)` convention); the OLD text is still
recognized as a placeholder (a legacy pattern, kept alongside the
dynamically-loaded current set) so an un-migrated installed page does not
spuriously WARN `closed-undated`. Removal from the page (what each remedy
ultimately leads to) is never a deletion: it is a move into the append-only
`STATE-archive.md`, performed by the separate `banana state archive`
command (its own contract, ADR 0006).

**Pointer resolution.** Among every `→` in the bullet that is NOT inside a
backtick span (review hardening 2026-09-28 — an arrow quoted as example text
inside backticks, `` `a → b` ``, is not a structural delimiter), take the
LAST one whose target candidate looks like a recognized path form (`~/`,
`~\`, `X:\…`, `X:/…`, `/…`) — a trailing arrow in prose after the real
pointer (`(next: draft → review)`) does not win just for appearing last,
since its target doesn't look like a path. Only when NONE of the candidates
look like a path does resolution fall back to the very last one (which then
correctly resolves to unverifiable). For the chosen arrow: the target is the
first backtick-quoted span after it, else the first whitespace-delimited
token. `~/` or `~\` prefix resolves against `home`; absolute (`X:\…`,
`X:/…`, `/…`) resolves as-is; anything else is unverifiable. Both `\` and
`/` separators are accepted. A target that is a directory resolves to
`<dir>/STATE.md`. The resolved target must be named `STATE.md`
(case-sensitive) to be verified — otherwise `thread-unverifiable`.

**A bullet is scanned as ONE physical line, never joined with a following
line** (review hardening 2026-09-28, F14; canon: "one line per in-flight
project"). A stamp or pointer living on an indented continuation line, or on
a following unmarked line, is invisible to the checks above and the bullet
FAILs (`thread-unstamped`/`thread-no-pointer`) by design — a wrapped
Active-threads bullet is a defect to fix by putting it back on one line, not
something the linter reconstructs. The dirty-marker comparison
(`checkDirtyMarker`) is on `line.trim()`, not raw equality — a trailing
space or leading indentation doesn't hide a real marker, but no other
variation is tolerated (still byte-exact otherwise).

**Unreadable (but existing) LOGBOOK.md or session.log** (review hardening
2026-09-28): a file that exists but cannot be read (permissions, or it's a
directory rather than a file) is a disk-state precondition failure, same
tier as an unreadable target STATE.md — `runStateLint` reports it and exits
`2`, naming the file. It is never silently swallowed to "absent" (which
would silently drop `stale-vs-logbook`/its date comparisons).

## `state archive` — contract

`banana state archive --global --match <text> --reason <expired|inactive|trimmed|closed|removed>
--tag <agent> [--dry-run]` moves (or, for `trimmed`, copies) exactly one
non-placeholder top-level bullet off the global page
(`<home>/.agents/STATE.md`) into an append-only archive
(`<home>/.agents/STATE-archive.md`) — the canon rule "removal from the
global page is a MOVE, never a silent delete" (ticket #20). It lives in its
own module (`lib/state-archive.mjs`, not `lib/state.mjs`): it reads the
clock for the record date, so it must stay out of the clock-free lint
module (ADR 0004 — no check in `lib/state.mjs` may read `now`). `home` and
`now` are injected through deps; only `bin/` resolves
`os.homedir()`/`Date.now()`. `parseStateArgs` (`lib/state.mjs`) returns a
discriminated union — `{ verb: 'lint', global }` or `{ verb: 'archive',
global, match, reason, tag, dryRun }` — reusing `lib/state.mjs`'s exported
bullet/section helpers (`prepareText`, `topLevelBullets`,
`topLevelBulletRanges`, `isPlaceholderBullet`, `REQUIRED_GLOBAL_SECTIONS`)
rather than re-parsing the page.

`--global` is required (project pages keep their history in LOGBOOK.md
instead) — its absence, like any other usage problem (a missing
`--match`/`--reason`/`--tag`, an unknown flag, or a `--reason` outside the
five-value vocabulary), exits `2`. Exit codes: `0` ok, `2` usage or
state — unlike `state lint`, there is no FAIL/`1` tier here: archive moves
bytes, it never grades them.

**Matching.** `--match` is a case-sensitive substring of a non-placeholder
top-level bullet's FULL text — its own marker line plus any continuation
lines beneath it, up to the next top-level bullet or section heading,
trailing blank lines dropped — the SAME span `line-over-limit` measures
(`topLevelBulletRanges`, `lib/state.mjs`; integration fix, 2026-10-01: the
archive must move exactly what the lint measures, so both read this one
shared definition instead of two that could drift apart) — searched across
all four global sections (`Active threads`, `Backlog (owned)`, `Watch`,
`Recently closed (context for next session)`). Exactly one match proceeds; zero exits
`2` ("no line matches"); more than one exits `2`, listing every candidate's
section and first 60 characters — ambiguity is never resolved by picking
the first, only by a tighter `--match`.

**Record.** The archive file is created with this header if it doesn't
exist yet:

```
# GLOBAL STATE — archive
> Append-only. Lines moved off ~/.agents/STATE.md (or the long form of trimmed ones), verbatim,
> newest last. Never loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md
```

then every move/copy appends one record, separated from the next by exactly
one blank line:

```
## [YYYY-MM-DD] <tag> — <reason> · <section name>
<the bullet's lines, byte-verbatim>
```

`<section name>` is the canonical name (`REQUIRED_GLOBAL_SECTIONS`, never a
qualified heading); the date is `formatLocalDate(now)` (the local calendar
day, not UTC).

**Write order and the re-read guard.** Read the page once, compute the new
page text from that read, THEN re-read the page from disk a second time: if
its bytes differ from the first read, abort — exit `2`, nothing written (a
concurrent edit happened; retry). Past that guard, the archive record is
appended BEFORE the page is rewritten, so a crash between the two can
duplicate a line onto both files but can never lose it — the reverse order
would risk exactly that loss.

**`trimmed` copies only** — the page is never modified for this reason,
only read and recorded; the CLI prints a reminder to shorten the line in
place instead. Every other reason (`expired`, `inactive`, `closed`,
`removed`) removes the matched bullet, and its continuation lines, from the
page. If removing it leaves its section with no top-level bullet left, that
section's placeholder line is inserted in its place — read from
`templates/global-STATE.md` AT RUNTIME (never cached, never hardcoded),
since Lane A of this same ticket changes the `Recently closed` placeholder
text.

**Line endings.** The page keeps whatever line ending it already had (a
CRLF page stays CRLF); no byte outside the matched bullet's own lines (and,
when a placeholder is inserted, the one new placeholder line) ever changes
— the write path slices the original bytes directly rather than splitting
and rejoining the whole file, so this holds even on a page with mixed
endings. The archive file's own line ending matches its existing content
when it already exists, or the page's dominant ending at the moment it's
created.

**Output.** On success: `archived (<reason>): <section> · "<first 60
chars>" → <archive path>`; `inactive` additionally prints a reminder to add
an owned `Backlog (owned)` line for the thread. `--dry-run` prints the
record that would be appended plus the same action/reminder lines, and
writes nothing.

## Hard rules for this build

- Zero runtime dependencies. Node >= 18, ESM (`.mjs`), built-in `node:test`.
- Every lib/adapters function takes an injectable root path — nothing reads the real HOME inside
  logic; tests run against sandbox temp dirs exclusively.
- Never write outside this repo and OS temp dirs. Canon source paths in prd.json are READ-ONLY.
- Placeholder tokens in templates: `__OWNER__`, `__AGENT_TAG__` only.
- Constants: ghost 48h, rotation 700 lines, fence markers as above.
