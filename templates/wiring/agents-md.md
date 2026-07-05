<!-- banana:begin v2 -->
## Continuity bootstrap (banana)

- **Identity:** you are `__AGENT_TAG__`; owner: `__OWNER__`. Sign every entry
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
  (`npx --yes github:Q9-Ahimsa/banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:`.
<!-- banana:end -->
