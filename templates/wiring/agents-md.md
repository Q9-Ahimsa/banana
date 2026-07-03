<!-- banana:begin v1 -->
## Continuity protocol (banana)

- **Your agent tag:** `__AGENT_TAG__`. Owner: `__OWNER__`. Attribute every
  entry you author with your tag — no exceptions.
- **Authority:** `~/.agents/CONTINUITY.md` — file-based, harness-neutral
  coordination shared by all agents and humans on this machine. Shared files
  are the sole authority for coordination state; on conflict, files win.
- **Global grain:** read `~/.agents/STATE.md` at session start; rebuild it
  whole (never patch) at close if cross-project state changed.
- **Project grain:** conforming repos carry `LOGBOOK.md` (append-only) +
  `STATE.md` (one-page projection) + `.agents/session.log` (task journal,
  envelope `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`,
  PHASE ∈ discuss · build · refactor · debug · review · ops).
- **Working rules:** open log entries with `APPROACH:` + `STATUS:
  in-progress`; close with final `STATUS:` + owned `NEXT: {owner} — {action}`.
  Resume via `grep "{feature}\." .agents/session.log | tail` — never read the
  whole file.
- **Integrity:** append-only everywhere; corrections are new entries with
  `SUPERSEDES:`. Never edit another agent's entries.
<!-- banana:end -->
