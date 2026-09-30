<!-- banana:begin v3 -->
## Continuity bootstrap (banana)

- **Identity:** you are `__AGENT_TAG__`; owner: `__OWNER__`. Sign every entry
  you author with your tag.
- **Protocol authority:** `~/.agents/canon/` — CONTINUITY.md (protocol),
  STANDARD.md (logbook), SESSION-LOG.md (task journal). Every continuity rule
  lives behind this pointer, not in this block; read CONTINUITY.md before your
  first entry on this machine. On conflict, the canon wins.
- **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
  sync · log · state lint). Install once:
  `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
  kit and refreshes this block. Not installed yet? Prefix
  `npx --yes github:Q9-Ahimsa/banana` instead. Kits can drift between
  machines: the brief prints the kit version, and `banana doctor` warns when
  a newer one exists.
- **Self-setup:** landing in a workspace (git repo or non-code topic dir) with
  no continuity files, initialize it yourself per the canon's agent bootstrap
  section: run `banana project` from the workspace root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:` (`banana log close`).
<!-- banana:end -->
