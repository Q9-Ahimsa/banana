// US-005 acceptance (shared boundary): owner resolution extracted from init so
// project shares one inference order — --owner flag, then git config
// user.name, then a prompt only on a TTY and never under --yes; non-TTY with
// nothing inferable resolves null after printing the exact non-interactive
// invocation for the calling command.
import test from 'node:test';
import assert from 'node:assert/strict';

import { nonInteractiveInvocation, resolveOwner } from '../lib/owner.mjs';

/**
 * Scripted IO: canned prompt answers, captured output.
 * @param {string[]} [answers]
 */
function scriptedIo(answers = []) {
  const queue = [...answers];
  /** @type {string[]} */
  const lines = [];
  let prompts = 0;
  return {
    lines,
    prompts: () => prompts,
    io: {
      out: (line = '') => lines.push(line),
      prompt: async (/** @type {string} */ question) => {
        prompts++;
        if (queue.length === 0) throw new Error(`unexpected prompt: ${question}`);
        return queue.shift() ?? '';
      },
    },
  };
}

test('the --owner flag wins over git config', async () => {
  const { io, prompts } = scriptedIo();
  const owner = await resolveOwner('init', { owner: 'Flag Owner', yes: false }, {
    io,
    isTTY: true,
    gitUserName: () => 'Git Owner',
  });
  assert.equal(owner, 'Flag Owner');
  assert.equal(prompts(), 0, 'no prompt when the flag is present');
});

test('git config user.name is inferred and reported', async () => {
  const { io, lines } = scriptedIo();
  const owner = await resolveOwner('project', { owner: null, yes: true }, {
    io,
    gitUserName: () => 'Git Alice',
  });
  assert.equal(owner, 'Git Alice');
  assert.ok(lines.join('\n').includes('Git Alice (from git config user.name)'), 'inference reported');
});

test('non-TTY with nothing inferable resolves null naming --owner and --yes', async () => {
  const { io, lines } = scriptedIo();
  const owner = await resolveOwner('project', { owner: null, yes: false }, { io });
  assert.equal(owner, null);
  const output = lines.join('\n');
  assert.ok(output.includes('--owner'), 'failure names --owner');
  assert.ok(output.includes('--yes'), 'failure names --yes');
  assert.ok(
    output.includes(nonInteractiveInvocation('project')),
    'exact non-interactive invocation printed for the calling command',
  );
});

test('--yes suppresses the prompt even on a TTY', async () => {
  const { io, prompts } = scriptedIo(['never asked']);
  const owner = await resolveOwner('init', { owner: null, yes: true }, { io, isTTY: true });
  assert.equal(owner, null);
  assert.equal(prompts(), 0, 'no prompt under --yes');
});

test('TTY prompt is the last rung; an empty answer resolves null', async () => {
  const prompted = scriptedIo(['Prompted Owner']);
  const owner = await resolveOwner('init', { owner: null, yes: false }, {
    io: prompted.io,
    isTTY: true,
  });
  assert.equal(owner, 'Prompted Owner');
  assert.equal(prompted.prompts(), 1);

  const empty = scriptedIo(['   ']);
  const rejected = await resolveOwner('init', { owner: null, yes: false }, {
    io: empty.io,
    isTTY: true,
  });
  assert.equal(rejected, null);
  assert.ok(empty.lines.join('\n').includes('an owner name is required'));
});

test('nonInteractiveInvocation names the calling command', () => {
  assert.equal(
    nonInteractiveInvocation('init'),
    'npx --yes github:Q9-Ahimsa/banana init --owner "<name>" --yes',
  );
  assert.equal(
    nonInteractiveInvocation('project'),
    'npx --yes github:Q9-Ahimsa/banana project --owner "<name>" --yes',
  );
});
