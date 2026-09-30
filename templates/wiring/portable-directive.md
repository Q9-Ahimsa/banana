<!-- banana:begin v3 -->
## Continuity bootstrap (banana)

You are `__AGENT_TAG__`, one of several agents sharing file-based continuity
on this machine. Owner: `__OWNER__`. Sign every entry you author with your
tag.

- **Protocol authority:** `~/.agents/canon/` — read CONTINUITY.md there before
  your first entry; it owns every continuity rule (entry envelopes, session
  ritual, append-only integrity). This block is only a pointer — when it and
  the canon disagree, the canon wins.
- **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
  sync · log · state lint). Install once:
  `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
  kit and refreshes this block. Not installed yet? Prefix
  `npx --yes github:Q9-Ahimsa/banana` instead. Kits can drift between
  machines: the brief prints the kit version, and `banana doctor` warns when
  a newer one exists.
- **Self-setup:** any workspace (git repo or non-code topic dir) lacking
  continuity files is yours to initialize per the canon's agent bootstrap
  section: run `banana project` from the workspace root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:` (`banana log close`).
<!-- banana:end -->
