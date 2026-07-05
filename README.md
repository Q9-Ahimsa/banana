# banana — harness-neutral continuity kit

One command wires a shared continuity protocol — global state, project logbooks, session logs, per-intent briefs — into every AI coding agent on your machine, so any session picks up where the last one left off, whatever the harness.

```sh
npx github:Q9-Ahimsa/banana init
```

`init` detects your installed harnesses, creates `<home>/.agents/CONTINUITY.md` and `<home>/.agents/STATE.md`, and wires each harness's instruction file. Every write is a fenced, version-marked block (`<!-- banana:begin v1 -->` … `<!-- banana:end -->`): re-running is idempotent, and content outside the fence is never touched.

## The four commands

| Command | What it does |
|---|---|
| `banana init` | detect installed agent harnesses, wire the continuity protocol into each. Non-interactive: `--owner`, `--tag`, `--harnesses`, `--yes` |
| `banana project` | initialize a workspace (git repo or non-code topic dir) with `LOGBOOK.md`, `STATE.md`, and `.agents/session.log` |
| `banana brief <feature> --tag <agent>` | compile a per-intent context brief for a session — feature-scoped, deterministic text processing, no LLM calls |
| `banana doctor` | check wiring versions and run liveness audits (ghost entries, unowned NEXT lines, stale STATE, oversized files). `--verify` prints per-harness recital commands |

## What gets written where

### Claude Code

Fenced block into `<home>/.claude/CLAUDE.md`.

### Pi

Fenced block into `<home>/.pi/agent/AGENTS.md`.

### Codex

Fenced block into `<home>/.codex/AGENTS.md`.

### Hermes

Nothing on disk. Hermes is a memory-bearing agent, so the protocol is delivered *through* the agent: the adapter composes a one-shot directive and its command (`hermes -z …`), and only executes it behind an explicit `--deliver` flag. Its file tree is never written.

### Everything else: manual paste

For tools banana doesn't wire (Cursor, etc.), `banana init` prints paste instructions — copy the same fenced block into that tool's instruction file yourself. The fence markers survive, so `banana doctor` still audits it.

## Hot/cold + briefs, in one minute

Continuity files are tiered. **Hot** = auto-loaded every session: one-page projections only (global STATE, project STATE), facts only. **Cold** = chronology and entry bodies (`LOGBOOK.md`, `session.log`): never auto-loaded, grep-on-demand only. A session starting work doesn't read the shared files at all — it runs `banana brief <feature>` and gets a compiled snapshot: the target feature's full log entries, headings-only awareness of other in-flight work, NEXT lines it owns, and the project STATE verbatim, each section carrying a `ref:` line back to its source. Relevance filtering happens *before* context load, not after.
