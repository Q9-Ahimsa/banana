<!-- banana:begin v1 -->
## Continuity protocol (banana)

- **Your agent tag:** `__AGENT_TAG__`. Owner: `__OWNER__`. Write your tag in
  every entry you author — no exceptions.
- **Authority:** `~/.agents/CONTINUITY.md` governs all shared surfaces; the
  files are the source of truth, never any agent's private memory.
- **Global grain:** read `~/.agents/STATE.md` at session start. At close, if
  cross-project state changed, rebuild the page whole — never patch it.
- **Project grain:** conforming repos carry `LOGBOOK.md` (append-only
  chronology) + `STATE.md` (one-page projection) + `.agents/session.log`
  (task journal). Session-log envelope:
  `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`,
  PHASE ∈ discuss · build · refactor · debug · review · ops.
- **Session entry:** compile your brief (`banana brief <feature> --tag
  __AGENT_TAG__`) and read exactly that — nothing else by default. Treat it as
  a snapshot; no mid-session re-reads of shared state.
- **Session close:** land the plane — close your log entry with an owned
  `NEXT: {owner} — {action}`, promote project-worthy events to the logbook,
  rebuild stale projections.
- **Integrity:** append-only everywhere; corrections are new entries with
  `SUPERSEDES:`. Never edit another agent's entries.
<!-- banana:end -->
