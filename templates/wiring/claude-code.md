<!-- banana:begin v2 -->
## Continuity bootstrap (banana)

- **Identity:** you are `__AGENT_TAG__`; owner: `__OWNER__`. Sign every entry
  you author with your tag.
- **Protocol authority:** `~/.agents/canon/` — CONTINUITY.md (protocol),
  STANDARD.md (logbook), SESSION-LOG.md (task journal). Every continuity rule
  lives behind this pointer, not in this block; read CONTINUITY.md before your
  first entry on this machine. On conflict, the canon wins.
- **Kit:** `npx --yes github:Q9-Ahimsa/banana <command>` — commands: init ·
  project · brief · doctor · sync. npx always fetches the latest kit.
- **Self-setup:** landing in a workspace (git repo or non-code topic dir) with
  no continuity files, initialize it yourself per the canon's agent bootstrap
  section: run `npx --yes github:Q9-Ahimsa/banana project` from the workspace
  root.
- **Session ritual:** read `~/.agents/STATE.md` first (machine grain — the
  brief does not carry it), then your brief
  (`npx --yes github:Q9-Ahimsa/banana brief <feature> --tag __AGENT_TAG__`);
  end by closing your log entry with an owned `NEXT:`.
<!-- banana:end -->
