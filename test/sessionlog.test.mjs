import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SESSION_LOG_REF,
  SESSION_ARCHIVE_DIR_REF,
  GHOST_THRESHOLD_HOURS,
  ROTATION_LINES,
  PHASES,
  STATUSES,
  TERMINAL_STATUSES,
  sessionLogPath,
  loadSessionLog,
  loadSessionHistory,
  parseSessionLog,
  formatEnvelope,
  formatLocalDate,
  isHeadingLine,
  countLines,
  nextN,
  supersededIds,
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

// --- BOM handling (parseSessionLog) ---

test('parseSessionLog: strips a leading UTF-8 BOM without losing the first entry', () => {
  const withBom = '\uFEFF' + LOG;
  const entries = parseSessionLog(withBom);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].feature, 'auth');
  assert.equal(entries[0].n, 1);
  assert.equal(entries[0].heading, '## [2026-07-01] claude auth.1 | build — JWT refresh flow');
});

test('parseSessionLog: no BOM is a no-op (does not eat real content)', () => {
  const entries = parseSessionLog(LOG);
  assert.equal(entries.length, 3);
});

// --- grammar vocabulary constants ---

test('PHASES / STATUSES / TERMINAL_STATUSES: exact vocabularies', () => {
  assert.deepEqual(PHASES, ['discuss', 'build', 'refactor', 'debug', 'review', 'ops']);
  assert.deepEqual(STATUSES, ['in-progress', 'complete', 'blocked', 'abandoned']);
  assert.deepEqual(TERMINAL_STATUSES, ['complete', 'blocked', 'abandoned']);
});

// --- formatEnvelope: the single heading-format site ---

test('formatEnvelope: composes the canonical heading line', () => {
  const line = formatEnvelope({
    date: '2026-08-12',
    agent: 'testagent',
    feature: 'cli',
    n: 7,
    phase: 'build',
    title: 'log stamper seam',
  });
  assert.equal(line, '## [2026-08-12] testagent cli.7 | build — log stamper seam');
});

test('formatEnvelope -> parseSessionLog: round-trip property for exotic-but-legal titles', () => {
  const exoticTitles = [
    'plain title',
    'title with an em-dash — inside it',
    'title, with; punctuation! and (parens)',
    'title with a pipe | character',
    'ünïcödé tïtlé wïth áccénts',
    'trailing spaces do not exist here but tabs\tdo',
    'a very long title '.repeat(4).trim(),
  ];
  for (const title of exoticTitles) {
    const fields = {
      date: '2026-08-12',
      agent: 'claude',
      feature: 'roundtrip',
      n: 3,
      phase: 'review',
      title,
    };
    const heading = formatEnvelope(fields);
    const [entry] = parseSessionLog(`${heading}\nSTATUS: complete\n`);
    assert.ok(entry, `must parse heading for title: ${title}`);
    assert.equal(entry.date, fields.date);
    assert.equal(entry.agent, fields.agent);
    assert.equal(entry.feature, fields.feature);
    assert.equal(entry.n, fields.n);
    assert.equal(entry.phase, fields.phase);
    assert.equal(entry.title, fields.title);
  }
});

// --- ROTATION_LINES / countLines: the log-command rotation seam ---

test('ROTATION_LINES / countLines: exported from the seam, log-command rotation math', () => {
  assert.equal(ROTATION_LINES, 700);
  assert.equal(SESSION_ARCHIVE_DIR_REF, '.agents/sessions');
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a\r\nb\r\n'), 2);
});

// --- isHeadingLine: the grep unit ---

test('isHeadingLine: matches any /^## \\[/ line, including malformed ones', () => {
  assert.equal(isHeadingLine('## [2026-07-01] claude auth.1 | build — JWT refresh flow'), true);
  assert.equal(isHeadingLine('## [2026-07-01] claude auth.9 | build - hyphen not em-dash'), true);
  assert.equal(isHeadingLine('  ## [2026-07-01] indented'), false);
  assert.equal(isHeadingLine('### deeper heading'), false);
  assert.equal(isHeadingLine('APPROACH: not a heading'), false);
  assert.equal(isHeadingLine(''), false);
});

// --- formatLocalDate: TZ-independent local calendar day ---

test('formatLocalDate: zero-padded YYYY-MM-DD from local date getters', () => {
  const nowMs = new Date(2026, 7, 12, 23, 59).getTime(); // month is 0-indexed: August
  assert.equal(formatLocalDate(nowMs), '2026-08-12');
});

test('formatLocalDate: zero-pads single-digit month and day', () => {
  const nowMs = new Date(2026, 0, 5, 0, 0).getTime(); // Jan 5
  assert.equal(formatLocalDate(nowMs), '2026-01-05');
});

// --- supersededIds: correction and continuation forms ---

test('supersededIds: parses SUPERSEDES body lines into feature.n strings', () => {
  const entries = parseSessionLog(
    '## [2026-08-01] claude cli.5 | build — correction\n' +
      'SUPERSEDES: cli.4 (ghost, >48h)\n' +
      'STATUS: abandoned\n' +
      'NEXT: claude — re-scope\n' +
      '\n' +
      '## [2026-08-02] claude auth.9 | build — continuation\n' +
      'SUPERSEDES: auth.8 (continuation — closes the entry left open above)\n' +
      'STATUS: in-progress\n'
  );
  const ids = supersededIds(entries);
  assert.equal(ids.size, 2);
  assert.ok(ids.has('cli.4'));
  assert.ok(ids.has('auth.8'));
});

test('supersededIds: entries without SUPERSEDES contribute nothing', () => {
  const ids = supersededIds(parseSessionLog(LOG));
  assert.equal(ids.size, 0);
});

test('supersededIds: cross-feature supersede is recorded verbatim (no feature filtering)', () => {
  const entries = parseSessionLog(
    '## [2026-08-01] claude banana.2 | ops — cross-feature correction\n' +
      'SUPERSEDES: continuity-kit.1 (renamed project)\n' +
      'STATUS: complete\n' +
      'NEXT: claude — none\n'
  );
  assert.deepEqual([...supersededIds(entries)], ['continuity-kit.1']);
});

// --- nextN / loadSessionHistory: archive-aware n computation ---

test('loadSessionHistory: active required (throws loadSessionLog message), archives best-effort empty when dir missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(sessionLogPath(dir), LOG);
  const history = loadSessionHistory(dir);
  assert.equal(history.active.length, 3);
  assert.deepEqual(history.archives, []);
});

test('loadSessionHistory: missing active log throws (same as loadSessionLog)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  assert.throws(() => loadSessionHistory(dir), /banana project/);
});

test('loadSessionHistory: reads .agents/sessions/*.log archives, keyed with entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents', 'sessions'), { recursive: true });
  writeFileSync(sessionLogPath(dir), LOG);
  writeFileSync(
    join(dir, '.agents', 'sessions', '2026-Q2.log'),
    '## [2026-04-01] claude auth.0 | build — pre-history\nSTATUS: complete\nNEXT: claude — n/a\n'
  );
  const history = loadSessionHistory(dir);
  assert.equal(history.archives.length, 1);
  assert.equal(history.archives[0].entries.length, 1);
  assert.equal(history.archives[0].entries[0].n, 0);
  assert.match(history.archives[0].file, /2026-Q2\.log$/);
});

test('nextN: max(n)+1 over the active log for a feature', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(sessionLogPath(dir), LOG);
  assert.equal(nextN(dir, 'auth'), 3);
  assert.equal(nextN(dir, 'billing'), 2);
});

test('nextN: unknown feature starts at 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(sessionLogPath(dir), LOG);
  assert.equal(nextN(dir, 'nope'), 1);
});

test('nextN: gaps are not filled (1,2,5 -> 6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    sessionLogPath(dir),
    '## [2026-08-01] claude gappy.1 | build — one\nSTATUS: complete\nNEXT: claude — x\n\n' +
      '## [2026-08-02] claude gappy.2 | build — two\nSTATUS: complete\nNEXT: claude — x\n\n' +
      '## [2026-08-03] claude gappy.5 | build — five\nSTATUS: in-progress\n'
  );
  assert.equal(nextN(dir, 'gappy'), 6);
});

test('nextN: archive-aware — archive n beats a lower active max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'banana-sessionlog-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents', 'sessions'), { recursive: true });
  writeFileSync(
    sessionLogPath(dir),
    '## [2026-08-01] claude cli.1 | build — active only\nSTATUS: complete\nNEXT: claude — x\n'
  );
  writeFileSync(
    join(dir, '.agents', 'sessions', '2026-Q1.log'),
    '## [2026-02-01] claude cli.9 | build — archived\nSTATUS: complete\nNEXT: claude — x\n'
  );
  assert.equal(nextN(dir, 'cli'), 10);
});
