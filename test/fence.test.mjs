import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spliceFence, applyFence, findFence, fencedBlock } from '../lib/fence.mjs';

const BLOCK_V1 = fencedBlock('## Continuity protocol\n\n- rule one\n- rule two', 1);
const BLOCK_V1_UPDATED = fencedBlock('## Continuity protocol\n\n- rule one revised', 1);
const BLOCK_V2 = fencedBlock('## Continuity protocol v2\n\n- new regime', 2);

/** @returns {string} a fresh temp dir, cleaned up when the test ends */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-fence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('fencedBlock wraps content in version-marked markers', () => {
  assert.ok(BLOCK_V1.startsWith('<!-- banana:begin v1 -->\n'));
  assert.ok(BLOCK_V1.endsWith('\n<!-- banana:end -->'));
  assert.ok(BLOCK_V2.startsWith('<!-- banana:begin v2 -->\n'));
});

test('findFence locates the block and reports its version', () => {
  const text = `intro\n\n${BLOCK_V1}\n\noutro\n`;
  const found = findFence(text);
  assert.ok(found !== null);
  assert.equal(found.version, 1);
  assert.equal(text.slice(found.start, found.end), BLOCK_V1);
});

test('findFence returns null when no fence exists', () => {
  assert.equal(findFence('just some prose\n'), null);
});

test('findFence throws on a corrupt fence (begin without end)', () => {
  assert.throws(() => findFence('<!-- banana:begin v1 -->\ndangling\n'), /corrupt/i);
});

test('spliceFence appends to text with no fence, preserving existing content', () => {
  const before = '# My CLAUDE.md\n\nuser notes here\n';
  const after = spliceFence(before, BLOCK_V1);
  assert.ok(after.startsWith(before), 'existing content must be preserved byte-for-byte');
  assert.ok(after.includes(BLOCK_V1));
});

test('spliceFence rejects a block without fence markers', () => {
  assert.throws(() => spliceFence('', 'no markers here'), /fence/i);
});

test('applyFence creates the file if missing', (t) => {
  const target = join(sandbox(t), 'CLAUDE.md');
  const report = applyFence(target, BLOCK_V1);
  assert.equal(report.created, true);
  assert.equal(report.changed, true);
  assert.ok(readFileSync(target, 'utf8').includes(BLOCK_V1));
});

test('applying twice yields a byte-identical file', (t) => {
  const target = join(sandbox(t), 'CLAUDE.md');
  writeFileSync(target, '# Existing config\n\nkeep me\n');
  applyFence(target, BLOCK_V1);
  const firstPass = readFileSync(target);
  const report = applyFence(target, BLOCK_V1);
  const secondPass = readFileSync(target);
  assert.equal(report.changed, false);
  assert.ok(firstPass.equals(secondPass), 'second apply must be byte-identical');
});

test('user content outside the fence is unchanged byte-for-byte', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  const head = '# User header\r\n\r\nweird spacing   \n\ttabbed line\n\n';
  const tail = '\n## User trailer\nno trailing newline';
  writeFileSync(target, head + BLOCK_V1 + tail);
  applyFence(target, BLOCK_V1_UPDATED);
  const after = readFileSync(target, 'utf8');
  assert.equal(after, head + BLOCK_V1_UPDATED + tail);
});

test('a version bump replaces the old block in place', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  const head = 'before\n\n';
  const tail = '\n\nafter\n';
  writeFileSync(target, head + BLOCK_V1 + tail);
  const report = applyFence(target, BLOCK_V2);
  const after = readFileSync(target, 'utf8');
  assert.equal(after, head + BLOCK_V2 + tail);
  assert.ok(!after.includes('banana:begin v1'), 'old version marker must be gone');
  assert.equal(report.previousVersion, 1);
  assert.equal(report.changed, true);
});

test('applyFence never touches the file when nothing changes', (t) => {
  const dir = sandbox(t);
  const target = join(dir, 'CLAUDE.md');
  applyFence(target, BLOCK_V1);
  const decoy = join(dir, 'untouched.md');
  writeFileSync(decoy, 'decoy\n');
  const report = applyFence(target, BLOCK_V1);
  assert.equal(report.created, false);
  assert.equal(report.changed, false);
  assert.equal(readFileSync(decoy, 'utf8'), 'decoy\n');
  assert.ok(existsSync(target));
});
