# Session log — task-grain work journal (Session Log v2)
> Shared by every agent that touches this repo. Append-only — never edit or
> delete a past entry; corrections are new entries with `SUPERSEDES:`.
> Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`,
> PHASE ∈ discuss · build · refactor · debug · review · ops.
> Open with `APPROACH:` + `STATUS: in-progress`; checkpoint with `FILES:` /
> `VALIDATED:` / `PROBLEM:` / `FIX:`; close with final `STATUS:` +
> `NEXT: {owner} — {action}` (always owned).
> Resume: `grep "{feature}\." .agents/session.log | tail` — never read the
> whole file. Full spec: `SESSION-LOG.md`, shipped with this kit.
