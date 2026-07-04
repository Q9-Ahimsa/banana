// Claude Code file adapter: wires the fenced continuity block into
// <home>/.claude/CLAUDE.md. Content writes go only through lib/fence.mjs.
import { makeFileAdapter } from '../lib/wiring.mjs';

const adapter = makeFileAdapter({
  id: 'claude-code',
  name: 'Claude Code',
  target: ['.claude', 'CLAUDE.md'],
  template: 'claude-code.md',
  defaultTag: 'claude',
});

export const { id, name, detect, describe, wire } = adapter;
export default adapter;
