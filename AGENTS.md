# AGENTS.md — banana (operational)

- Runtime: Node >= 18, ESM (`.mjs`), zero runtime dependencies. CLI entry: `bin/banana.mjs`.
- Quality gates: `npm run check && npm test` (tsc --checkJs typecheck + node --test, which discovers `test/*.test.mjs`).
- Run a single test file: `node --test test/<name>.test.mjs`.
- Authoritative specs: `.agents/goal/packet.md` (done-whens) and `docs/DESIGN.md` (behavioral
  contracts: brief include/exclude table, doctor audits, adapter + fence contracts, constants).
- Patterns: lib/ modules take injectable root paths (never read the real HOME inside logic);
  adapters expose detect/describe + wire or compose; ALL config-file writes go through
  lib/fence.mjs; tests use sandbox temp dirs only (node:fs mkdtempSync + os.tmpdir).
- tsconfig include list covers bin/, lib/, adapters/, test/ — new source dirs must be added there
  or `npm run check` silently skips them.
