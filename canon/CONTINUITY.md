# CONTINUITY — cross-harness protocol (canonical) — v1.1

Any agent working on this machine or its repos follows this. The record is
**file-based and harness-neutral**: no agent's private memory is the source of
truth — the files are. Claude Code, Pi, Hermes, Codex, Cursor, and humans all
read and write the same surfaces.

**Your agent tag:** write yourself as `claude`, `pi`, `hermes`, `codex`,
`cursor`, or `human` in every entry you author. Never omit it.

## Global grain — `~/.agents/STATE.md`

One-page cross-project projection: active threads, backlog, watch items.
- **Session start:** read it.
- **Session close:** if cross-project state changed (thread opened/closed,
  backlog item added), rebuild the page — never patch it. Chronology does not
  live here; it lives in project logbooks.

## Project grain — Logbook Standard

Every non-trivial project carries:
- **`LOGBOOK.md`** — append-only chronology. Entries:
  `## [YYYY-MM-DD] {agent} {stream}.{n} | {TYPE} — {title}` + `WHAT:`/`WHY:`
  lines. Corrections are new entries with `SUPERSEDES:`, never edits.
- **`STATE.md`** — one-page projection (Now / Truths / Next / Blocked / Watch /
  Dead ends). Rebuilt from the logbook, never patched. Logbook wins on conflict.
- **Entry protocol:** read `STATE.md` + last ~5 logbook headings
  (`grep "^## \[" LOGBOOK.md | tail -5`) before working. Write a close entry
  before leaving. Authority: `STANDARD.md`, shipped alongside this file.

## Task grain — `.agents/session.log`

Fine-grained work journal at each project root, shared by all agents.
- Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`,
  PHASE ∈ discuss·build·refactor·debug·review·ops.
- Write progressively: open with `APPROACH:` + `STATUS: in-progress`,
  checkpoint with `FILES:`/`VALIDATED:`/`PROBLEM:`/`FIX:`, close with final
  `STATUS:` + `NEXT: {owner} — {action}`.
- Resume: `grep "{feature}\." .agents/session.log | tail` — read that entry's
  `STATUS:`/`NEXT:`. Never read the whole file.
- Append-only. Corrections = new entry with `SUPERSEDES: {feature}.{n}`.
- Full spec: `SESSION-LOG.md`, shipped alongside this file; a paste-ready
  directive for any agent config ships as a wiring template with this kit.

## Surface tiering — hot vs cold

**Hot/cold surface tiering.** Hot surfaces are auto-loaded every session:
projections only (global `STATE.md`, project `STATE.md`) — one page each,
facts only. Cold surfaces are chronology and entry bodies (`LOGBOOK.md`,
`session.log` bodies): never auto-loaded, grep-on-demand only. A surface that
is neither a one-page projection nor greppable chronology is a design smell.

## Session entry — the allowlist ritual

**Closed allowlist entry ritual.** A session reads exactly one thing at entry:
its compiled brief (per-intent, see the kit's `brief` command). Nothing else by
default. Counter-failure: anything visible gets woven into plans, so relevance
filtering must happen *before* context load, not after.

**Headings-not-bodies.** For other agents' or other features' in-flight work, a
session may see entry HEADINGS (awareness that work exists) but not bodies (no
exposure to approach). Counter-failure: anchoring on another session's
approach.

## Ghosts

**48h ghost rule.** A `STATUS: in-progress` entry older than 48 hours is a
ghost: flagged in briefs and by the doctor; the next session in that project
closes it as `abandoned` via a superseding entry. Counter-failure: dead claims
steering live sessions.

## Session lifecycle

**Snapshot session lifecycle (BEGIN/WORK/CLOSE).**
- **BEGIN** — declare intent (a feature slug), compile the brief, treat it as a
  snapshot of the record at entry time.
- **WORK** — no mid-session re-reads of shared state; the session's own open
  log entry is the cohesion anchor (re-read it after compaction, not the shared
  files).
- **CLOSE** — land the plane: close the entry with an owned `NEXT:`, promote
  project-worthy events to the logbook, rebuild stale projections. Conflicts
  with concurrently-landed work reconcile here, not mid-flight.

Counter-failure: shared files changing under a session mid-task.

## Rules that keep this working

1. **Memory and files are complementary, with one arbiter.** Private agent
   memory is first-class for what it uniquely holds: user preferences, learned
   corrections, failure patterns, craft. Shared files are the sole authority
   for **coordination state** — what's done, decided, next, and owned. If it
   matters to another agent, it goes in STATE/LOGBOOK/session.log; on conflict
   about project state, the files win (memory may be stale the moment someone
   else writes an entry).
2. **Append-only everywhere** except STATE pages (which are rebuilt whole).
3. **NEXT is always owned** — every handoff names who acts: a human tag
   (e.g. `human`), an agent tag, or `joint`.
4. **Never edit another agent's entries.** Disagree via a new entry.
5. **Awareness is global, initiative is scoped.** Read all shared state you are
   shown, but act only on what the user asked for in *this* session plus items
   whose `NEXT:` names you or is unowned. Another agent's or session's
   in-flight work is context to reference, never backlog to re-plan — name
   intersections, don't grab them.
6. Legacy `.claude/session.log` files are honored read-only; new entries go to
   `.agents/session.log`.

**Preserved v1 invariants** (unchanged in v1.1, restated here): append-only +
`SUPERSEDES:` corrections · agent attribution in every entry · owned `NEXT:` ·
rebuild-don't-patch projections · pointers-not-payloads · event-triggered
writes.

## Changes from v1

v1.1 adds the **pollution-control architecture**. Nothing from v1 is removed.

1. **Hot/cold surface tiering** — projections are hot (auto-loaded, one page);
   chronology and entry bodies are cold (grep-on-demand only).
2. **Closed allowlist entry ritual** — a session reads exactly its compiled
   brief at entry; relevance filtering happens before context load.
3. **Headings-not-bodies** — other agents'/features' in-flight work is visible
   as headings only, never bodies.
4. **48h ghost rule** — `in-progress` entries older than 48h are flagged and
   closed as `abandoned` by the next session in that project.
5. **Snapshot session lifecycle (BEGIN/WORK/CLOSE)** — brief as snapshot, no
   mid-session re-reads, reconcile at close.
6. **Preserved v1 invariants** — restated verbatim above; append-only,
   supersession, attribution, owned NEXT, rebuild-don't-patch,
   pointers-not-payloads, event-triggered writes all carry forward.
