# CONTINUITY — cross-harness protocol (canonical) — v1.1

Any agent working on this machine or its repos follows this. The record is
**file-based and harness-neutral**: no agent's private memory is the source of
truth — the files are. Claude Code, Pi, Hermes, Codex, Cursor, and humans all
read and write the same surfaces.

**Your agent tag:** write yourself as `claude`, `pi`, `hermes`, `codex`,
`cursor`, or `human` in every entry you author; `joint` is valid for genuinely
co-authored human+agent entries (and as a `NEXT:` owner). Never omit the tag.

## Global grain — `~/.agents/STATE.md`

One-page cross-project projection: active threads, backlog, watch items.
- **Session start:** read it — allowlist item 1 of the entry ritual (machine
  grain, so it sits outside any project brief and is read directly).
- **Session close:** if cross-project state changed (thread opened/closed,
  backlog item added), rebuild the page — never patch it. Chronology does not
  live here; it lives in project logbooks.

## Project grain — Logbook Standard

Every non-trivial project carries:
- **`LOGBOOK.md`** — append-only chronology. Entries:
  `## [YYYY-MM-DD] {actor} {stream}.{n} | {TYPE} — {title}` + `WHAT:`/`WHY:`
  lines. Corrections are new entries with `SUPERSEDES:`, never edits.
- **`STATE.md`** — one-page projection (Now / Truths / Next / Blocked / Watch /
  Dead ends). Rebuilt from the logbook, never patched. Logbook wins on conflict.
- **Entry reads:** project `STATE.md` + the last 3–5 logbook headings
  (e.g. `grep "^## \[" LOGBOOK.md | tail -5`, which returns up to the last 5) —
  allowlist items 2–3 of the entry ritual, delivered via the compiled brief by
  default or read directly in the no-kit fallback. Write a close entry before
  leaving. Authority: `STANDARD.md`, shipped alongside this file.

## Task grain — `.agents/session.log`

Fine-grained work journal at each project root, shared by all agents.
- Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`,
  PHASE ∈ discuss·build·refactor·debug·review·ops.
- Write progressively: open with `APPROACH:` + `STATUS: in-progress`,
  checkpoint with `FILES:`/`VALIDATED:`/`PROBLEM:`/`FIX:`, close with final
  `STATUS:` + `NEXT: {owner} — {action}`.
- Reading back is two distinct operations, with two distinct depths and
  moments: **session entry** (at BEGIN) loads the feature's recent history via
  allowlist item 4; **mid-session resume** — permitted only after context loss
  (e.g. compaction), re-anchoring on a task this session already holds — is
  the minimal check defined in `SESSION-LOG.md` §4: `grep "{feature}\."
  .agents/session.log | tail`, read the latest entry's `STATUS:`/`NEXT:`,
  then stop. Never read the whole file in either mode.
- Append-only. Corrections = new entry with `SUPERSEDES: {feature}.{n}`.
- Full spec: `SESSION-LOG.md`, shipped alongside this file; a paste-ready
  directive for any agent config ships as a wiring template with this kit.

## Surface tiering — hot vs cold

**Hot/cold surface tiering.** Hot surfaces are auto-loaded every session:
projections only (global `STATE.md`, project `STATE.md`) — one page each,
facts only. Cold surfaces are chronology and entry bodies (`LOGBOOK.md`,
`session.log` bodies): never auto-loaded, grep-on-demand only. A surface that
is neither a one-page projection nor greppable chronology is a design smell.
Counter-failure: a shared surface auto-loaded by every session makes each
session ingest the union of all sessions' context — pollution by broadcast.

The tiering also fixes what "shared state" means for re-reads (the WORK rule
below): hot surfaces and open entries are **mutable** — they can change under
a running session; closed entries in the chronology are **immutable** —
append-only means history can grow, but a closed entry can never change.
Re-reading mutable state mid-session breaks the snapshot; reading immutable
closed history mid-session cannot.

## Session entry — the allowlist ritual

**Closed allowlist entry ritual.** A session's entry reads are exactly this
set — nothing else by default:

1. global `STATE.md` (hot; machine grain, one page by hard cap, read directly);
2. project `STATE.md`, verbatim (hot; one page by hard cap);
3. headings of the last 3–5 entries in `LOGBOOK.md` and `.agents/session.log`
   (awareness of recent and parallel work). Entries belonging to the declared
   feature's own stream are exempt from the headings-only limit — item 4
   carries their bodies; all other streams stay headings-only (per the
   headings-not-bodies rule below);
4. the declared feature's own entries, bodies included: its `session.log`
   entries (newest first, capped at the last 10) and its `LOGBOOK.md` stream
   entries within item 3's 3–5-entry window (the same window `STANDARD.md`'s
   crash-recovery order reads — one cap, stated in both documents);
5. `NEXT:` lines owned by this session's agent tag or unowned, drawn only from
   the surfaces items 2–4 already expose;
6. ghost flags (per the 48h ghost rule): `STATUS: in-progress` lines older
   than 48h, detected by a status-line scan of the project's active
   `session.log` — project-scoped and bounded by the file's rotation cap.

Counter-failure (this ritual): anything visible gets woven into plans, so
relevance filtering must happen *before* context load, not after.

The kit's `brief` command compiles items 2–6 into one disposable per-intent
artifact, each section carrying a `ref:` pointer to its source. Pointer
targets are NOT read at entry: refs are carried as pointers only, and
following one later is an on-demand read of immutable closed history,
permitted by the WORK rule below. Without the kit, read the six items
directly, in the order listed — `STANDARD.md`'s crash-recovery sequence
(projection first, recent chronology second), deliberately narrowed as
disclosed in "Changes from v1": non-target streams are headings-only, and the
sequence's "follow pointers" step is deferred out of entry entirely.
`STANDARD.md` states the same narrowings at its crash-recovery definition, so
the two documents agree.
Briefs are per-session compilations of logged facts, discarded at close; they
are never persisted and never contain guidance, so the speculative-auto-context
failure mode in `STANDARD.md`'s table (which targets persistent state files)
does not apply to them.

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

**Snapshot session lifecycle (BEGIN/WORK/CLOSE).** (Session grain — distinct
from `SESSION-LOG.md` §3's Start/Checkpoint/Close, which is the write protocol
for a single log entry.)
- **BEGIN** — declare intent (a feature slug), run the entry ritual, treat its
  result as a snapshot of the record at entry time.
- **WORK** — no mid-session re-reads of **mutable** shared state (projections
  and other streams' open entries — the surfaces that can change under you;
  see the tiering section): the BEGIN snapshot stands until CLOSE. Reading
  **immutable** closed history on demand — following a brief `ref:` pointer,
  grepping archived entries — is permitted; it cannot break the snapshot.
  The session's own open log entry is the cohesion anchor. After context loss
  (e.g. compaction), re-anchor by re-reading that entry, then the mid-session
  resume check (`SESSION-LOG.md` §4) — the only sanctioned re-read of the
  session's own stream tail.
- **CLOSE** — land the plane: close the entry with an owned `NEXT:`, promote
  project-worthy events to the logbook, rebuild stale projections. Conflicts
  with concurrently-landed work reconcile here, not mid-flight.

Counter-failure: mutable shared files changing under a session mid-task.

## Rules that keep this working

All six rules carry forward from v1; rule 3 is clarified and rule 4 tightened,
both disclosed in "Changes from v1".

1. **Memory and files are complementary, with one arbiter.** Private agent
   memory is first-class for what it uniquely holds: user preferences, learned
   corrections, failure patterns, craft. Shared files are the sole authority
   for **coordination state** — what's done, decided, next, and owned. If it
   matters to another agent, it goes in STATE/LOGBOOK/session.log; on conflict
   about project state, the files win (memory may be stale the moment someone
   else writes an entry).
2. **Append-only everywhere** except STATE pages (which are rebuilt whole).
3. **NEXT is always owned at write time** — every handoff names who acts: a
   human tag (e.g. `human`), an agent tag, or `joint`. An unowned `NEXT:`
   found in the record is a defect, not a category: briefs and the doctor
   surface it for adoption, and the next session touching that stream claims
   or reassigns it via a superseding entry.
4. **Never edit a closed entry — anyone's, your own included.** Corrections
   are new entries with `SUPERSEDES:`; disagreement with another agent is
   likewise a new entry. Counter-failure: self-editing history to erase a
   wrong call destroys the calibration data and audit trail that supersession
   exists to preserve.
5. **Awareness is global, initiative is scoped.** Read all shared state you
   are shown (what the entry ritual, post-context-loss re-anchoring, and
   on-demand reads of immutable history expose — this rule widens nothing),
   but act only on what the user asked for in *this* session plus items
   whose `NEXT:` names you or is unowned. Another agent's or session's
   in-flight work is context to reference, never backlog to re-plan — name
   intersections, don't grab them.
6. Legacy session logs living inside tool-specific configuration directories
   are honored read-only; new entries go to the tool-neutral
   `.agents/session.log`.

**Preserved v1 invariants** (unchanged in v1.1, restated here): append-only +
`SUPERSEDES:` corrections · agent attribution in every entry · owned `NEXT:` ·
rebuild-don't-patch projections · pointers-not-payloads · event-triggered
writes.

## Changes from v1

v1.1 adds the **pollution-control architecture**. Nothing from v1 is removed.

1. **Hot/cold surface tiering** — projections are hot (auto-loaded, one page);
   chronology and entry bodies are cold (grep-on-demand only). The tiering
   also defines the mutable/immutable split that scopes the WORK rule.
2. **Closed allowlist entry ritual** — the session-start read set is
   enumerated in this document (six items, each bounded) and compiled into a
   per-intent brief. The grain sections' v1 direct-read instructions are
   hereby redefined as inputs to this single ritual; the no-kit fallback reads
   the same surfaces v1 prescribed, in the same order, plus the v1.1 ghost
   flags. The crash-recovery sequence's "follow pointers" step is deferred
   out of entry: `ref:` pointers are carried, and followed only on demand as
   reads of immutable closed history. Session entry (item 4's capped
   bodies-included read, at BEGIN) and mid-session resume (`SESSION-LOG.md`
   §4's latest-STATUS/NEXT check, only after context loss) are distinct
   operations at distinct moments with distinct depths.
3. **Headings-not-bodies** — other agents'/features' in-flight work is visible
   as headings only, never bodies; the declared feature's own stream is
   exempt. This deliberately narrows v1's crash-recovery chronology step
   (which read full entries) for non-target streams.
4. **48h ghost rule** — `in-progress` entries older than 48h are flagged and
   closed as `abandoned` by the next session in that project.
5. **Snapshot session lifecycle (BEGIN/WORK/CLOSE)** — entry ritual as
   snapshot, no mid-session re-reads of mutable shared state (immutable
   closed history stays readable on demand), reconcile at close.
6. **Entry-edit rule tightened** — v1 forbade editing *another agent's*
   entries; v1.1 forbids editing any closed entry, your own included
   (alignment with `SESSION-LOG.md`'s "once closed, immutable").
   Counter-failure: self-editing history to erase a wrong call.
7. **Unowned-NEXT defect handling** — an unowned `NEXT:` found in the record
   is a defect state surfaced for adoption by briefs and the doctor; the
   write rule is unchanged (NEXT is always owned at write time).
   Counter-failure: orphaned handoffs that nobody picks up — the single best
   predictor of a dead log.
8. **Preserved v1 invariants** — restated verbatim above; append-only,
   supersession, attribution, owned NEXT, rebuild-don't-patch,
   pointers-not-payloads, event-triggered writes all carry forward.
