<!-- banana:begin v1 -->
## Session Log

Log every work session, append-only, in `.agents/session.log` at the project
root — one entry per unit of work, shared by every agent that touches this
project. Your agent tag is `__AGENT_TAG__`; write it in every entry you author.

Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`, then a
few `PREFIX:` lines, then `ref:` and `NEXT: {owner} — {action}`. `agent` is
mandatory. `PHASE` is one of `discuss · build · refactor · debug · review · ops`.

Example:
```
## [2026-07-02] __AGENT_TAG__ auth-redesign.3 | build — JWT refresh flow
APPROACH: Rotate refresh tokens on use; store hash not plaintext.
FILES: src/auth/refresh.ts
VALIDATED: npm test — 12/12 pass
STATUS: complete
NEXT: __OWNER__ — review token TTL choice
```

Prefixes: `APPROACH` / `DECISION` / `PROBLEM` / `ROOT` / `FIX` / `INSIGHT` /
`FILES` / `VALIDATED` / `COMMITTED` / `RESEARCH` / `STATUS`
(`in-progress|complete|blocked|abandoned`) / `NEXT` (always owned) /
`BLOCKED` / `ASSUMED` / `SUPERSEDES` / `ref`.

Write protocol:
1. Start — append a heading + `APPROACH:` + `STATUS: in-progress`.
2. Checkpoint — append `FILES:` / `VALIDATED:` / `PROBLEM:` / `FIX:` /
   `INSIGHT:` lines to the same open entry as work happens.
3. Close — append final `STATUS:` + `NEXT: {owner} — {action}`.

Resume protocol:
1. Run `grep "{feature}\." .agents/session.log | tail`.
2. Read that entry's latest `STATUS:`/`NEXT:`. Never read the whole file.

Append-only, always: never edit or delete a past entry. Corrections are new
entries carrying `SUPERSEDES: {feature}.{n}`; the original stays.
<!-- banana:end -->
