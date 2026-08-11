# The kit installs locally; sync is the explicit updater

`npx github:Q9-Ahimsa/banana` refetched the kit on every call — multi-second
latency per command and offline-hostile, which pushed agents back to manual inline
work and defeated the kit's purpose. Decided (2026-08-11, ratified by Ahimsa):
banana installs once as a local shim on PATH; `banana sync` becomes the explicit
updater. Version skew across machines is **accepted and surfaced, never silently
prevented**: every brief prints the kit version, and doctor makes a best-effort
remote check that warns when origin is ahead — silent when offline, never blocking.

## Consequences

- The bootstrap promise "npx always fetches the latest kit" is retired; the
  installed CLAUDE.md bootstrap block text must be amended to match.
- Envelope stamping can skew between machines that haven't synced — the surfacing
  mitigations (version in brief, doctor warning) exist precisely for this window.

## Considered options

- **Mandatory sync at session start** — rejected: reintroduces a per-session
  network dependency and fails ugly offline; rebuilds the latency tax the shim
  exists to kill. Sync-at-start remains a recommendation, not a gate.
- **Keep npx per-call** — rejected: guaranteed freshness, but the per-command
  wait was the original complaint.
