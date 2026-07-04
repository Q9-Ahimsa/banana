// Hermes write-through adapter: hermes is a memory-bearing agent, so the
// continuity protocol is delivered through the agent (one-shot directive),
// never written at its files. compose() builds the directive text and the
// delivery command; deliver() executes only behind an explicit --deliver flag.
import { execSync } from 'node:child_process';

import { detect as detectHarnesses } from '../lib/detect.mjs';
import { FENCE_END } from '../lib/fence.mjs';
import { renderWiringTemplate } from '../lib/wiring.mjs';

const DEFAULT_TAG = 'hermes';

/**
 * Fence markers exist for file idempotency; a directive delivered into an
 * agent's memory is not a file, so the markers are stripped.
 * @param {string} block rendered wiring template, markers included
 * @returns {string}
 */
function stripFence(block) {
  const lines = block.split('\n');
  if (lines[0]?.startsWith('<!-- banana:begin')) lines.shift();
  if (lines[lines.length - 1] === FENCE_END) lines.pop();
  return lines.join('\n').trim();
}

/**
 * Quote the directive for embedding in the one-shot command string.
 * @param {string} text
 * @returns {string}
 */
function quote(text) {
  return '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}

const adapter = {
  id: 'hermes',
  name: 'Hermes',

  /**
   * @param {string} home
   * @param {{ env?: { PATH?: string, PATHEXT?: string } }} [opts]
   * @returns {import('../lib/detect.mjs').HarnessReport}
   */
  detect(home, opts = {}) {
    const report = detectHarnesses(home, opts).harnesses.find((h) => h.id === 'hermes');
    if (!report) throw new Error('unknown harness id: hermes');
    return report;
  },

  /** @returns {{ id: string, name: string, target: null, delivery: string }} */
  describe() {
    return { id: 'hermes', name: 'Hermes', target: null, delivery: 'write-through-agent' };
  },

  /**
   * Build the agent-to-agent directive and its one-shot delivery command.
   * Pure composition — nothing is written or executed here.
   * @param {{ owner: string, tag?: string }} opts
   * @returns {{ directive: string, command: string, tag: string }}
   */
  compose(opts) {
    if (!opts?.owner) throw new Error('compose requires an owner');
    const tag = opts.tag ?? DEFAULT_TAG;
    const summary = stripFence(
      renderWiringTemplate('portable-directive.md', { owner: opts.owner, tag }),
    );
    const directive = [
      `FROM: banana continuity kit (agent-to-agent) on behalf of ${opts.owner}`,
      `Store this protocol in persistent memory and follow it in every project. Your agent tag is \`${tag}\`.`,
      '',
      summary,
    ].join('\n');
    return { directive, command: `hermes -z ${quote(directive)}`, tag };
  },

  /**
   * Deliver a composed directive through the agent. Refuses to execute unless
   * the explicit --deliver flag is set; never touches the hermes file tree.
   * @param {{ command: string }} composed
   * @param {{ deliver?: boolean, run?: (command: string) => unknown }} [opts]
   * @returns {{ delivered: boolean, command: string }}
   */
  deliver(composed, opts = {}) {
    if (opts.deliver !== true) return { delivered: false, command: composed.command };
    const run = opts.run ?? ((command) => execSync(command, { stdio: 'inherit' }));
    run(composed.command);
    return { delivered: true, command: composed.command };
  },
};

export const { id, name, detect, describe, compose, deliver } = adapter;
export default adapter;
