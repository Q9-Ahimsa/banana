<!-- banana:begin v3 -->
## Continuity bootstrap (banana)

- **Identity:** you are `__AGENT_TAG__`; owner: `__OWNER__`. Sign every entry
  you author with your tag.
- **Protocol authority:** `~/.agents/canon/` — the harness-neutral continuity
  protocol shared by every agent and human on this machine (CONTINUITY.md,
  STANDARD.md, SESSION-LOG.md). All rules live behind this pointer, never in
  this block; on conflict, the canon wins. Read CONTINUITY.md before your
  first entry.
- **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
  sync · log · state lint). Install once:
  `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
  kit and refreshes this block. Not installed yet? Prefix
  `npx --yes github:Q9-Ahimsa/banana` instead. Kits can drift between
  machines: the brief prints the kit version, and `banana doctor` warns when
  a newer one exists.
- **Self-setup:** if this workspace (git repo or non-code topic dir) lacks
  continuity files, initialize it yourself per the canon's agent bootstrap
  section: run `banana project` from the workspace root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:` (`banana log close`).
<!-- banana:end -->
