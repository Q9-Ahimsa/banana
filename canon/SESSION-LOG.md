<!-- banana:canon rev 1.2 -->
# Session Log — v2.0 (2026-07-02)
### The fine-grained work journal. One file, every agent, every project.

Session log is the **daybook**: what an agent did, task by task, in a work session — so the next
session, same agent or a different one, can resume without re-deriving context. Lives at
`.agents/session.log` (project root, tool-neutral — Claude Code, Codex CLI, Cursor, or any other
agent reads/writes the same file). It sits below the Logbook Standard's project-level record (§6).

## 1. Envelope

```markdown
## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}
{PREFIX}: one to three lines. Pointers, not payloads.
ref: path/or/url
NEXT: {owner} — {action}
```

- **agent**: mandatory — who's writing (`claude`, `codex`, `cursor`, `human`, ...). Any tool can
  write this file; that's the point of decoupling it from one vendor.
- **feature.n**: id namespace, same shape as the Logbook Standard's `stream.n`.
- **PHASE**: one of `discuss · build · refactor · debug · review · ops`.
- Heading is greppable by construction — old HTML-comment metadata is retired, everything now
  lives in the heading + body prefixes. Counter-failure: metadata inside HTML comments is
  invisible to the plain `grep "^## \["` scans in §4, so resume tooling either grows per-vendor
  comment parsers or silently misses status.

Example:
```markdown
## [2026-07-02] claude auth-redesign.3 | build — JWT refresh flow
APPROACH: Rotate refresh tokens on use; store hash not plaintext.
FILES: src/auth/refresh.ts, src/auth/refresh.test.ts
VALIDATED: npm test — 12/12 pass
STATUS: complete
NEXT: human — review token TTL choice (15m access / 7d refresh)
```

## 2. Prefixes

| Prefix | Meaning |
|---|---|
| `APPROACH:` | plan for this chunk of work, stated before executing |
| `DECISION:` | a choice made, and why (or a pointer to why) |
| `PROBLEM:` | something broke or diverged from expectation |
| `ROOT:` | root cause of a `PROBLEM`, once found |
| `FIX:` | what resolved a `PROBLEM` (references it) |
| `INSIGHT:` | non-obvious thing learned, worth remembering |
| `FILES:` | files touched, comma-separated — no diffs, git already has those |
| `VALIDATED:` | what was run and what it showed (test command + result) |
| `COMMITTED:` | commit hash/message this entry corresponds to |
| `RESEARCH:` | external finding that shaped the work, with pointer |
| `STATUS:` | `in-progress \| complete \| blocked \| abandoned` |
| `NEXT:` | `{owner} — {action}` — always owned, no exceptions |
| `BLOCKED:` | what's blocking, on whom/what |
| `ASSUMED:` | ambiguity bridged by assumption — flagged for confirm |
| `SUPERSEDES:` | corrects a prior entry — never erase |
| `ref:` | pointer to the artifact — path or URL, not the payload |

## 3. Write protocol

1. **Start** — append heading + `APPROACH:` (intent) + `STATUS: in-progress`.
2. **Checkpoint** — append `FILES:` / `VALIDATED:` / `PROBLEM:` / `FIX:` / `INSIGHT:` /
   `DECISION:` lines as work happens — still the same open entry, appended to the bottom of the
   file (not editing above the cursor), so this doesn't break append-only.
   **Concurrency guard:** prefix lines attach to the nearest heading *above* them. Before
   appending checkpoint or close lines, confirm your entry's heading is still the file's last
   heading (`grep "^## \[" .agents/session.log | tail -1`). If another entry has landed below
   yours, do not append bare lines — they would attach to the wrong heading. Open a continuation
   entry instead: same feature, next `n`, first body line
   `SUPERSEDES: {feature}.{n} (continuation — closes the entry left open above)`, then your
   checkpoint/close lines. Counter-failure: close lines orphaned under a stranger's heading, and
   a finished task stranded as a forever-in-progress ghost.
3. **Close** — append final `STATUS:` + `NEXT: {owner} — {action}`. Once closed, immutable.
4. **Correct** — never edit a closed entry. A new entry with `SUPERSEDES: {feature}.{n}` fixes it;
   the original stays.

Read-only during resumption: never re-open or edit a closed entry from a prior session.

## 4. Resume protocol

```
grep -n "{feature}\." .agents/session.log | tail      # locate this feature's entries
grep -n "^## \[" .agents/session.log | tail -5         # most recent entries, any feature
grep -n "STATUS: in-progress" .agents/session.log      # sessions left open
```

The feature grep matches heading lines only — the id lives in the heading; body lines never
repeat it. To read an entry's body, open the file at the matched line number: an entry runs from
its heading to the line before the next `## [` heading. "Bodies included" reads (the entry
ritual's item 4) are exactly this: locate by heading, then read each located entry's span.
For mid-session resume, read the latest located entry's span for its `STATUS:`/`NEXT:`, then
stop. Never read the full file.

These three commands are shared tooling serving two distinct operations at two distinct moments. At
**session entry** (session start), `CONTINUITY.md`'s entry ritual runs them as its allowlist items —
the feature-history grep feeds item 4 (bodies included, capped at the last 10), the recent-headings
grep feeds item 3, and the in-progress scan feeds item 6 (ghost flags). **Mid-session resume** —
permitted only after context loss (e.g. compaction), re-anchoring on a task this session already
holds — uses the first command alone: read the latest entry's `STATUS:`/`NEXT:`, then stop. Distinct
moments, distinct depths; both stop far short of the full file.

## 5. Legacy

`.claude/session.log` (pre-v2 projects) and its `<!-- id:... | phase:... | status:... -->`
metadata comments are honored **read-only** for history. Write new entries to
`.agents/session.log` in the v2 envelope; don't port old entries forward. Counter-failure:
porting rewrites closed history (breaking append-only and attribution), and a dual-format file
defeats the envelope greps in §4.

## 6. Layering contract

| | session.log | LOGBOOK.md |
|---|---|---|
| Grain | task-level: files touched, checkpoints, dead ends | project-level: events worth remembering |
| Grep unit | `{feature}.{n}` | `{stream}.{n}` |
| Read by | the agent resuming this specific task | any human/agent, cold start |

**Promotion rule**: a session that produces a project-level event — `DECISION`, milestone, a
`PROBLEM` with lasting relevance — gets a `LOGBOOK.md` entry too, `ref:` back to the session id.
Lightweight projects run session.log alone; full-standard projects use both.

## 7. Multi-agent

- Append-only across agents, not just within one: never edit another agent's entry.
- `{agent}` field is what makes a shared file safe — every entry attributed, no exceptions.
- Two agents, same feature: increment `n` from the file's actual state (grep it, don't assume) —
  the whole race protection. A collided `n` is a soft error; the next writer just bumps past it.

## 8. Rotation

Active file past ~700 lines → roll closed entries to `.agents/sessions/{YYYY}-{Qn}.log`, keep the
active file lean (same threshold as the Logbook Standard, same reason — oversized files stop
getting read).

---
*Session Log v2.0 · companion to `STANDARD.md` (Logbook Standard v1) — same integrity rules (append-only, supersession, ≤10-line bodies, pointers not payloads), applied at task grain.*
