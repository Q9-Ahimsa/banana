import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SESSION_LOG_REF,
  GHOST_THRESHOLD_HOURS,
  sessionLogPath,
  loadSessionLog,
  parseSessionLog,
  nextOwner,
  isOpen,
  isGhost,
  entriesForFeature,
  latestEntryDates,
} from '../lib/sessionlog.mjs';

/** @type {string[]} */
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Fixed clock: 2026-07-04 noon UTC. Entries dated 2026-07-01 are >48h old.
const NOW = Date.parse('2026-07-04T12:00:00Z');

const LOG = `# Session log — task-grain work journal (Session Log v2)
> Append-only. Envelope: \`## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}\`

## [2026-07-01] claude auth.1 | build — JWT refresh flow
APPROACH: Rotate refresh tokens on use.
STATUS: complete
NEXT: claude — wire refresh into login flow

## [2026-07-02] codex billing.1 | build — tax rules
APPROACH: Table-driven tax rates.
STATUS: complete
NEXT: decide rounding policy

## [2026-07-04] claude auth.2 | debug — token clock skew
APPROACH: Investigate skew between issuer and gateway.
STATUS: in-progress
`;

// --- envelope grammar ---

test('parseSessionLog: envelope fields, heading verbatim, body, status, NEXT lines', () => {
  const entries = parseSessionLog(LOG);
  assert.equal(entries.length, 3);
  const [a1] = entries;
  assert.equal(a1.date, '2026-07-01');
  assert.equal(a1.agent, 'claude');
  assert.equal(a1.feature, 'auth');
  assert.equal(a1.n, 1);
  assert.equal(a1.phase, 'build');
  assert.equal(a1.title, 'JWT refresh flow');
  assert.equal(a1.heading, '## [2026-07-01] claude auth.1 | build — JWT refresh flow');
  assert.deepEqual(a1.body, [
    'APPROACH: Rotate refresh tokens on use.',
    'STATUS: complete',
    'NEXT: claude — wire refresh into login flow',
  ]);
  assert.equal(a1.status, 'complete');
  assert.deepEqual(a1.nextLines, ['NEXT: claude — wire refresh into login flow']);
});

test('parseSessionLog: preamble before the first envelope is ignored', () => {
  const entries = parseSessionLog(LOG);
  assert.ok(entries.every((e) => !e.body.some((line) => line.includes('Append-only'))));
});

test('parseSessionLog: trailing blank lines are trimmed from bodies', () => {
  const entries = parseSessionLog(LOG);
  for (const entry of entries) {
    assert.notEqual(entry.body[entry.body.length - 1].trim(), '');
  }
});

test('parseSessionLog: tolerates CRLF line endings', () => {
  const entries = parseSessionLog(LOG.replaceAll('\n', '\r\n'));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].status, 'complete');
});

test('parseSessionLog: malformed envelopes never open an entry', () => {
  const malformed = [
    '## [2026-7-01] claude auth.9 | build — short year-month', // bad date shape
    '## [2026-07-01] claude auth.9 build — missing pipe',
    '## [2026-07-01] claude auth.9 | build - hyphen not em-dash',
    '## [2026-07-01] claude auth | build — missing .n',
    '## [2026-07-01] claude auth.x | build — non-numeric n',
    '### [2026-07-01] claude auth.9 | build — deeper heading level',
    '## [2026-07-01] claude auth.9 | build —', // missing title
    '  ## [2026-07-01] claude auth.9 | build — indented heading',
  ];
  // Alone in a log, a malformed heading yields no entries at all.
  for (const line of malformed) {
    assert.deepEqual(parseSessionLog(`${line}\nSTATUS: complete\n`), [], `must not parse: ${line}`);
  }
  // After a valid entry, a malformed heading is body text of that entry.
  const entries = parseSessionLog(`${LOG}\n${malformed[1]}\n`);
  assert.equal(entries.length, 3);
  assert.ok(entries[2].body.includes(malformed[1]));
});

test('parseSessionLog: missing STATUS yields status null', () => {
  const entries = parseSessionLog(
    '## [2026-07-01] claude auth.1 | build — no status yet\nAPPROACH: stub only.\n'
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, null);
});

test('parseSessionLog: the last STATUS line wins (write-progressively appends)', () => {
  const entries = parseSessionLog(
    '## [2026-07-01] claude auth.1 | build — reopened\n' +
      'STATUS: in-progress\n' +
      'PROBLEM: flaky gateway.\n' +
      'STATUS: complete\n'
  );
  assert.equal(entries[0].status, 'complete');
});

// --- open-entry and ghost detection ---

test('isOpen: STATUS in-progress is open; complete and missing are not', () => {
  const entries = parseSessionLog(LOG);
  assert.equal(isOpen(entries[0]), false); // complete
  assert.equal(isOpen(entries[2]), true); // in-progress
  const noStatus = parseSessionLog('## [2026-07-01] claude auth.1 | build — stub\nAPPROACH: x.\n');
  assert.equal(isOpen(noStatus[0]), false);
});

test('isGhost: open entries older than the threshold only', () => {
  assert.equal(GHOST_THRESHOLD_HOURS, 48);
  const old = parseSessionLog('## [2026-07-01] claude auth.1 | build — old\nSTATUS: in-progress\n');
  const fresh = parseSessionLog('## [2026-07-04] claude auth.2 | build — fresh\nSTATUS: in-progress\n');
  const closed = parseSessionLog('## [2026-07-01] claude auth.3 | build — done\nSTATUS: complete\n');
  assert.equal(isGhost(old[0], NOW), true);
  assert.equal(isGhost(fresh[0], NOW), false);
  assert.equal(isGhost(closed[0], NOW), false);
});

test('isGhost: an unparseable date (shape-valid, calendar-invalid) is never a ghost', () => {
  const entries = parseSessionLog(
    '## [2026-13-45] claude auth.1 | build — impossible date\nSTATUS: in-progress\n'
  );
  assert.equal(entries.length, 1);
  assert.equal(isGhost(entries[0], NOW), false);
});

// --- NEXT ownership ---

test('nextOwner: owned, unowned, and multi-word owners', () => {
  assert.equal(nextOwner('NEXT: claude — wire refresh into login flow'), 'claude');
  assert.equal(nextOwner('NEXT: decide rounding policy'), null);
  assert.equal(nextOwner('NEXT: claude - hyphen is not the canon dash'), null);
  assert.equal(nextOwner('NEXT: ahimsa+claude — pair on the review'), 'ahimsa+claude');
});

// --- per-feature grouping and entry dates ---

test('entriesForFeature: filters by slug, preserves log order, supports multiple open entries', () => {
  const twoOpen =
    LOG +
    '\n## [2026-07-04] human auth.3 | review — second open claim\nAPPROACH: parallel review.\nSTATUS: in-progress\n';
  const entries = parseSessionLog(twoOpen);
  const auth = entriesForFeature(entries, 'auth');
  assert.deepEqual(
    auth.map((e) => `${e.feature}.${e.n}`),
    ['auth.1', 'auth.2', 'auth.3']
  );
  assert.deepEqual(auth.filter((e) => isOpen(e)).map((e) => e.n), [2, 3]);
  assert.deepEqual(entriesForFeature(entries, 'nope'), []);
});

test('latestEntryDates: newest date per slug', () => {
  const dates = latestEntryDates(parseSessionLog(LOG));
  assert.equal(dates.get('auth'), '2026-07-04');
  assert.equal(dates.get('billing'), '2026-07-02');
  assert.equal(dates.size, 2);
  assert.equal(latestEntryDates([]).size, 0);
});

// --- disk access (sandbox only) ---

test('sessionLogPath: composes the canonical repo-relative location', () => {
  assert.equal(sessionLogPath('root'), join('root', '.agents', 'session.log'));
  assert.equal(SESSION_LOG_REF, '.agents/session.log');
});

test('loadSessionLog: parses a project log from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(sessionLogPath(dir), LOG);
  const entries = loadSessionLog(dir);
  assert.equal(entries.length, 3);
  assert.equal(entries[2].title, 'token clock skew');
});

test('loadSessionLog: missing log throws with a pointer to banana project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  assert.throws(() => loadSessionLog(dir), /banana project/);
  assert.throws(() => loadSessionLog(dir), /session\.log/);
});
