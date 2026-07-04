// Pi file adapter: wires the fenced continuity block into
// <home>/.pi/agent/AGENTS.md. Content writes go only through lib/fence.mjs.
import { makeFileAdapter } from '../lib/wiring.mjs';

const adapter = makeFileAdapter({
  id: 'pi',
  name: 'Pi',
  target: ['.pi', 'agent', 'AGENTS.md'],
  template: 'agents-md.md',
  defaultTag: 'pi',
});

export const { id, name, detect, describe, wire } = adapter;
export default adapter;
