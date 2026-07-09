# banana — design spec (authoritative for this build)

> The task packet at `.agents/goal/packet.md` holds the done-whens. This file holds the WHY and the
> exact behavioral contracts. A fresh-context iteration reads both before implementing anything.

## What banana is

A harness-neutral continuity kit. It installs a file-based coordination protocol shared by every
AI agent (Claude Code, Pi, Codex, Hermes, …) and human on a machine, so that work survives session
death and no agent's private memory becomes load-bearing. Five commands: `init` (machine wiring),
`project` (repo init), `brief` (per-intent context compiler), `doctor` (audits), `sync` (propagates
upstream canon and wiring changes).

## The architecture being shipped (canon v1.2)

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

## `brief` — behavioral contract

`banana brief <feature> --tag <agent>` writes a brief to stdout, compiled from the project's
continuity files. Include / exclude:

| Include | Exclude |
|---|---|
| target feature's session.log entries, full bodies | other features' entry BODIES |
| headings only of the last 5 entries from other features | other projects' content |
| `NEXT:` lines owned by `--tag` or unowned | NEXT owned by other agents |
| project STATE.md verbatim (one page by contract) | global STATE (machine grain, not project) |
| ghosts: any in-progress entry older than 48h, flagged | |

Every section header carries a `ref:` line naming its source file (the brief is an index into the
record, not a replacement for it). Deterministic only — no LLM calls, pure text processing.

## `doctor` — audit contract

Reports: detected harnesses; fence-block versions found in wired files. Audits (exit 1 if any hit):

- **Project liveness (v1.1):** in-progress entries older than 48h · unowned `NEXT:` lines ·
  project STATE.md "as of" older than the newest LOGBOOK entry date · any continuity file over 700
  lines.
- **Upstream staleness (v1.2):** `stale-canon` — the home canon dir (`~/.agents/canon/`) is missing,
  or an installed canon file's version marker is older than the kit's bundled canon · `stale-fence`
  — any wired fence block (home adapters plus the project's `AGENTS.md`) is older than its
  template's current version. Both findings name `sync` as the remediation.

`--verify` prints (never executes) per-harness headless recital commands.

## Adapter contract

Each adapter module exposes `detect(home)`, `describe()`, and either `wire(home, opts)` (file
adapters) or `compose(opts)` (write-through adapters). File adapters write ONLY via `lib/fence.mjs`
(insert-or-replace a version-marked block, `<!-- banana:begin vN -->` … `<!-- banana:end -->`,
creating the file if missing, preserving everything outside the fence byte-for-byte — idempotency
is THE contract: second run must be byte-identical). Every shipped wiring template
(`templates/wiring/*.md`) is currently fenced at `v2`. The hermes adapter never writes files: it
composes a directive (sender header + protocol summary + agent tag) and the one-shot command
string; delivery only behind an explicit `--deliver` flag. Rationale: another agent's memory is
written through the agent, never at its files.

## Hard rules for this build

- Zero runtime dependencies. Node >= 18, ESM (`.mjs`), built-in `node:test`.
- Every lib/adapters function takes an injectable root path — nothing reads the real HOME inside
  logic; tests run against sandbox temp dirs exclusively.
- Never write outside this repo and OS temp dirs. Canon source paths in prd.json are READ-ONLY.
- Placeholder tokens in templates: `__OWNER__`, `__AGENT_TAG__` only.
- Constants: ghost 48h, rotation 700 lines, fence markers as above.
