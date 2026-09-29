# Spec — `project` / `sync` preserve an existing fence's identity (#16)

Session: cli.12 (claude, 2026-09-29). Ticket: GitHub #16.

## Why

A "fence" is the kit-managed block (`<!-- banana:begin vN -->` … `<!-- banana:end … -->`) that
`project` and `sync` write into harness instruction files (a project's `AGENTS.md`; home
adapters such as the Claude/Codex/Pi instruction files). It carries the identity line
(`**Identity:** you are \`<tag>\`; owner: \`<owner>\`.`). Re-running `project` (and possibly
`sync`) rewrote that block with the kit's default owner/tag, overwriting an identity the owner
had set: after an owner-ruled rename, six project `AGENTS.md` files were left with a stale owner.

## Behavior

1. When `project` or `sync` rewrites or upgrades an EXISTING fence, it reads the agent tag and
   owner from that fence's identity line and writes them into the new block unchanged, while
   still upgrading everything else (fence version, template text).
2. Explicit values the command was given for this run (e.g. a `--tag` / `--owner` flag, if the
   command accepts one) win over preserved values. Find out what inputs exist today; do not add
   new flags unless the code already has an obvious place for them — report what you found.
3. No existing fence → current behavior (defaults / whatever the command does today).
4. An existing fence whose identity line can't be parsed → fall back to current behavior AND print
   one warning line through the injected io naming the file, so identity loss is never silent.
5. Apply the same rule to every code path that writes a fence (single-source the "read identity
   from an existing fence" step — likely in or next to lib/fence.mjs, which AGENTS.md says all
   config-file writes go through).

## Tests (TDD — red first; mutation-check the preservation step)

Sandbox dirs only, injected root/home/io (repo AGENTS.md rules). Synthetic identities only
(e.g. tag `alpha-agent`, owner `beta-owner`) — PUBLIC REPO, no real names or paths.
- `project` re-run on a workspace whose fence has a custom tag/owner: version upgraded, tag and
  owner preserved, rest of the block matches the current template.
- Same for `sync` on a home adapter file and on a project `AGENTS.md`, if sync writes those.
- Fresh workspace: unchanged current behavior.
- Unparseable identity line: fallback + exactly one warning naming the file.
- Explicit override (only if such an input exists): it wins.
- Mutation: disable the preservation step → a preservation test goes red → restore.

## Gates

`npm run check` + `npm test` green (baseline 484). Never run `project` or `sync` against real
directories or the real home — sandbox tests only.

## Out of scope

No canon/template text changes. No edits outside the repo. No session.log writes. No commits.
