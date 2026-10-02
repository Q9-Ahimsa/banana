<!-- banana:canon rev 1.7 -->
# CONTINUITY — cross-harness protocol (canonical) — v1.7

Any agent working on this machine or its repos follows this. The record is
**file-based and harness-neutral**: no agent's private memory is the source of
truth — the files are. Claude Code, Pi, Hermes, Codex, Cursor, and humans all
read and write the same surfaces.

**Your agent tag:** write yourself as `claude`, `pi`, `hermes`, `codex`,
`cursor`, or `human` in every entry you author; `joint` is valid for genuinely
co-authored human+agent entries (and as a `NEXT:` owner). Never omit the tag.

## Agent bootstrap — landing in a bare workspace

For an agent with zero prior context arriving in a workspace that has no
continuity files yet. A **workspace** is anything worth a durable record: a
git repository or a non-code **topic directory** (research notes, a course,
an ops runbook) — version control is not a precondition for continuity.

1. **Machine context first.** Read `~/.agents/STATE.md` if it exists (global
   grain, one page). If missing, create it by copying the literal template in
   the "Global grain" section below verbatim, performing exactly one
   substitution: the owner's name in place of `{owner}` in the header line.
   The `{owner}` inside the Backlog placeholder text is example content —
   leave it as written.
   (`STANDARD.md` §3's six-section template is project grain — its
   Truths/Blocked/Dead-ends sections, logbook ids, and rebuild-on-close
   discipline are project-scoped and do not apply here; this global page keeps
   its own header's rules: one page, edited per-thread, never rewritten whole —
   v1.6, ADR 0005.)
2. **Initialize the workspace.** Preferred: run the kit's `project` command
   named in your wiring block — it creates the files below idempotently and
   proceeds in non-git topic dirs. By hand, create whichever are missing:
   - `.agents/session.log` — task-grain journal, entries per the envelope in
     `SESSION-LOG.md` §1;
   - `STATE.md` — copied verbatim from the literal template in
     `STANDARD.md` §3;
   - `LOGBOOK.md` — project-grain chronology per `STANDARD.md` §1–§2: the
     entry envelope plus the literal header block template in §2, copied
     verbatim. Create it by default; running session.log alone
     (`SESSION-LOG.md` §6) is a deliberate deferral the workspace owner
     decides — never a bootstrap-time judgment call — recorded in
     `.agents/session.log` as a `DECISION:` line containing the literal
     string `defer LOGBOOK.md`. Operational test:
     `grep "DECISION:.*defer LOGBOOK.md" .agents/session.log` — a match
     means deferred; no match (or no session.log at all) means create the
     file. Record-then-test: an owner's live deferral instruction is written
     first — create `.agents/session.log` (first in this list), append the
     `DECISION:` line, then run the test, which now matches. Absent any
     owner instruction there is nothing to record and bootstrap stays fully
     no-human-in-the-loop. The mere absence of `LOGBOOK.md` is never itself
     evidence of deferral.
3. **Enter through the ritual.** Declare your feature slug first. Then close
   out the self-setup act as its own dedicated entry, written in one append —
   `SESSION-LOG.md` §3's Start and Close steps collapse into a single write
   for this one-shot act. Its complete literal shape:

   ```markdown
   ## [YYYY-MM-DD] {agent} bootstrap.1 | ops — workspace self-setup
   APPROACH: initialize continuity files per canon bootstrap.
   FILES: {the files created in step 2}
   STATUS: complete
   NEXT: {your tag} — {declared feature slug}
   ```

   Then run the session entry ritual (the allowlist below) — via the kit's
   `brief` or the direct reads — and open the feature's own entry
   (`APPROACH:` + `STATUS: in-progress`) with its own PHASE. Never fold
   self-setup into the feature's entry: one entry, one phase.
4. **Close before leaving.** Final `STATUS:` + owned `NEXT:` — the close
   entry is mandatory even mid-task (`STANDARD.md` §8).

In a version-controlled workspace the continuity files are part of the shared
record: track and commit them; never add them to `.gitignore`. (The kit never
commits — committing is the agent's own close-out action.) Counter-failure:
an untracked record is invisible to every other clone — continuity that dies
at the machine boundary.

Counter-failure: an agent landing cold either invents ad-hoc record-keeping
or keeps none — either way the next session inherits nothing. Bootstrap makes
workspace self-setup deterministic, with no human in the loop.

## Global grain — `~/.agents/STATE.md`

One-page cross-project projection. Its literal shape — what the kit's `init`
writes and what bootstrap step 1 copies verbatim (sections with nothing to
report yet keep their single placeholder line rather than being omitted):

```markdown
# GLOBAL STATE — cross-project projection
> One page, hard cap. Edit only your own threads; never rewrite the page.
> Chronology lives in project logbooks; this file only answers "what's live and
> what's queued across everything." Owner: {owner}. Protocol:
> `~/.agents/canon/CONTINUITY.md`.
> One line per bullet: thread 400 · backlog 300 · watch 350 · closed 250 chars.
> Closed lines carry `(closed YYYY-MM-DD)`. By the page's newest stamp, closed lines expire
> at 8+ days and threads idle 31+ days move to Backlog. Never delete a line — except
> a pasted secret, deleted outright. `banana state archive` moves the rest to STATE-archive.md.

## Active threads
- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)

## Backlog (owned)
- (queued cross-project items, each owned: `{owner} — action` or an agent tag)

## Watch
- (assumptions and deadlines needing attention, each with a validate-by date)

## Recently closed (context for next session)
- (last few finished threads, one line each: **name** (closed YYYY-MM-DD) — outcome → pointer)
```
- **Session start:** read it — allowlist item 1 of the entry ritual (machine
  grain, so it sits outside any project brief and is read directly).
- **Session close:** if cross-project state changed (thread opened/closed,
  backlog item added), edit only the threads and items your session owns or
  changed — a targeted edit right after a fresh read, re-stamping each touched
  thread's `(as of)` from its source. Never rewrite the whole page: several
  sessions write it concurrently, and a whole-page write from a stale read
  deletes their updates. Freshness is enforced by `banana state lint --global`,
  not by rebuilding. Chronology does not live here; it lives in project
  logbooks.
- **Freshness stamp** — every Active-threads bullet carries `(as of
  YYYY-MM-DD)`, the newest source it was rebuilt from (normally its project
  STATE's as-of); a project STATE dated later than the stamp means the
  thread is stale, and `banana state lint --global` FAILs it.
- **Limits and the one-line rule** (v1.7, ADR 0006) — the rule: every
  top-level bullet is written as one physical line, nothing else following
  it. A bullet has already broken that rule the moment it carries even one
  continuation line — a line directly after it that is not a heading, a
  `---` rule, a fence opener, a comment-only line, or another top-level
  bullet (plus, after a blank line, an indented paragraph — a loose item's
  next line); those are the only lines `banana state lint --global` treats
  as the bullet's own for measuring and flagging, never as compliant with
  the rule. Each section caps a bullet's own marker line at its own char
  limit (thread 400 · backlog 300 · watch 350 · closed 250): WARNs
  `line-over-limit` when that line alone is over its cap, and WARNs
  `bullet-wrapped` separately the moment any continuation line exists at
  all, however short — join it back onto one line.
- **Closed stamp and expiry** — a Recently-closed bullet carries `(closed
  YYYY-MM-DD)`, parsed with the same hardened rules as the freshness stamp
  above. It expires when its stamp is more than 7 days before the page's own
  reference date — the newest valid stamp on the page, never the clock.
- **Thread inactivity** — an Active-threads bullet whose `(as of)` stamp is
  more than 30 days before that same reference date — 31 or more — becomes
  a Backlog line instead of staying put, unless that same bullet already
  FAILs `thread-stale`: the two remedies contradict (refresh the stamp vs.
  archive the thread), so a stale bullet skips `thread-inactive` until its
  stamp is refreshed. `banana state lint --global` WARNs both
  `closed-expired` and `thread-inactive` (judgment calls, not mechanical
  defects — the page-wide cap stays the FAIL backstop).
- **The archive move** — removal from the page is never a deletion: any
  line leaving it — or the long form of a line being trimmed in place — is
  first copied verbatim into the append-only `~/.agents/STATE-archive.md`,
  via `banana state archive --reason
  <expired|inactive|trimmed|closed|removed>`, before it is removed; the
  archive is never loaded at session start, searched with `grep` only. The
  five reasons: `expired` (a closed line past its expiry), `inactive` (an
  idle thread becoming a one-line Backlog item), `trimmed` (the archive
  keeps a copy only — the live line is shortened in place by hand),
  `closed` (a finished Active thread: archive its line, add a
  Recently-closed line), `removed` (anything else the owner drops).
  `expired` only targets a Recently-closed line; `inactive` and `closed`
  only target an Active-threads line; `trimmed`/`removed` have no such
  restriction, and the command refuses, naming the right section, when a
  reason targets the wrong one. A routine status update to your own thread
  is not a removal — its history already lives at the pointer target — and
  neither is a section's
  placeholder line giving way to that section's first real bullet;
  archiving applies only when text leaves the page outright or a line is
  trimmed. Exception to "edit only your own threads" above: any session may
  archive an `expired` closed line, or correct an impossible future-dated
  stamp that is blocking someone else's move (below), on sight — no
  judgment is needed to recognize either.
- **The archive command is the clock-aware gate** — `banana state lint`
  stays clock-free (ADR 0004): a mistyped future stamp can make it WARN a
  whole page expired or inactive, and that is fine, because lint never
  changes anything. `banana state archive` is the side that acts, and it
  does read the clock — which means its `expired`/`inactive` gate can
  disagree with lint's own `closed-expired`/`thread-inactive` WARNs: lint
  compares a stamp against the page's reference date, the gate compares the
  same stamp against today, and those two dates differ whenever the page's
  newest stamp isn't dated today, so a line can pass one check before the
  other catches up. For `--reason expired` it refuses unless the line's own
  `(closed …)` stamp is more than 7 days before today; for `--reason
  inactive` it refuses unless the `(as of …)` stamp is more than 30 days
  before today. A missing stamp refuses and suggests `--reason removed`.
  Before any of that, the gate scans EVERY Active-threads `(as of …)` and
  Recently-closed `(closed …)` stamp on the page — not only the matched
  line's own — and refuses, naming the first one dated after today, so that
  stamp can be fixed first.
- **Secrets** — a credential, token, or key pasted onto the page is deleted
  outright, never archived. If one already reached the archive, delete it
  there too; it is the only edit the archive file ever takes.
- **By hand, without the kit** — create `~/.agents/STATE-archive.md` with
  its header if it does not exist, then append one record per move,
  separated by a blank line, newest last:
  ```markdown
  # GLOBAL STATE — archive
  > Append-only — except a pasted secret: delete it here too, on sight. Lines moved off
  > ~/.agents/STATE.md (or the long form of trimmed ones), verbatim, newest last. Never
  > loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md

  ## [YYYY-MM-DD] {agent} — {reason} · {section name}
  {the matched line, byte-verbatim}
  ```
  A moved bullet is always exactly one line (the one-line rule below) — the
  record body is a single line, never several. `banana state archive`
  remains the preferred way; this is for a harness that cannot run it.

## Project grain — Logbook Standard

Every non-trivial project carries:
- **`LOGBOOK.md`** — append-only chronology. Entries:
  `## [YYYY-MM-DD] {actor} {stream}.{n} | {TYPE} — {title}` + `WHAT:`/`WHY:`
  lines. Corrections are new entries with `SUPERSEDES:`, never edits.
- **`STATE.md`** — one-page projection (Now / Truths / Next / Blocked / Watch /
  Dead ends). Rebuilt from the logbook at session close; mid-arc section
  patches are legal, each ensuring the dirty-marker line (`STANDARD.md` §3).
  Logbook wins on conflict.
- **Entry reads:** project `STATE.md` + the last 5 logbook headings
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
  the minimal check defined in `SESSION-LOG.md` §4: locate the feature's
  latest entry (`grep -n "{feature}\." .agents/session.log | tail`), read
  that entry's span for its `STATUS:`/`NEXT:`, then stop. Never read the
  whole file in either mode.
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
3. headings of the last 5 entries (`tail -5` — up to 5 when the file is
   shorter; one fixed count, not a judgment range) in `LOGBOOK.md` and
   `.agents/session.log`
   (awareness of recent and parallel work). Entries belonging to the declared
   feature's own stream are exempt from the headings-only limit — item 4
   carries their bodies; all other streams stay headings-only (per the
   headings-not-bodies rule below);
4. the declared feature's own entries, bodies included: its `session.log`
   entries (newest first, capped at the last 10) and its `LOGBOOK.md` stream
   entries within item 3's 5-entry window (the same window `STANDARD.md`'s
   crash-recovery order reads — one cap, stated in both documents);
5. `NEXT:` lines owned by this session's agent tag or unowned, drawn only from
   the surfaces items 2–4 already expose;
6. ghost flags (per the 48h ghost rule): `STATUS: in-progress` lines older
   than 48h and not retired by a `SUPERSEDES:` reference, detected by a
   status-line scan of the project's active `session.log` — project-scoped
   and bounded by the file's rotation cap.

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
closes it as `abandoned` via a superseding entry. Entry dates are day-grain,
so the operational test is fixed: the 48 hours are measured from midnight UTC
at the start of the entry's heading date — an entry dated D is a ghost from
the start of day D+2 (UTC). An entry named by a later `SUPERSEDES:` reference
is retired from ghost surfaces regardless of its own status line: the
superseding entry carries the stream's liveness clock and is itself subject
to this rule — an open continuation is how work legitimately moves forward,
so the superseding entry's own status is irrelevant to the retirement. The
kit's `brief` and `doctor` compute exactly this; a by-hand scan applies the
same two-step test — scan for `STATUS: in-progress` lines older than 48h,
then drop entry ids named on any `SUPERSEDES:` line. Counter-failure: dead
claims steering live sessions — and zombie flags on corrected history
burying the real ones.

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
  project-worthy events to the logbook (operational test: `SESSION-LOG.md`
  §6's promotion rule), rebuild stale projections (project STATE.md: rebuild
  exactly when this session promoted or the dirty marker stands —
  `STANDARD.md` §3's two-trigger test; global STATE.md: rebuild when
  cross-project state changed). Conflicts with
  concurrently-landed work reconcile here, not mid-flight.

Counter-failure: mutable shared files changing under a session mid-task.

## Upstream and sync — who owns which surface

The protocol documents you are reading are installed by the kit's `init`
command (the one-time machine-level setup: canon install + harness wiring)
into a **kit-owned** directory: `~/.agents/canon/` (`CONTINUITY.md`,
`STANDARD.md`, `SESSION-LOG.md`).

- **Kit-owned, sync-overwritable:** everything under `~/.agents/canon/`. The
  kit's `sync` command overwrites this directory with its bundled canon
  freely. Never hand-edit these files — edits are lost on the next sync;
  protocol changes belong upstream in the kit repo.
- **User-owned, the kit never rewrites their content:** the record itself —
  global and project `STATE.md`, `.agents/session.log` and its rotated
  archives, `LOGBOOK.md` and its `logbook/` archives, and any wired
  instruction file's content outside the kit's fence markers. The kit
  creates these only if missing and rewrites only inside its own fences.
  The one exception: `banana state archive` removes exactly the one line
  its caller named from the global `STATE.md`, after copying it verbatim
  into `STATE-archive.md` first, and — only when that removal would leave
  the line's section with no bullet at all — writes back that section's own
  single placeholder line in its place. That is the full extent of it: the
  single kit command permitted to touch the global page's content, and only
  ever that one named line plus, when needed, its section's placeholder.
- **Version markers:** the first line of every canon file is a
  machine-readable marker, `<!-- banana:canon rev X.Y -->`. The doctor
  compares installed markers against the kit's bundled canon and flags stale
  installs; `sync` is the remediation it names.
- **Precedence:** wired blocks, paste-adapted directives, and any other
  summary of this protocol are pointers, not authorities — when one
  disagrees with the canon, the canon wins. Counter-failure: a stale or
  hand-edited block quietly forking the protocol on one machine.

Counter-failure, in both directions: without a kit-owned overwrite zone,
wired machines drift onto stale protocol with no mechanical detection;
without the user-owned boundary, an updater could trample the very record
this protocol exists to protect.

## Rules that keep this working

All six rules carry forward from v1; rule 2's scope is restated for v1.2's
kit-owned canon directory (item 10) and its STATE-page parenthetical amended
for v1.3's rebuild-on-close (item 13) and again for v1.6's per-thread edits
(item 16), rule 3 is clarified, rule 4 is tightened, and rule 5 gained its
read-scope parenthetical (binding "what you are shown" to the v1.1 entry
ritual and its sanctioned re-reads) — each disclosed in "Changes from v1".

1. **Memory and files are complementary, with one arbiter.** Private agent
   memory is first-class for what it uniquely holds: user preferences, learned
   corrections, failure patterns, craft. Shared files are the sole authority
   for **coordination state** — what's done, decided, next, and owned. If it
   matters to another agent, it goes in STATE/LOGBOOK/session.log; on conflict
   about project state, the files win (memory may be stale the moment someone
   else writes an entry).
2. **Append-only everywhere** except STATE pages (projections — the global page
   edited per-thread (v1.6, ADR 0005), project pages per `STANDARD.md` §3's
   rebuild-on-close).
   Scope: this rule governs the record — the user-owned surfaces (session
   logs, logbooks, STATE pages). The kit-owned `~/.agents/canon/` directory
   is protocol documentation, not record: it is version-marked and
   sync-overwritable per "Upstream and sync" (v1.2, changes item 10).
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
   intersections, don't grab them. Counter-failure (the parenthetical):
   without the binding, "read all shared state you are shown" reads as
   license to browse the record at will — reintroducing the pollution the
   entry ritual exists to prevent.
6. Legacy session logs living inside tool-specific configuration directories
   are honored read-only; new entries go to the tool-neutral
   `.agents/session.log`.

**Preserved v1 practice invariants** — write-behavior guarantees whose
mechanisms carry through v1.1 intact. A companion checklist, not a second
enumeration of the numbered rules: it restates rules 2–3 in practice form,
rule 4's supersession mechanism (the mechanism is unchanged; the rule's
*scope* was tightened in v1.1 — changes item 6), the entry-attribution
mandate from this document's preamble ("never omit the tag") and
`STANDARD.md` §1 ("every entry is attributed — no exceptions"), and the
remainder (rebuild-on-close — v1.3's amendment of v1's rebuild-don't-patch,
item 13 — pointers-not-payloads, event-triggered writes) are `STANDARD.md`'s
write contracts: append-only + `SUPERSEDES:` corrections · agent attribution
in every entry · owned `NEXT:` · rebuild-on-close projections ·
pointers-not-payloads · event-triggered writes.

## Changes from v1

v1.1 adds the **pollution-control architecture**. No v1 surface or record is
removed. One v1 write permission is revoked — editing your own closed entries,
rule 4's tightening, disclosed in item 6 — and three v1 *read* behaviors are
deliberately narrowed or newly bounded: the entry read-set (item 2),
non-target stream depth (item 3), and mid-session re-reads of mutable shared
state (item 5); every other v1 behavior carries forward.

1. **Hot/cold surface tiering** — projections are hot (auto-loaded, one page);
   chronology and entry bodies are cold (grep-on-demand only). The tiering
   also defines the mutable/immutable split that scopes the WORK rule.
2. **Closed allowlist entry ritual** — the session-start read set is
   enumerated in this document (six items, each bounded) and compiled into a
   per-intent brief. The grain sections' v1 direct-read instructions are
   hereby redefined as inputs to this single ritual; the no-kit fallback
   reads the same surfaces v1 prescribed, in the same order — with the two
   narrowings this list discloses (non-target streams headings-only, item 3;
   pointer-following deferred out of entry, below) — plus the v1.1 ghost
   flags. The crash-recovery sequence's "follow pointers" step is deferred
   out of entry: `ref:` pointers are carried, and followed only on demand as
   reads of immutable closed history. Session entry (item 4's capped
   bodies-included read, at BEGIN) and mid-session resume (`SESSION-LOG.md`
   §4's latest-STATUS/NEXT check, only after context loss) are distinct
   operations at distinct moments with distinct depths. Rule 5's read-scope
   parenthetical was added alongside this ritual, binding its "read all
   shared state you are shown" clause to the ritual's exposure; the rule's
   initiative scope is unchanged from v1.
3. **Headings-not-bodies** — other agents'/features' in-flight work is visible
   as headings only, never bodies; the declared feature's own stream is
   exempt. This deliberately narrows v1's crash-recovery chronology step
   (which read full entries) for non-target streams.
4. **48h ghost rule** — `in-progress` entries older than 48h are flagged and
   closed as `abandoned` by the next session in that project. Superseded
   entries are already retired from the surfaces and are not flagged (v1.4).
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
8. **Preserved v1 practice invariants** — restated above; append-only,
   supersession, attribution, owned NEXT, rebuild-don't-patch,
   pointers-not-payloads, event-triggered writes all carry forward
   (mechanisms intact; rule 4's scope tightening is item 6's disclosure, not
   a mechanism change). A write-behavior checklist alongside the numbered
   rules, as labeled there. Counter-failure: an invariant not restated at a
   new revision reads as silently dropped.

v1.2 adds the **agent-first bootstrap and upstream model**. Nothing from
v1.1 is removed.

9. **Agent bootstrap section** — a zero-context agent self-initializes any
   bare workspace (git repo or non-code topic dir) from the canon alone:
   which files to create, the entry envelope, the session ritual.
   Counter-failure: cold landings producing ad-hoc or absent record-keeping.
10. **Upstream/sync surface ownership** — `~/.agents/canon/` is kit-owned and
    sync-overwritable; STATE pages, session logs, and logbooks are user-owned
    and never overwritten by the kit. Rule 2's append-only scope is restated
    accordingly: it governs the record, and the kit-owned canon directory
    sits outside it. Counter-failure: stale-protocol drift on wired machines,
    and updaters trampling user record surfaces.
11. **Version markers** — every canon file opens with
    `<!-- banana:canon rev X.Y -->`, giving the doctor and `sync` a
    mechanical staleness check. Counter-failure: undetectable canon drift.
12. **Topic-grain workspaces** — a workspace needing continuity may be a git
    repository or a non-code topic directory; the protocol and the kit's
    `project` command apply to both. Counter-failure: continuity gated on
    version control, leaving non-code work recordless.

v1.3 amends the **project-STATE maintenance discipline** (ADR 0001 in the
kit repo, aligned with `STANDARD.md` v1.3). Nothing else changes.

13. **Rebuild-on-close** — project STATE pages only: mid-arc surgical section
    patches are legal, each ensuring the dirty-marker line
    (`> ⚠ patched since last rebuild — log is authority`) as the final line
    of the header block; the close-time rebuild's judgment-free trigger
    extends to promotion OR standing marker, and the rebuild removes the
    marker. Recovery is lazy: a standing marker obliges nothing at open —
    the log is authority while it stands, and the doctor and `state lint`
    WARN meanwhile. The global page follows item 16 (per-thread edits,
    v1.6). Counter-failure: the per-touch rebuild cost drove silent
    rebuild-skipping — loud staleness (the marker) replaces silent staleness.

v1.4 amends the **ghost surfaces** (ADR 0003 in the kit repo, aligned with
`SESSION-LOG.md` v2.3). Nothing else changes.

14. **Supersession-aware ghosts** — an entry named by a `SUPERSEDES:`
    reference is retired from ghost surfaces (brief, doctor, by-hand scan)
    regardless of its own status line; the superseding entry carries the
    liveness clock and is itself subject to the 48h rule. Motivated by the
    kit's `log` command auto-writing continuation entries: without the
    carve-out, every continuation would manufacture a permanent false
    ghost from its predecessor. Counter-failure: zombie ghost flags on
    corrected history burying the real ones.

v1.5 amends the **global-grain Active-threads freshness stamp** (ADR 0004
§Global grain in the kit repo, aligned with `banana state lint --global`,
#13). Nothing else changes.

15. **Freshness stamp** — every Active-threads bullet carries `(as of
    YYYY-MM-DD)`, the newest source it was rebuilt from (normally its
    project STATE's as-of); a project STATE dated later than the stamp
    means the thread is stale, and `banana state lint --global` FAILs it.
    Counter-failure: a machine-grain page silently drifting behind the
    project pages it projects, undetectable until read by eye.

v1.6 amends the **global-grain maintenance rule** (ADR 0005 in the kit repo).
Nothing else changes.

16. **Per-thread edits** — a session closes by editing only the Active-threads
    bullets and Backlog items it owns or changed, right after a fresh read,
    re-stamping each touched thread's `(as of)` from its source; the page is
    never rewritten whole. Freshness stays enforced by the v1.5 stamp and
    `banana state lint --global`, not by rebuild discipline. Counter-failure: a
    whole-page write from a stale read silently deletes a concurrent session's
    update — the failure whole-page rebuilds could not detect and, once several
    sessions write concurrently, actively cause.

v1.7 amends the **global-grain limits, expiry, and archive** rule (ADR 0006 in
the kit repo); the same pass also extends the "Upstream and sync" carve-out
above to cover the placeholder line `state archive` writes back when a
section empties. Nothing else changes.

17. **Line limits, closed stamp, inactivity, and the archive move** — every
    top-level bullet must be written as one physical line — a bullet with
    even one non-heading, non-rule, non-fence, non-comment continuation
    line has already broken that rule — and carries a per-section
    character limit (`## Active threads` 400 · `## Backlog (owned)` 300 ·
    `## Watch` 350 · `## Recently closed (context for next session)` 250);
    `banana state lint --global` WARNs
    `line-over-limit` on the limit and `bullet-wrapped` on any continuation
    lines at all. A Recently-closed bullet carries `(closed YYYY-MM-DD)`,
    parsed with the same hardened rules as the v1.5 freshness stamp, and
    counts as expired once its stamp trails the page's own reference date —
    the newest valid stamp on the page, never the clock — by eight days or
    more; an Active-threads bullet trailing that same reference date by
    thirty-one days or more becomes a Backlog line instead. Removal from the
    page is never a deletion: any line leaving it — or the long form of a
    line trimmed in place — is first copied verbatim into the append-only
    `~/.agents/STATE-archive.md`, via `banana state archive` (whose five
    reasons are `expired`, `inactive`, `trimmed`, `closed`, `removed`, and
    whose `--reason expired`/`--reason inactive` moves refuse unless the
    real clock has actually passed those same seven/thirty-day thresholds),
    before it is removed; the archive is never loaded at session start,
    searched with `grep` only. A pasted credential, token, or key is deleted
    outright, never archived. Exception to item 16's "edit only your own
    threads": any session may archive an `expired` closed line on sight — no
    judgment is needed to recognize one. Counter-failure: a line removed from
    the global page used to leave no trace at all — unlike every other record
    on this machine (session.log and LOGBOOK.md are append-only with ids,
    project STATE lines cite logbook ids), it simply vanished.
