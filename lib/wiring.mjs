// File-wiring adapter factory. Each file-wired harness gets an
// adapters/<id>.mjs built from makeFileAdapter: the wiring target is declared
// as data, rendering fills the two documented placeholders
// (__OWNER__/__AGENT_TAG__), and all content writes go through lib/fence.mjs
// so wiring inherits the idempotency contract.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyFence } from './fence.mjs';
import { detect as detectHarnesses } from './detect.mjs';

const WIRING_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'wiring');

/**
 * Render a wiring template, substituting the two documented placeholders.
 * @param {string} name file name under templates/wiring/
 * @param {{ owner: string, tag: string }} tokens
 * @returns {string} fenced block, markers included, no trailing newline
 */
export function renderWiringTemplate(name, { owner, tag }) {
  if (!owner) throw new Error('wiring requires an owner');
  if (!tag) throw new Error('wiring requires an agent tag');
  const raw = readFileSync(join(WIRING_DIR, name), 'utf8');
  return raw.replaceAll('__OWNER__', owner).replaceAll('__AGENT_TAG__', tag).trimEnd();
}

/**
 * @typedef {object} FileAdapterSpec
 * @property {string} id harness id, matching lib/detect.mjs
 * @property {string} name human-readable name
 * @property {string[]} target path segments of the wired file, relative to home
 * @property {string} template file name under templates/wiring/
 * @property {string} defaultTag agent tag written when opts.tag is absent
 */

/**
 * Build a file-wiring adapter exposing detect/describe/wire over a declared
 * target file.
 * @param {FileAdapterSpec} spec
 */
export function makeFileAdapter(spec) {
  return {
    id: spec.id,
    name: spec.name,

    /**
     * @param {string} home
     * @param {{ env?: { PATH?: string, PATHEXT?: string } }} [opts]
     * @returns {import('./detect.mjs').HarnessReport}
     */
    detect(home, opts = {}) {
      const report = detectHarnesses(home, opts).harnesses.find((h) => h.id === spec.id);
      if (!report) throw new Error(`unknown harness id: ${spec.id}`);
      return report;
    },

    /** @returns {{ id: string, name: string, target: string, template: string }} */
    describe() {
      return { id: spec.id, name: spec.name, target: join(...spec.target), template: spec.template };
    },

    /**
     * Insert-or-replace the fenced wiring block in this adapter's target file.
     * @param {string} home
     * @param {{ owner: string, tag?: string }} opts
     * @returns {{ target: string, created: boolean, changed: boolean, previousVersion: number | null }}
     */
    wire(home, opts) {
      const block = renderWiringTemplate(spec.template, {
        owner: opts.owner,
        tag: opts.tag ?? spec.defaultTag,
      });
      const target = join(home, ...spec.target);
      mkdirSync(dirname(target), { recursive: true });
      return { target, ...applyFence(target, block) };
    },
  };
}
