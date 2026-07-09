// project command: initialize a workspace for continuity — a git repo or a
// non-code topic dir (topic-grain: non-git proceeds with a note). Creates
// LOGBOOK.md, STATE.md, and the .agents/session.log seed from templates, and
// wires the fenced continuity block into the workspace's AGENTS.md. Owner
// resolution shares init's inference order and non-TTY fail-fast. Workspace
// root, IO, TTY state, and the git-config lookup are injectable — tests run
// against temp dirs, never the real cwd.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyFence } from './fence.mjs';
import { resolveOwner } from './owner.mjs';
import { renderWiringTemplate } from './wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} ProjectFlags
 * @property {string | null} owner attribution name for continuity files
 * @property {string | null} tag agent tag written into the AGENTS.md wiring block
 * @property {boolean} yes non-interactive: never prompt
 */

/**
 * @typedef {object} ProjectResult
 * @property {number} code process exit code
 * @property {string[]} created absolute paths of files created this run
 * @property {{ target: string, created: boolean, changed: boolean } | null} wired
 *   AGENTS.md fence outcome
 */

/**
 * Parse the argv slice after the `project` subcommand.
 * @param {string[]} argv
 * @returns {ProjectFlags}
 * @throws on unknown options or missing values
 */
export function parseProjectArgs(argv) {
  /** @type {ProjectFlags} */
  const flags = { owner: null, tag: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === '--owner') flags.owner = value();
    else if (arg === '--tag') flags.tag = value();
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else throw new Error(`unknown project option '${arg}'`);
  }
  return flags;
}

/**
 * Create a continuity file if missing. Existing files are the project's
 * living record — project never overwrites them.
 * @param {string} target
 * @param {string} content
 * @returns {boolean} whether the file was created
 */
function createIfMissing(target, content) {
  if (existsSync(target)) return false;
  writeFileSync(target, content);
  return true;
}

/**
 * @param {string} name file name under templates/
 * @returns {string}
 */
function template(name) {
  return readFileSync(join(KIT_ROOT, 'templates', name), 'utf8');
}

/**
 * Run the project command.
 * @param {ProjectFlags} flags
 * @param {{ cwd: string, io: import('./init.mjs').InitIo,
 *           isTTY?: boolean, gitUserName?: () => (string | null) }} deps
 * @returns {Promise<ProjectResult>}
 */
export async function runProject(flags, deps) {
  const { cwd, io } = deps;
  const out = io.out;
  const err = io.err ?? io.out;
  /** @type {ProjectResult} */
  const failed = { code: 1, created: [], wired: null };

  try {
    // Topic-grain: a workspace may be a non-code topic dir. `.git` may be a dir
    // (normal checkout) or a file (worktree/submodule) — existsSync covers both;
    // its absence is a note, never a refusal.
    if (!existsSync(join(cwd, '.git'))) {
      out(`banana project: ${cwd} is not version controlled — initializing it as a topic workspace`);
    }

    // Owner inference shared with init: flag, git config, TTY-gated prompt.
    const owner = await resolveOwner('project', flags, deps);
    if (owner === null) return failed;

    /** @type {string[]} */
    const created = [];

    // The project name is the workspace directory's basename — the canon's
    // deterministic rule, shared with by-hand bootstraps.
    const projectName = basename(cwd);

    const logbookTarget = join(cwd, 'LOGBOOK.md');
    const logbook = template('LOGBOOK-header.md').replaceAll('(project)', projectName);
    if (createIfMissing(logbookTarget, logbook)) created.push(logbookTarget);

    const stateTarget = join(cwd, 'STATE.md');
    const state = template('project-STATE.md')
      .replaceAll('(project)', projectName)
      .replaceAll('__OWNER__', owner);
    if (createIfMissing(stateTarget, state)) created.push(stateTarget);

    const agentsDir = join(cwd, '.agents');
    mkdirSync(agentsDir, { recursive: true });
    const seedTarget = join(agentsDir, 'session.log');
    if (createIfMissing(seedTarget, template('session-log-seed.md'))) created.push(seedTarget);

    for (const target of created) out(`created ${target}`);

    // Repo-local AGENTS.md wiring block — written through the fence engine so
    // re-runs are idempotent and user content around the block is preserved.
    const block = renderWiringTemplate('agents-md.md', { owner, tag: flags.tag ?? '<agent-tag>' });
    const agentsTarget = join(cwd, 'AGENTS.md');
    const fence = applyFence(agentsTarget, block);
    const wired = { target: agentsTarget, created: fence.created, changed: fence.changed };
    out(`wired AGENTS.md -> ${agentsTarget}${fence.changed ? '' : ' (already current)'}`);

    return { code: 0, created, wired };
  } catch (error) {
    err(`banana project: ${error instanceof Error ? error.message : error}`);
    return failed;
  }
}
