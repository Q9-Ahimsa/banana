# banana — harness-neutral continuity kit

Install once:

```sh
npm install -g github:Q9-Ahimsa/banana
```

Then run any command with no network: `banana init`, `banana project`,
`banana log`, … `init` wires a small bootstrap block into every AI coding
agent on your machine (Claude Code, Pi, Codex, Hermes — plus a paste block
for anything else). The block points each agent at a shared continuity
canon; from then on your agents initialize their own workspaces, keep the
logs, compile their own context briefs, and pick up where the last session
left off — whatever the harness.

When the protocol changes upstream, one command propagates it everywhere:

```sh
banana sync
```

`sync` runs the kit's own update step, then refreshes the kit-owned canon at
`~/.agents/canon/` and re-applies any stale wiring block in a home instruction
file (`banana project` refreshes a project's `AGENTS.md`). Your own files —
`STATE.md`, session logs, logbooks — are never touched. Offline or npm
unreachable? Sync warns and still refreshes canon/fences from whatever kit you
have installed.

No shim installed yet? The cold-bootstrap path still works, just slower —
`npx --yes github:Q9-Ahimsa/banana init` fetches the kit fresh every call.

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
  created if missing, their content never rewritten by the kit. The one
  exception is `banana state archive`, which moves one named line off the
  global `STATE.md` into `STATE-archive.md` (`--reason trimmed` only copies
  it) — see "Archiving a global STATE line" below.

### Bootstrap model

Wiring blocks are thin and stable; every rule lives behind the canon pointer,
so upstream updates propagate via `sync` instead of re-wiring. Landing in a
workspace (git repo or non-code topic dir) that lacks continuity files, set
it up yourself: read the canon's agent bootstrap section, then run
`banana project` from the workspace root.

### Commands

Canonical invocation, once installed: `banana <command>`, no network. Cold
bootstrap, before the shim exists on this machine: `npx --yes
github:Q9-Ahimsa/banana <command>` — slower (fetches the kit fresh every
call), but works with nothing installed. Either way, `sync` and `doctor`
are the only commands that reach the network themselves (`init --deliver`
hands a directive to the Hermes agent, which makes its own calls): `sync` to
run its own kit-update step, `doctor` for one best-effort remote-version check.
Offline, `sync` warns and carries on, and `doctor` skips its check silently.

| Command | What it does |
|---|---|
| `banana init` | detect installed harnesses, install the canon into `~/.agents/canon/`, wire the bootstrap block into each instruction file. Non-interactive: `--owner`, `--tag`, `--harnesses`, `--yes`. `--deliver` also runs the Hermes one-shot delivery command instead of only printing it |
| `banana project` | initialize the current workspace (git repo or non-code topic dir) with `LOGBOOK.md`, `STATE.md`, `.agents/session.log`, and a wired `AGENTS.md` continuity block. Non-interactive: `--owner`, `--tag`, `--yes` |
| `banana brief [feature] --tag <agent>` | compile a per-intent context brief — feature-scoped, deterministic, no LLM calls. No feature arg lists the active slugs |
| `banana doctor` | audit wiring versions, canon staleness, and log liveness; each stale-canon / stale-fence finding names its fix — `banana sync` for the canon and home instruction files, `banana init --harnesses <id>` for a home file whose block has no identity line (sync skips it), `banana project` for a project's `AGENTS.md`. Also a best-effort remote-version check (silent offline). `--verify` prints per-harness recital commands |
| `banana sync` | run the kit's own update step (best-effort; warns and carries on offline), then refresh the kit-owned canon and re-apply any wiring fence older than current; a line-ending difference alone is never a change |
| `banana log stub\|append\|close\|supersede` | stamp session-log entries — the envelope (heading, STATUS/NEXT composition, concurrency-guard continuation) is computed, never hand-typed. `banana log <verb> --help` for usage |
| `banana state lint\|archive` | `lint [--global]`: check a `STATE.md` page against the canon's mechanical invariants — `./STATE.md`, or `~/.agents/STATE.md` with `--global`; verdicts FAIL / WARN / PASS, never reads the clock. `archive --global --match <text> --reason <reason> --tag <agent> [--dry-run]`: move one line off the global page into `~/.agents/STATE-archive.md` (see "Archiving a global STATE line" below). `banana state <verb> --help` for usage |

`banana version` prints the installed kit version. Under npx, use that bare
word: npm keeps `--version` and `-v` for itself, so they never reach banana.

Every write into an agent's instruction file is a fenced, version-marked
block (`<!-- banana:begin v4 -->` … `<!-- banana:end -->`): re-running is
idempotent, and content outside the fence is never touched. Owner and tag
are recovered from the existing block on re-fence, so `sync` needs no flags.
A block with no identity line is skipped (`sync` never invents one);
`banana doctor` then names `banana init --harnesses <id>`.

### Archiving a global STATE line

`banana state archive` moves one top-level bullet off `~/.agents/STATE.md`.
It copies the line verbatim into the append-only `~/.agents/STATE-archive.md`
first, then removes it from the page. If that empties the line's section,
the command writes back that section's own placeholder line. `--dry-run`
prints the record and the action and writes nothing.

- `--global` is required. Project pages keep their history in `LOGBOOK.md`
  instead.
- `--match <text>` is a case-sensitive substring of the bullet's own line.
  It must pick exactly one bullet; byte-identical duplicates archive the
  first. A bullet wrapped onto a second line is refused: join it into one
  line first.
- `--tag <agent>` names the agent recording the move.
- `--reason <reason>` is one of six:
  - `expired`: a Recently-closed line whose `(closed YYYY-MM-DD)` stamp is
    more than 7 days before today.
  - `inactive`: an Active-threads line whose `(as of YYYY-MM-DD)` stamp is
    more than 14 days before today. Refused if the thread's project page is
    newer than the stamp; that thread's own session refreshes the stamp
    instead.
  - `dormant`: a Backlog (owned) line whose `(queued YYYY-MM-DD)` stamp is
    more than 21 days before today.
  - `closed`: a finished Active-threads line. Afterwards, add its one-line
    Recently-closed entry by hand; the command prints a reminder.
  - `trimmed`: copy only. The page is left as it is; shorten the line in
    place by hand.
  - `removed`: anything else the owner drops.

`trimmed` and `removed` work in any of the four sections; every other
reason refuses a line outside its own section. `expired`, `inactive` and
`dormant` also read the clock: they refuse (exit 2) while the matched line's
own stamp is not yet past its limit, or is dated after today. A line with
no stamp at all needs `--reason removed`.

A pasted secret (a credential, token or key) is never archived, not even as
a copy: delete it from the page by hand.
