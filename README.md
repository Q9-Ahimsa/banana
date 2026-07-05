# banana — harness-neutral continuity kit

One command, run once:

```sh
npx --yes github:Q9-Ahimsa/banana init
```

Your agents handle the rest. `init` wires a small bootstrap block into every
AI coding agent on your machine (Claude Code, Pi, Codex, Hermes — plus a paste
block for anything else). The block points each agent at a shared continuity
canon; from then on your agents initialize their own workspaces, keep the
logs, compile their own context briefs, and pick up where the last session
left off — whatever the harness.

When the protocol changes upstream, one command propagates it everywhere:

```sh
npx --yes github:Q9-Ahimsa/banana sync
```

`sync` refreshes the kit-owned canon at `~/.agents/canon/` and re-applies any
stale wiring blocks. Your own files — `STATE.md`, session logs, logbooks —
are never touched.

That is the whole human surface. Everything below is addressed to agents.

## Agents: start here

The fenced `banana:begin` block in your instruction file is a pointer, not
the protocol. The protocol — entry envelopes, session ritual, file ownership,
hot/cold context tiers — lives in the canon:

- **Canon (protocol authority):** `~/.agents/canon/` — `CONTINUITY.md`
  (protocol), `STANDARD.md` (logbook standard), `SESSION-LOG.md` (task
  journal). Kit-owned: `sync` may overwrite it freely. On conflict, the
  canon wins.
- **User-owned surfaces:** `~/.agents/STATE.md`, session logs, logbooks —
  created if missing, never overwritten by the kit.

### Bootstrap model

Wiring blocks are thin and stable; every rule lives behind the canon pointer,
so upstream updates propagate via `sync` instead of re-wiring. Landing in a
workspace (git repo or non-code topic dir) that lacks continuity files, set
it up yourself: read the canon's agent bootstrap section, then run
`banana project` from the workspace root.

### The five commands

Canonical invocation: `npx --yes github:Q9-Ahimsa/banana <command>` — npx
always fetches the latest kit, so no update mechanism ships in it.

| Command | What it does |
|---|---|
| `banana init` | detect installed harnesses, install the canon into `~/.agents/canon/`, wire the bootstrap block into each instruction file. Non-interactive: `--owner`, `--tag`, `--harnesses`, `--yes` |
| `banana project` | initialize the current workspace (git repo or non-code topic dir) with `LOGBOOK.md`, `STATE.md`, and `.agents/session.log` |
| `banana brief <feature> --tag <agent>` | compile a per-intent context brief — feature-scoped, deterministic, no LLM calls. No feature arg lists the active slugs |
| `banana doctor` | audit wiring versions, canon staleness, and log liveness; stale findings name `sync` as the remediation. `--verify` prints per-harness recital commands |
| `banana sync` | refresh the kit-owned canon and re-apply any wiring fence older than current |

Every write is a fenced, version-marked block (`<!-- banana:begin v2 -->` …
`<!-- banana:end -->`): re-running is idempotent, and content outside the
fence is never touched. Owner and tag are recovered from the existing block
on re-fence, so `sync` needs no flags.
