# STATE is rebuilt on close, not on every touch

The canon originally required STATE.md to be rebuilt whole on every touch — the
single biggest continuity cost in live use (~1.5–2k tokens per touch, several per
session), and in practice it drove agents to skip rebuilds silently. Decided
(2026-08-11, ratified by Ahimsa): surgical section patches are allowed mid-arc;
every patch ensures a dirty-marker line (`> ⚠ patched since last rebuild — log is
authority`); one mandatory full rebuild at session close removes it. Recovery is
lazy: a standing marker obliges nothing at open — the log is authority while it
stands and the opener's own close clears it; doctor and state-lint WARN meanwhile.

## Consequences

- Mid-arc STATE is eventually consistent: a reader may see a patched section beside
  a stale one and must treat the log as authority — the marker says exactly that.
- A crashed or skipped close is self-announcing: the marker survives it.

## Considered options

- **Keep rebuild-whole** — rejected: the cost made agents skip rebuilds with no
  trace; silent staleness is worse than loud staleness.
- **Rebuild-on-handoff hybrid** (force rebuild before a NEXT naming a different
  owner) — rejected: one more rule agents will get wrong.
- **Repair-on-open** (standing marker forces immediate rebuild) — rejected:
  re-adds a session-start tax exactly where cost is being cut, and duplicates the
  rebuild the close performs anyway.
