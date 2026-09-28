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
| target feature's session.log entries, full bodies | other features' entry BODIES |
| headings only of the last 5 entries from other features | other projects' content |
| `NEXT:` lines owned by `--tag` or unowned | NEXT owned by other agents |
| project STATE.md verbatim (one page by contract) | global STATE (machine grain, not project) |
| ghosts: any in-progress entry older than 48h, flagged | Entries retired by a `SUPERSEDES:` reference are excluded (supersession-aware, canon CONTINUITY v1.4 / ADR 0003). |

Every section header carries a `ref:` line naming its source file (the brief is an index into the
record, not a replacement for it). Deterministic only — no LLM calls, pure text processing.

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

## `state lint` — verdict contract

`banana state lint` mechanically lints a STATE.md page against the canon's
invariants — **lint never grades content.** Every verdict is reproducible
from file bytes alone, so no check ever reads the clock (no `now` is
injected anywhere in `lib/state.mjs`). Verdict tiers:

- **FAIL** — a mechanical invariant is broken.
- **WARN** — ambiguous residue a model should look at.
- **PASS** — neither.

Exit codes: `0` PASS or WARN-only · `1` any FAIL · `2` usage error or the
target STATE.md is missing/unreadable. Output is one line per finding
(FAILs first, then WARNs), `FAIL [type] <file>: <message>` / `WARN [type]
<file>: <message>`, then a final summary line — `state lint: FAIL (N fail, M
warn)` / `state lint: WARN (M warn)` / `state lint: PASS`. CRLF is normalized
to LF before any check runs (Windows files); `STATE_CAP_CHARS` (10000, ADR
0004) is measured on that normalized text.

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
| FAIL | `stale-vs-logbook` | the as-of date is older than the newest LOGBOOK.md entry date (equal passes) |
| WARN | `stale-vs-session-log` | the as-of date is older than the newest `.agents/session.log` entry date (equal passes) — WARN, not FAIL: see ADR 0004 |
| WARN | `dirty-marker` | the standing rebuild-on-close marker (ADR 0001) is present |
| WARN | `retired-header` | the page still carries the pre-amendment "rebuilt whole, never patched" rule — project grain only |

**Heading matcher** (shared machinery — `missing-section` and locating a
section's body, e.g. `## Next`, for the owner-matcher scan, both use this
ONE matcher; a page qualifying its headings — `## Watch (tripwires ...)` —
must never silently skip a body scan, which would print identically to a
clean PASS). A `## <Name>` heading is present iff some line, trailing
whitespace trimmed, matches `^## <Name>(?:\s.*)?$` with `<Name>` regex-escaped:
the exact section name, optionally followed by whitespace and then any
qualifier text. Real project pages qualify their headings this way —
`## Truths (durable studio doctrine)`, `## Watch (tripwires — mirrored as ADR
revisit-triggers)` both count as their section. A name-glued suffix does
NOT count: `## Watchlist` does not satisfy `Watch`, `## Nextsteps` does not
satisfy `Next` — the qualifier must be whitespace-separated from the name,
not appended directly onto it. (Fixed 2026-09-28, phase 1b: the original
exact-line matcher false-positived `missing-section` on three real pages
that qualify their headings — see ADR 0004.)

**Owner matcher** (shared machinery — also the seam `--global`'s
`backlog-unowned` check will reuse, #13): a top-level bullet is a line
matching `^[-*] ` (no indentation); indented bullets, prose, blank lines and
`###` sub-headings are ignored. For each top-level bullet, strip one leading
markdown-emphasis marker (`**`, `*`, `__`, `_`) from its content; content
that then starts with `(` is a template placeholder, skipped. A bullet is
owned iff its content matches `owner — text` (em-dash U+2014), the owner
token itself carries no em-dash, and the owner token — after stripping one
trailing emphasis marker — is not `unowned` (case-insensitive). The literal,
unsubstituted `__OWNER__` bootstrap placeholder token is always unowned
(checked before the leading-strip, so its own wrapping underscores can't
hide it from the comparison — see `lib/state.mjs`'s `classifyOwnerBullet`).

`--global` (#13, not yet implemented) will lint `<home>/.agents/STATE.md`
instead, against the global-grain sections and its own thread-freshness
checks; the shared functions above (owner matcher, cap check,
missing-section check, Finding shape, output formatter) are already written
mode-agnostic for that to slot in without restructuring.

## Hard rules for this build

- Zero runtime dependencies. Node >= 18, ESM (`.mjs`), built-in `node:test`.
- Every lib/adapters function takes an injectable root path — nothing reads the real HOME inside
  logic; tests run against sandbox temp dirs exclusively.
- Never write outside this repo and OS temp dirs. Canon source paths in prd.json are READ-ONLY.
- Placeholder tokens in templates: `__OWNER__`, `__AGENT_TAG__` only.
- Constants: ghost 48h, rotation 700 lines, fence markers as above.
