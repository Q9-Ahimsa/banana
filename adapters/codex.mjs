// Codex file adapter: wires the fenced continuity block into
// <home>/.codex/AGENTS.md. Content writes go only through lib/fence.mjs.
import { makeFileAdapter } from '../lib/wiring.mjs';

const adapter = makeFileAdapter({
  id: 'codex',
  name: 'Codex',
  target: ['.codex', 'AGENTS.md'],
  template: 'agents-md.md',
  defaultTag: 'codex',
});

export const { id, name, detect, describe, wire } = adapter;
export default adapter;
