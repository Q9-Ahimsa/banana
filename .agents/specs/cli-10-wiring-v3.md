# Spec — #10: wiring v3 (the bootstrap blocks teach install-once + sync-to-update)

Session entry: `.agents/session.log` cli.17 · Ticket: GitHub #10 · Decision: ADR 0002.
Starts only after #6 is merged: the text must never promise update behavior that isn't real.

## Ticket acceptance (verbatim, the contract)

- All three wiring templates bumped v2 → v3: the npx-always-fresh promise is gone;
  install-once + sync-to-update + skew-surfaced is in; the command roster includes `log` and
  `state lint`
- Doctor's stale-fence audit flags wired v2 blocks; sync re-applies v3 preserving the rendered
  owner/tag
- Fence idempotency holds: a second sync run is byte-identical
- Template content tests assert the new text present and the retired promise absent across all
  three templates
- Quality gates green: typecheck + full test suite

## The text

In each of `templates/wiring/claude-code.md`, `agents-md.md` and `portable-directive.md`:
- The fence opener becomes `<!-- banana:begin v3 -->`.
- The **Kit** bullet is replaced with exactly this (keep each template's existing bullet style):

      - **Kit:** `banana <command>` (commands: init · project · brief · doctor ·
        sync · log · state lint). Install once:
        `npm install -g github:Q9-Ahimsa/banana`; then `banana sync` updates the
        kit and refreshes this block. Not installed yet? Prefix
        `npx --yes github:Q9-Ahimsa/banana` instead. Kits can drift between
        machines: the brief prints the kit version, and `banana doctor` warns when
        a newer one exists.

- The **Self-setup** bullet's command becomes `banana project`. The rest of its wording is
  unchanged.
- The **Session ritual** bullet's brief command becomes `banana brief <feature> --tag __AGENT_TAG__`,
  and its ending becomes "end by closing your log entry with an owned `NEXT:` (`banana log close`)."
- Every other line stays byte-identical: identity, protocol authority, placeholders.

The npx fallback is deliberate. A harness on a machine without the global install still has a
working command, and the text never claims npx is always fresh.

## Behavior to prove (red-first)

1. Template content, for each of the 3 templates:
   - the v3 opener is present;
   - `npm install -g github:Q9-Ahimsa/banana`, `banana sync`, `log` and `state lint` all appear in
     the Kit bullet;
   - the retired promise `npx always fetches the latest kit` is absent.
2. Doctor's stale-fence audit flags a sandbox home whose harness file carries a v2 block.
3. Sync upgrades that v2 block to v3 and preserves its rendered owner and tag, for a non-default
   pair such as `alpha`/`owner-x`. Every byte outside the fence is unchanged.
4. A second sync run leaves every wired file byte-identical (hash), and prints the no-changes line.
5. Update every existing test that asserts v2 text or the old promise, and say which ones you
   changed.

Find every consumer of the templates first, including the Hermes compose path:
`grep -rn "renderWiringTemplate\|wiringTemplateVersion\|templates/wiring" lib adapters bin test`.
Each consumer must render v3 correctly.

Mutation check: put the old Kit line back in one template, and test 1 fails for that template
only.

## Out of scope

Running `sync` on the owner machine (#11), canon files, README (#6 already rewrote the install
section), and package.json `version`.

## Gates

`npm run check`, `npm test` (run through `rtk proxy npm test` so counts show). Synthetic fixtures
only (public repo).
