// Shared owner resolution for init and project: --owner flag, then git config
// user.name, then an interactive prompt — prompting only on a TTY and never
// under --yes. Non-interactive with nothing inferable reports the exact
// non-interactive invocation and resolves to null so the caller can exit 1.
// TTY state and the git lookup are injectable — tests never touch the real
// terminal or shell out to git.

/**
 * @typedef {object} OwnerIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err] defaults to out
 * @property {(question: string) => Promise<string>} prompt
 */

/**
 * The exact non-interactive invocation printed when no owner can be inferred.
 * @param {string} command subcommand name ('init', 'project')
 * @returns {string}
 */
export function nonInteractiveInvocation(command) {
  return `npx --yes github:Q9-Ahimsa/banana ${command} --owner "<name>" --yes`;
}

/**
 * Resolve the owner name for a command.
 * @param {string} command subcommand name used in messages ('init', 'project')
 * @param {{ owner: string | null, yes: boolean }} flags
 * @param {{ io: OwnerIo, isTTY?: boolean, gitUserName?: () => (string | null) }} deps
 * @returns {Promise<string | null>} the owner, or null after reporting the failure
 */
export async function resolveOwner(command, flags, deps) {
  const { io } = deps;
  const out = io.out;
  const err = io.err ?? io.out;

  // Prompting is allowed only on a TTY and never under --yes; everywhere else
  // the command accepts inference or fails fast — it must never hang headless.
  const interactive = deps.isTTY === true && !flags.yes;

  let owner = flags.owner;
  if (!owner) {
    const inferred = deps.gitUserName?.()?.trim();
    if (inferred) {
      owner = inferred;
      out(`Owner: ${owner} (from git config user.name)`);
    }
  }
  if (!owner) {
    if (!interactive) {
      err(`banana ${command}: no owner — pass --owner (with --yes for non-interactive runs), or set git config user.name`);
      err(`banana ${command}: non-interactive invocation: ${nonInteractiveInvocation(command)}`);
      return null;
    }
    owner = (await io.prompt('Owner name (attribution in continuity files): ')).trim();
    if (!owner) {
      err(`banana ${command}: an owner name is required`);
      return null;
    }
  }
  return owner;
}
