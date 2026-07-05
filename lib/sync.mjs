// sync command: propagates upstream kit updates to an already-wired machine.
// Two moves, both idempotent: (1) refresh the kit-owned <home>/.agents/canon/
// dir to the bundled canon byte-for-byte; (2) re-apply the fenced wiring block
// to every already-wired harness file whose block version is older than the
// current template, preserving the owner/tag the block was rendered with.
// User-owned surfaces (STATE.md, logs, logbooks, anything outside a fence)
// are never touched, and unwired files are never created. No network code —
// npx fetching the latest kit is the transport.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFence } from './fence.mjs';
import { CANON_FILES, FILE_ADAPTERS } from './init.mjs';
import { wiringTemplateVersion } from './wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {object} SyncFlags */

/**
 * @typedef {object} SyncIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err]
 */

/**
 * Parse the argv slice after the `sync` subcommand.
 * @param {string[]} argv
 * @returns {SyncFlags}
 * @throws on any argument — sync takes none
 */
export function parseSyncArgs(argv) {
  for (const arg of argv) throw new Error(`unknown sync option '${arg}'`);
  return {};
}

/**
 * Recover the identity tokens a wired block was rendered with, so re-fencing
 * preserves them instead of inventing new ones. Handles both identity-line
 * formats ever shipped: v1 ("**Your agent tag:** `X`. Owner: `Y`") and
 * v2 ("you are `X`; owner: `Y`").
 * @param {string} block fenced block text, markers included
 * @returns {{ owner: string | null, tag: string | null }}
 */
export function extractIdentity(block) {
  const owner = /owner:\*{0,2}\s*`([^`]+)`/i.exec(block)?.[1] ?? null;
  const tag =
    (/you are `([^`]+)`/i.exec(block) ?? /agent tag:\*{0,2}\s*`([^`]+)`/i.exec(block))?.[1] ??
    null;
  return { owner, tag };
}

/**
 * @typedef {object} SyncResult
 * @property {number} code process exit code: 0 on success (skips included), 1 on failure
 */

/**
 * Run the sync command: refresh the canon dir, upgrade stale wiring fences,
 * report each change.
 * @param {SyncFlags} flags
 * @param {{ home: string, io: SyncIo }} deps
 * @returns {Promise<SyncResult>}
 */
export async function runSync(flags, deps) {
  const { home, io } = deps;
  const out = io.out;
  const err = io.err ?? io.out;

  try {
    let changes = 0;

    // Canon: kit-owned, created or refreshed to the bundled files.
    const canonDir = join(home, '.agents', 'canon');
    mkdirSync(canonDir, { recursive: true });
    for (const name of CANON_FILES) {
      const target = join(canonDir, name);
      const bundled = readFileSync(join(KIT_ROOT, 'canon', name), 'utf8');
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
      if (existing === bundled) continue;
      writeFileSync(target, bundled);
      out(`${existing === null ? 'installed' : 'refreshed'} ${target}`);
      changes += 1;
    }

    // Fences: only files that already carry a banana block are eligible, and
    // only when their block is older than the current template. Owner/tag come
    // from the existing block — sync never invents identity; a block it cannot
    // read is skipped (init is the remediation), never overwritten.
    for (const adapter of FILE_ADAPTERS) {
      const spec = adapter.describe();
      const target = join(home, spec.target);
      if (!existsSync(target)) continue;
      const text = readFileSync(target, 'utf8');
      /** @type {ReturnType<typeof findFence>} */
      let fence;
      try {
        fence = findFence(text);
      } catch (error) {
        err(`skipped ${target}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      if (fence === null) continue;
      const current = wiringTemplateVersion(spec.template);
      if (fence.version >= current) continue;
      const { owner, tag } = extractIdentity(text.slice(fence.start, fence.end));
      if (owner === null || tag === null) {
        err(
          `skipped ${target}: cannot recover owner/tag from the v${fence.version} block — re-run init`,
        );
        continue;
      }
      adapter.wire(home, { owner, tag });
      out(`re-fenced ${target}: v${fence.version} -> v${current}`);
      changes += 1;
    }

    out(changes === 0 ? 'sync: no changes — canon and fences current' : `sync: ${changes} change(s)`);
    return { code: 0 };
  } catch (error) {
    err(`banana sync: ${error instanceof Error ? error.message : error}`);
    return { code: 1 };
  }
}
