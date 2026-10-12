import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  spliceFence,
  applyFence,
  findFence,
  fencedBlock,
  extractIdentity,
  readPreservedIdentity,
  eolOf,
  toLf,
  withEol,
  writeKitFile,
} from '../lib/fence.mjs';

const BLOCK_V1 = fencedBlock('## Continuity protocol\n\n- rule one\n- rule two', 1);
const BLOCK_V1_UPDATED = fencedBlock('## Continuity protocol\n\n- rule one revised', 1);
const BLOCK_V2 = fencedBlock('## Continuity protocol v2\n\n- new regime', 2);

/** @returns {{ out: (l?: string) => void, err: (l?: string) => void, lines: string[], errLines: string[] }} */
function collectedIo() {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const errLines = [];
  return {
    lines,
    errLines,
    out: (/** @type {string} */ line = '') => lines.push(line),
    err: (/** @type {string} */ line = '') => errLines.push(line),
  };
}

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

// extractIdentity / readPreservedIdentity (#16): single-sourced "read
// identity from an existing fence" step, shared by every fence-writing path.

test('extractIdentity recovers owner and tag from a v2 identity line', () => {
  const block = fencedBlock('- **Identity:** you are `alpha-agent`; owner: `beta-owner`.', 2);
  assert.deepEqual(extractIdentity(block), { owner: 'beta-owner', tag: 'alpha-agent' });
});

test('extractIdentity returns nulls when there is no identity line', () => {
  assert.deepEqual(extractIdentity(fencedBlock('no identity line here', 1)), {
    owner: null,
    tag: null,
  });
});

test('readPreservedIdentity returns null when the file does not exist', (t) => {
  const io = collectedIo();
  const target = join(sandbox(t), 'does-not-exist.md');
  assert.equal(readPreservedIdentity(target, io), null);
  assert.deepEqual(io.lines, []);
  assert.deepEqual(io.errLines, []);
});

test('readPreservedIdentity returns null when the file has no fence', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  writeFileSync(target, '# Purely user-owned instructions\n');
  const io = collectedIo();
  assert.equal(readPreservedIdentity(target, io), null);
  assert.deepEqual(io.errLines, []);
});

test('readPreservedIdentity returns null, not a throw, on a corrupt fence', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  writeFileSync(target, '<!-- banana:begin v1 -->\nno end marker here\n');
  const io = collectedIo();
  assert.equal(readPreservedIdentity(target, io), null);
  assert.deepEqual(io.errLines, [], 'a corrupt fence is surfaced by the real write path, not warned here');
});

test('readPreservedIdentity recovers owner/tag from an existing fence', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  const block = fencedBlock('- **Identity:** you are `alpha-agent`; owner: `beta-owner`.', 2);
  writeFileSync(target, `intro\n\n${block}\n`);
  const io = collectedIo();
  assert.deepEqual(readPreservedIdentity(target, io), { owner: 'beta-owner', tag: 'alpha-agent' });
  assert.deepEqual(io.errLines, []);
});

test('readPreservedIdentity warns exactly once and returns null when identity cannot be parsed', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  writeFileSync(target, fencedBlock('no identity line here', 1));
  const io = collectedIo();
  assert.equal(readPreservedIdentity(target, io), null);
  assert.equal(io.errLines.length, 1, 'exactly one warning line');
  assert.ok(io.errLines[0].includes(target), 'warning names the file');
});

test('readPreservedIdentity falls back to io.out when io.err is absent', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  writeFileSync(target, fencedBlock('no identity line here', 1));
  /** @type {string[]} */
  const lines = [];
  assert.equal(readPreservedIdentity(target, { out: (line = '') => lines.push(line) }), null);
  assert.equal(lines.length, 1, 'warning lands on out when err is not provided');
  assert.ok(lines[0].includes(target));
});

// Line endings (#19): for sync and writeKitFile a line-ending difference is never
// a change; a write keeps the target's own style, and a new file is LF.

const asLf = (/** @type {string} */ s) => s.replace(/\r\n/g, '\n');
const asCrlf = (/** @type {string} */ s) => asLf(s).replace(/\n/g, '\r\n');
const hasBareLf = (/** @type {string} */ s) => /(^|[^\r])\n/.test(s);

test('eolOf: CRLF only when CRLF line breaks outnumber bare LF; ties and break-less text are LF (#19)', () => {
  assert.equal(eolOf('a\r\nb\r\n'), '\r\n');
  assert.equal(eolOf('a\nb\n'), '\n');
  assert.equal(eolOf('a\r\nb\n'), '\n');
  assert.equal(eolOf('a\r\nb\r\nc\n'), '\r\n');
  assert.equal(eolOf(''), '\n');
  assert.equal(eolOf('one line'), '\n');
  assert.equal(eolOf('a\rb\rc\n'), '\n');
});

test('withEol / toLf: CRLF<->LF without doubling, lone CR untouched (#19)', () => {
  assert.equal(withEol('a\nb\r\nc', '\r\n'), 'a\r\nb\r\nc');
  assert.equal(withEol('a\r\nb\n', '\n'), 'a\nb\n');
  assert.equal(toLf('a\rb\r\n'), 'a\rb\n');
});

test('spliceFence writes a replaced block in the CRLF host\'s style; bytes outside the fence untouched (#19)', () => {
  const host = 'head\r\n\r\n' + asCrlf(BLOCK_V1) + '\r\ntail\r\n';
  assert.equal(spliceFence(host, BLOCK_V2), 'head\r\n\r\n' + asCrlf(BLOCK_V2) + '\r\ntail\r\n');
  const tailless = 'head\r\n\r\n' + asCrlf(BLOCK_V1);
  assert.equal(spliceFence(tailless, BLOCK_V2), 'head\r\n\r\n' + asCrlf(BLOCK_V2), 'the text before the fence sets the style');
  const headless = asCrlf(BLOCK_V1) + '\r\ntail\r\n';
  assert.equal(spliceFence(headless, BLOCK_V2), asCrlf(BLOCK_V2) + '\r\ntail\r\n', 'so does the text after it');
});

test('spliceFence appends to a CRLF host in CRLF (#19)', () => {
  const host = '# notes\r\nkeep\r\n';
  assert.equal(spliceFence(host, BLOCK_V1), host + '\r\n' + asCrlf(BLOCK_V1) + '\r\n');
  const bare = '# notes\r\nkeep';
  assert.equal(spliceFence(bare, BLOCK_V1), bare + '\r\n\r\n' + asCrlf(BLOCK_V1) + '\r\n', 'no trailing break: a CRLF blank-line separator');
});

test('spliceFence fits a CRLF block into an LF host, and a new file is LF (#19)', () => {
  assert.ok(!spliceFence('a\n', asCrlf(BLOCK_V1)).includes('\r'));
  assert.equal(spliceFence('', asCrlf(BLOCK_V1)), BLOCK_V1 + '\n');
  assert.equal(spliceFence('a\n' + BLOCK_V1 + '\n', asCrlf(BLOCK_V2)), 'a\n' + BLOCK_V2 + '\n', 'a replaced block is fitted to an LF host too');
});

test('spliceFence is idempotent on a mixed host: style judged outside the fence (#19)', () => {
  const host = 'a\r\nb\r\nc\r\n' + fencedBlock('l1\nl2\nl3\nl4\nl5\nl6', 1) + '\r\n';
  const nb = fencedBlock('x', 2);
  const s1 = spliceFence(host, nb);
  const s2 = spliceFence(s1, nb);
  assert.equal(s1, s2);
  const found = findFence(s1);
  assert.ok(found !== null);
  const region = s1.slice(found.start, found.end);
  assert.ok(region.includes('\r\n'));
  assert.ok(!hasBareLf(region));
});

test('applyFence on a CRLF host already carrying the same block reports unchanged and writes nothing (#19)', (t) => {
  const target = join(sandbox(t), 'AGENTS.md');
  const host = 'head\r\n\r\n' + asCrlf(BLOCK_V1) + '\r\ntail\r\n';
  writeFileSync(target, host);
  const report = applyFence(target, BLOCK_V1);
  assert.equal(report.changed, false);
  assert.equal(report.created, false);
  assert.equal(readFileSync(target, 'utf8'), host);
  const mixed = join(sandbox(t), 'AGENTS.md');
  writeFileSync(mixed, 'head\r\n\r\n' + BLOCK_V1 + '\r\ntail\r\n');
  assert.equal(applyFence(mixed, BLOCK_V1).changed, true, 'an LF fence in a CRLF host is refitted, so the file is no longer mixed');
  assert.equal(readFileSync(mixed, 'utf8'), host);
});

test('writeKitFile: a CRLF-only difference is no change and writes nothing, both directions (#19)', (t) => {
  const dir = sandbox(t);
  const a = join(dir, 'a.md');
  writeFileSync(a, 'x\r\ny\r\n');
  assert.deepEqual(writeKitFile(a, 'x\ny\n'), { created: false, changed: false });
  assert.equal(readFileSync(a, 'utf8'), 'x\r\ny\r\n');
  const b = join(dir, 'b.md');
  writeFileSync(b, 'x\ny\n');
  assert.deepEqual(writeKitFile(b, 'x\r\ny\r\n'), { created: false, changed: false });
  assert.equal(readFileSync(b, 'utf8'), 'x\ny\n');
});

test('writeKitFile: a real change keeps the existing file\'s style; a new file is LF (#19)', (t) => {
  const dir = sandbox(t);
  const a = join(dir, 'a.md');
  writeFileSync(a, 'old\r\n');
  assert.deepEqual(writeKitFile(a, 'new\nline\n'), { created: false, changed: true });
  assert.equal(readFileSync(a, 'utf8'), 'new\r\nline\r\n');
  const b = join(dir, 'b.md');
  writeFileSync(b, 'old\n');
  writeKitFile(b, 'new\r\nline\r\n');
  assert.equal(readFileSync(b, 'utf8'), 'new\nline\n');
  const c = join(dir, 'c.md');
  assert.deepEqual(writeKitFile(c, 'a\r\nb\r\n'), { created: true, changed: true });
  assert.equal(readFileSync(c, 'utf8'), 'a\nb\n');
});
