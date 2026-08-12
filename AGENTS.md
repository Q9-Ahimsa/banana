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

## Agent skills

### Issue tracker

Issues live in GitHub Issues (Q9-Ahimsa/banana) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — the five canonical label strings used as-is. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at repo root + `docs/adr/`. See `docs/agents/domain.md`.

<!-- banana:begin v2 -->
## Continuity bootstrap (banana)

- **Identity:** you are `testagent`; owner: `tester`. Sign every entry
  you author with your tag.
- **Protocol authority:** `~/.agents/canon/` — the harness-neutral continuity
  protocol shared by every agent and human on this machine (CONTINUITY.md,
  STANDARD.md, SESSION-LOG.md). All rules live behind this pointer, never in
  this block; on conflict, the canon wins. Read CONTINUITY.md before your
  first entry.
- **Kit:** `npx --yes github:Q9-Ahimsa/banana <command>` — commands: init ·
  project · brief · doctor · sync. npx always fetches the latest kit.
- **Self-setup:** if this workspace (git repo or non-code topic dir) lacks
  continuity files, initialize it yourself per the canon's agent bootstrap
  section: run `npx --yes github:Q9-Ahimsa/banana project` from the workspace
  root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`npx --yes github:Q9-Ahimsa/banana brief <feature> --tag testagent`);
  end by closing your log entry with an owned `NEXT:`.
<!-- banana:end -->
