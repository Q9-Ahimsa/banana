import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { COMMANDS } from '../lib/commands.mjs';

const binPath = fileURLToPath(new URL('../bin/banana.mjs', import.meta.url));

test("bin's unknown-command guard names exactly lib/commands.mjs COMMANDS", () => {
  const result = spawnSync(process.execPath, [binPath, 'peel'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    `banana: unknown command 'peel' (expected ${COMMANDS.join('|')})`,
  );
});
