# The Logbook Standard — v1.0 (2026-07-02)
### Project capture for human+agent collaboration. One standard, every project.

> **The principle:** a project must be resumable by a stranger — human or agent, tomorrow or in six months —
> by reading two files. Everything else in this standard serves that sentence.

## 0. The three planes

Every conforming project separates its record into three planes. Mixing them is the root failure mode.

| Plane | File(s) | Mutability | Answers |
|---|---|---|---|
| **Chronology** | `LOGBOOK.md` | Append-only, immutable | "What happened, when, why?" |
| **Projection** | `STATE.md` | Rewritten freely | "What is true right now? What's next?" |
| **Artifacts** | domain files + git history | Per their own rules | "Where is the actual substance?" |

The logbook is the **source of truth**. STATE.md is a *derived view* — if they disagree, the logbook wins and
STATE.md gets rebuilt (event-sourcing rule). Git already records what changed in files; the logbook never
repeats diffs — it records what happened *around* them: decisions, sessions, problems, discoveries.

Below the project planes sits the **session layer** — `.agents/session.log`, the task-grain work journal
shared by all agents. Spec: `SESSION-LOG.md` (shipped alongside this standard); a portable directive for
non-conforming agent configs ships as a wiring template with this kit. Session entries promote to
LOGBOOK.md when project-worthy.

**Crash-recovery read order** (session start, any agent): `STATE.md` → last 3–5 logbook entries (bodies
for the session's own declared stream; headings suffice for other streams, per `CONTINUITY.md`'s
headings-not-bodies rule) → follow pointers as needed, bounded to the `ref:` pointers those reads expose.
Never read the whole logbook (grep it instead); never skip STATE.md. A per-intent compiled brief that
packages this read order (see `CONTINUITY.md`'s entry ritual) satisfies it — the brief is this order,
compiled.

## 1. Entry envelope (fixed across all projects)

```markdown
## [YYYY-MM-DD] {actor} {stream}.{n} | {TYPE} — {title}
{PREFIX}: one to three lines each. Pointers, not payloads.
ref: path/or/url
NEXT: {owner} — {action}
```

- **Heading line is sacred** — it's what makes the file greppable: `grep "^## \[" LOGBOOK.md | tail -5`,
  `grep "| DECISION" LOGBOOK.md`, `grep " design\." LOGBOOK.md`.
- **actor**: who wrote it (`human`, `claude`, `agent-name`, `joint`). Every entry is attributed — no exceptions.
- **stream.n**: id namespace (`design.4`, `sweep.2`). Streams are project-defined; n increments within a stream.
- **TYPE**: one dominant type per entry, from the project's declared vocabulary (§2).
- Body ≤ ~10 lines. If you're pasting substance, stop — move it to an artifact and log the pointer
  (no-duplication rule). A logbook that quotes is a transcript dump nobody reads.

## 2. Vocabulary: fixed envelope, project-defined words

The **envelope** (§1) is identical in every project. The **TYPE list and prefixes** are declared per project
in its `LOGBOOK.md` header block — constrained vocabulary works (changelog research), but one global
vocabulary doesn't (Karpathy's open `op` token): a research project logs SWEEP and JUDGMENT; a build project
logs SHIP and REGRESSION.

Recommended default set (start here, extend deliberately):
`SESSION · DECISION · MILESTONE · PROBLEM · FIX · INSIGHT · RESEARCH · HANDOFF · CAPTURE`

Recommended default prefixes: `WHAT: / WHY: / ref: / DONE: / NEXT: / BLOCKED: / ASSUMED:`

## 3. STATE.md — the projection

One page, hard cap. Five sections, all bounded:

```markdown
# STATE — {project}
> Projection of LOGBOOK.md as of {date} (through {last-entry-id}). Logbook wins on conflict.

## Now        ← current focus, 1–3 lines
## Truths     ← decisions in force, one line each + logbook id (pointers, not rationale)
## Next       ← owned actions: {owner} — {action}. Unowned items are not allowed here.
## Blocked    ← what, on whom/what, since when
## Watch      ← assumptions needing validation, each with a validate-by date
## Dead ends  ← approaches tried and abandoned, one line each + why (or entry pointer)
```

The `Dead ends` section is non-negotiable for agent-heavy projects: without it, successive fresh-context
sessions confidently re-attempt the same failed approaches (Anthropic long-running-agent finding).

- Rebuilt (not patched) whenever it smells stale: replay recent logbook entries, rewrite the file.
  Cheap by design — it's disposable (Ralph's plan rule).
- The `Watch` section is the RAID/ADR import: every assumption carries a date it must be confirmed or
  killed by. An assumption without a validation date is a future incident.

## 4. Write protocol — event-triggered, never scheduled

Write an entry **when something happens**, not on a timer (scheduled logging is the #1 abandonment cause):

1. A decision is made → `DECISION` (with why, or a pointer to it)
2. A work session ends → `SESSION` close-out with `DONE:` / `NEXT: {owner}` / `BLOCKED:` — **mandatory,
   never skipped** ("land the plane"). If a session produced nothing, one line saying so.
3. Something broke or surprised → `PROBLEM` (+ later `FIX`, referencing it)
4. A milestone is reached, research lands, an artifact ships → log it with pointers
5. Context is about to be lost (compaction, handoff, end of day) → capture before it evaporates

Contemporaneity rule: write it in the session where it happened. A reconstructed entry must say
`(reconstructed {date})` — it's testimony, not record (FRE 803(6) logic).

## 5. Corrections: supersession, never erasure

Never edit or delete an existing entry — not for typos, not for being wrong, not for tidiness.
A wrong entry is corrected by a new entry:

```markdown
## [2026-07-10] claude sweep.9 | FIX — corrects sweep.7 row count
SUPERSEDES: sweep.7 (reported 40 rows; actual 34 — dedup ran twice)
```

The old entry stays. This is the GLP strikethrough / ADR supersession / RFC obsoletes rule: the record of
being wrong is itself load-bearing (calibration data, audit trail, trust).

## 6. Rotation and scale

- When the active `LOGBOOK.md` exceeds ~700 lines (≈15–20k tokens), roll closed entries to
  `logbook/{YYYY}-{Qn}.md` and keep the active file lean. Oversized state files silently break agent
  tooling (beads' 25k-token failure) and stop being read.
- STATE.md never rotates — it's always one page, always current.

## 7. Liveness audits — anti-theater

A maintained-looking log can still be dead. At the project's existing review rhythm (weekly, or whatever
cadence the project already has — don't invent a new meeting), check:

1. **NEXT pickup rate** — are `NEXT:` items from past entries getting picked up? Below ~half → the log is
   theater (postmortem action-item rule).
2. **STATE freshness** — does STATE.md's "as of" match recent work? Stale projection is worse than none:
   agents act confidently on dead context.
3. **Ownership** — any unowned `NEXT:`? Unassigned entries are the single best predictor of a dead log (RAID).
4. **Recurrence** — on every `PROBLEM`: have we seen this before? If yes, what happened to the last fix?
5. **Supersession pulse** — zero corrections ever = the log isn't being trusted with real information.

## 8. Agent rules

- Read STATE.md + logbook tail at session start (directly, or via a compiled brief per `CONTINUITY.md`).
  Grep for specifics; never read the full corpus.
- Log **actions, not beliefs** — what you did and touched, with file names, not your theory of the project.
- Resolve an ambiguity by assumption → log it: `ASSUMED: {assumption} (confirm)`.
- Your session-close entry is not optional, even mid-task (that's a `HANDOFF` entry: done / not-verified /
  next-safe-action).
- Never reorganize, deduplicate, or "clean up" the logbook. Append-only is the entire trust model.
- Reference artifacts by path; quote nothing over 3 lines.

## 9. Failure modes (named from the research, watch for them)

| Failure | Signature | Counter |
|---|---|---|
| Transcript dump | Long quoted content in entries | No-duplication rule, ≤10-line bodies |
| Stale projection | STATE.md contradicts recent entries | Rebuild-don't-patch; freshness audit |
| Update theater | Entries written, NEXT items never move | Pickup-rate audit; owners on everything |
| Kickoff-and-abandon | Dense week 1, silence by week 3 | Event-triggered writes; session-close mandate |
| Vocabulary sprawl | New TYPE invented per entry | Extend vocabulary deliberately, in the header block |
| Monolith guide | Project guide grows past ~170 lines | The guide is the header block + this standard; keep local additions tiny |
| Silent format drift | Agents approximating the envelope | Envelope examples in template; audit greps fail loudly |
| Speculative auto-context | Agent-invented rules/guidance in state files | Agents project logged facts only; humans curate guidance (ETH Zurich: LLM-generated context files measure −3% success at +20% cost; human-curated +4pp) |

## 10. Versioning — delete the harness

This standard is v1.0 and expects to shrink. Re-read it against each model generation: any rule a current
model reliably does unprompted gets deleted (Karpathy VIII — "the harness that grows monotonically is a
harness you have stopped reading"). Enforcement hooks (session-start injection, close-out gates) are
deliberately **not** in v1 — add them only if compliance audits show politeness failing, and log that
decision. Changes to this standard are themselves logged in its repo.

---
*Logbook Standard v1.0 · derived from convergent evidence across GLP lab notebooks,
ship's logs, ADR/RFC, changelogs, event sourcing, SRE postmortems, RAID logs, daybooks, and agent-native
systems (Memory Bank, Ralph, beads, handoff protocols, ESAA, Karpathy's loop notes).*
