// init command: detect installed harnesses, install the kit-owned canon into
// <home>/.agents/canon/, create <home>/.agents/STATE.md if missing, and wire
// each selected harness through its adapter. Home root, env, IO, TTY state,
// and the git-config owner lookup are all injectable — tests run against
// sandbox homes with scripted prompts, never the real HOME.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect } from './detect.mjs';
import { renderWiringTemplate } from './wiring.mjs';
import claudeCode from '../adapters/claude-code.mjs';
import pi from '../adapters/pi.mjs';
import codex from '../adapters/codex.mjs';
import hermes from '../adapters/hermes.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Kit-owned canon files installed into <home>/.agents/canon/. */
export const CANON_FILES = ['CONTINUITY.md', 'STANDARD.md', 'SESSION-LOG.md'];

/** The exact non-interactive invocation printed when no owner can be inferred. */
const NON_INTERACTIVE_INVOCATION = 'npx --yes github:Q9-Ahimsa/banana init --owner "<name>" --yes';

export const FILE_ADAPTERS = [claudeCode, pi, codex];
export const WRITE_THROUGH_ADAPTERS = [hermes];
const KNOWN_IDS = [...FILE_ADAPTERS, ...WRITE_THROUGH_ADAPTERS].map((a) => a.id);

/**
 * @typedef {object} InitFlags
 * @property {string | null} owner attribution name for continuity files
 * @property {string | null} tag agent-tag override passed to every adapter
 * @property {string[] | null} harnesses explicit harness ids; null = use detection
 * @property {boolean} yes non-interactive: accept detection and the write plan
 * @property {boolean} deliver actually run the hermes one-shot delivery command
 */

/**
 * @typedef {object} InitIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err] defaults to out
 * @property {(question: string) => Promise<string>} prompt
 */

/**
 * @typedef {object} InitResult
 * @property {number} code process exit code
 * @property {string[]} selected harness ids that were wired
 * @property {string[]} created absolute paths of global files created this run
 * @property {{ id: string, target: string, created: boolean, changed: boolean }[]} wired
 * @property {{ delivered: boolean, command: string } | null} hermes
 */

/**
 * Parse the argv slice after the `init` subcommand.
 * @param {string[]} argv
 * @returns {InitFlags}
 * @throws on unknown options or missing values
 */
export function parseInitArgs(argv) {
  /** @type {InitFlags} */
  const flags = { owner: null, tag: null, harnesses: null, yes: false, deliver: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === '--owner') flags.owner = value();
    else if (arg === '--tag') flags.tag = value();
    else if (arg === '--harnesses') {
      flags.harnesses = value().split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--deliver') flags.deliver = true;
    else throw new Error(`unknown init option '${arg}'`);
  }
  return flags;
}

/**
 * @param {string[] | null | undefined} ids
 * @returns {string | null} the first unknown harness id, if any
 */
function firstUnknown(ids) {
  return ids?.find((id) => !KNOWN_IDS.includes(id)) ?? null;
}

/**
 * Create a global continuity file if missing. Existing files are the user's
 * living record — init never overwrites them.
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
 * Run the init command.
 * @param {InitFlags} flags
 * @param {{ home: string, env?: { PATH?: string, PATHEXT?: string }, io: InitIo,
 *           isTTY?: boolean, gitUserName?: () => (string | null),
 *           run?: (command: string) => unknown }} deps
 * @returns {Promise<InitResult>}
 */
export async function runInit(flags, deps) {
  const { home, env, io } = deps;
  const out = io.out;
  const err = io.err ?? io.out;
  /** @type {InitResult} */
  const failed = { code: 1, selected: [], created: [], wired: [], hermes: null };

  // Prompting is allowed only on a TTY and never under --yes; everywhere else
  // init accepts defaults or fails fast — it must never hang headless.
  const interactive = deps.isTTY === true && !flags.yes;

  // Owner inference order: --owner flag, then git config user.name, then an
  // interactive prompt. Non-interactive with nothing inferable exits 1.
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
      err('banana init: no owner — pass --owner (with --yes for non-interactive runs), or set git config user.name');
      err(`banana init: non-interactive invocation: ${NON_INTERACTIVE_INVOCATION}`);
      return failed;
    }
    owner = (await io.prompt('Owner name (attribution in continuity files): ')).trim();
    if (!owner) {
      err('banana init: an owner name is required');
      return failed;
    }
  }

  const detection = detect(home, env ? { env } : {});
  const detected = detection.harnesses.filter((h) => h.detected).map((h) => h.id);
  out(`Detected harnesses: ${detected.length > 0 ? detected.join(', ') : 'none'}`);

  // Selection: explicit flag, or accept detection (prompt 2 of 3 when interactive).
  /** @type {string[]} */
  let selected;
  if (flags.harnesses !== null) {
    selected = flags.harnesses;
  } else if (!interactive) {
    selected = detected;
  } else {
    const answer = await io.prompt(
      `Harnesses to wire [${detected.join(', ') || 'none'}] (enter to accept, or comma-separated ids): `,
    );
    selected = answer.trim() === ''
      ? detected
      : answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const unknown = firstUnknown(selected);
  if (unknown !== null) {
    err(`banana init: unknown harness '${unknown}' (expected ${KNOWN_IDS.join('|')})`);
    return failed;
  }

  // Write plan (prompt 3 of 3 when interactive).
  const agentsDir = join(home, '.agents');
  const canonDir = join(agentsDir, 'canon');
  out('');
  out('Write plan:');
  out(`  canon   ${canonDir} (kit-owned; created or refreshed to the bundled canon)`);
  out(`  global  ${join(agentsDir, 'STATE.md')} (one-page projection; kept if present)`);
  for (const adapter of FILE_ADAPTERS) {
    if (!selected.includes(adapter.id)) continue;
    out(`  wire    ${adapter.id} -> ${join(home, adapter.describe().target)}`);
  }
  if (selected.includes(hermes.id)) {
    out(`  hermes  write-through directive (${flags.deliver ? 'deliver now' : 'print command only'})`);
  }
  if (interactive) {
    const confirm = (await io.prompt('Proceed? [y/N] ')).trim();
    if (!/^y(es)?$/i.test(confirm)) {
      out('banana init: aborted, nothing written');
      return failed;
    }
  }

  // Kit-owned canon dir: created or refreshed to the bundled canon. User-owned
  // surfaces (STATE.md, logs, logbooks) are never overwritten.
  mkdirSync(canonDir, { recursive: true });
  /** @type {string[]} */
  const created = [];
  for (const name of CANON_FILES) {
    const target = join(canonDir, name);
    const bundled = readFileSync(join(KIT_ROOT, 'canon', name), 'utf8');
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing === bundled) continue;
    writeFileSync(target, bundled);
    if (existing === null) created.push(target);
    else out(`refreshed ${target}`);
  }
  const stateTarget = join(agentsDir, 'STATE.md');
  const state = readFileSync(join(KIT_ROOT, 'templates', 'global-STATE.md'), 'utf8')
    .replaceAll('__OWNER__', owner);
  if (createIfMissing(stateTarget, state)) created.push(stateTarget);
  for (const target of created) out(`created ${target}`);

  // File adapters.
  /** @type {InitResult['wired']} */
  const wired = [];
  for (const adapter of FILE_ADAPTERS) {
    if (!selected.includes(adapter.id)) continue;
    const result = adapter.wire(home, { owner, ...(flags.tag ? { tag: flags.tag } : {}) });
    wired.push({ id: adapter.id, target: result.target, created: result.created, changed: result.changed });
    out(`wired ${adapter.id} -> ${result.target}${result.changed ? '' : ' (already current)'}`);
  }

  // Hermes write-through: compose always, execute only behind --deliver.
  /** @type {InitResult['hermes']} */
  let hermesResult = null;
  if (selected.includes(hermes.id)) {
    const composed = hermes.compose({ owner, ...(flags.tag ? { tag: flags.tag } : {}) });
    const outcome = hermes.deliver(composed, {
      deliver: flags.deliver,
      ...(deps.run ? { run: deps.run } : {}),
    });
    hermesResult = { delivered: outcome.delivered, command: outcome.command };
    out(
      outcome.delivered
        ? 'hermes: directive delivered through the agent'
        : `hermes: delivery skipped (pass --deliver to send). To deliver manually, run:\n  ${outcome.command}`,
    );
  }

  // Paste instructions: undetected file harnesses + tools without adapters.
  const manual = FILE_ADAPTERS.filter((a) => !selected.includes(a.id));
  if (manual.length > 0) {
    out('');
    out('Not wired (undetected or deselected):');
    for (const adapter of manual) {
      out(`  ${adapter.id} — re-run init after installing, or paste the block below into ${join(home, adapter.describe().target)}`);
    }
  }
  out('');
  out("Other tools (no adapter): paste this block into the tool's instruction file:");
  out('');
  out(renderWiringTemplate('portable-directive.md', { owner, tag: flags.tag ?? '<agent-tag>' }));

  return { code: 0, selected, created, wired, hermes: hermesResult };
}
