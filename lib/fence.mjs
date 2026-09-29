// Fenced-write engine: insert-or-replace of a version-marked block,
// `<!-- banana:begin vN -->` … `<!-- banana:end -->`. Idempotency is THE
// contract — applying the same block twice must leave the file byte-identical,
// and everything outside the fence is preserved byte-for-byte. File adapters
// write ONLY through this module.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BEGIN_RE = /<!-- banana:begin v(\d+) -->/;
export const FENCE_END = '<!-- banana:end -->';

/**
 * @param {number} version
 * @returns {string} the begin marker for a given fence version
 */
export function fenceBegin(version) {
  return `<!-- banana:begin v${version} -->`;
}

/**
 * Wrap content in version-marked fence markers.
 * @param {string} content inner block text, without markers
 * @param {number} version
 * @returns {string}
 */
export function fencedBlock(content, version) {
  return `${fenceBegin(version)}\n${content}\n${FENCE_END}`;
}

/**
 * Locate the fenced block in a text, if any.
 * @param {string} text
 * @returns {{ start: number, end: number, version: number } | null}
 *   start/end are offsets spanning the markers inclusive
 * @throws when a begin marker exists without a matching end marker
 */
export function findFence(text) {
  const begin = BEGIN_RE.exec(text);
  if (begin === null) return null;
  const endAt = text.indexOf(FENCE_END, begin.index);
  if (endAt === -1) {
    throw new Error(`corrupt fence: found "${begin[0]}" without a matching "${FENCE_END}"`);
  }
  return {
    start: begin.index,
    end: endAt + FENCE_END.length,
    version: Number(begin[1]),
  };
}

/**
 * Recover the identity tokens (agent tag + owner) a fenced block was
 * rendered with, so a re-fence can preserve them instead of inventing new
 * ones. Handles both identity-line formats ever shipped: v1 ("**Your agent
 * tag:** `X`. Owner: `Y`") and v2 ("you are `X`; owner: `Y`"). Single-sourced
 * here (#16) so every fence-writing path reads identity the same way.
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
 * Recover the identity an EXISTING fence in a target file carries, if any —
 * the single "read identity before rewriting" step every fence-writing path
 * (project's own AGENTS.md write, sync's adapter re-fencing) shares, so a
 * rewrite preserves an owner-set tag/owner instead of overwriting it with
 * this run's defaults. Returns null when there's nothing to preserve: no
 * file, no fence, or a corrupt fence (the real write path's own findFence
 * call surfaces that failure). A fence whose identity line can't be parsed
 * also returns null, but first prints exactly one warning line through the
 * injected io naming the file, so identity loss is never silent.
 * @param {string} filePath
 * @param {{ out: (line?: string) => void, err?: (line?: string) => void }} io
 * @returns {{ owner: string, tag: string } | null}
 */
export function readPreservedIdentity(filePath, io) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf8');
  /** @type {ReturnType<typeof findFence>} */
  let fence;
  try {
    fence = findFence(text);
  } catch {
    return null;
  }
  if (fence === null) return null;
  const { owner, tag } = extractIdentity(text.slice(fence.start, fence.end));
  if (owner === null || tag === null) {
    const warn = io.err ?? io.out;
    warn(`banana: cannot recover owner/tag from the existing fence in ${filePath} — using defaults`);
    return null;
  }
  return { owner, tag };
}

/**
 * @param {string} block
 * @returns {number} the block's fence version
 * @throws when the block is not a well-formed fenced block
 */
function blockVersion(block) {
  const found = findFence(block);
  if (found === null || found.start !== 0 || found.end !== block.length) {
    throw new Error('block must be a fenced block: begin/end markers spanning the whole text');
  }
  return found.version;
}

/**
 * Pure insert-or-replace. Replaces an existing fence (any version) in place;
 * appends the block when no fence exists, preserving all existing content.
 * @param {string} text existing file text
 * @param {string} block a fenced block, markers included (see fencedBlock)
 * @returns {string}
 */
export function spliceFence(text, block) {
  blockVersion(block);
  const found = findFence(text);
  if (found !== null) {
    return text.slice(0, found.start) + block + text.slice(found.end);
  }
  if (text === '') return block + '\n';
  const sep = text.endsWith('\n') ? '\n' : '\n\n';
  return text + sep + block + '\n';
}

/**
 * Apply a fenced block to a file: create it if missing, otherwise
 * insert-or-replace the fence. Writes only when the result differs.
 * @param {string} filePath
 * @param {string} block a fenced block, markers included
 * @returns {{ created: boolean, changed: boolean, previousVersion: number | null }}
 */
export function applyFence(filePath, block) {
  const exists = existsSync(filePath);
  const before = exists ? readFileSync(filePath, 'utf8') : '';
  const previousVersion = exists ? (findFence(before)?.version ?? null) : null;
  const after = spliceFence(before, block);
  const changed = !exists || after !== before;
  if (changed) writeFileSync(filePath, after);
  return { created: !exists, changed, previousVersion };
}
