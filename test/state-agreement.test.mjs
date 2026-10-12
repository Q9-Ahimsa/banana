// Agreement tests (ticket cli-23, Lane I): the lint WARNs (lib/state.mjs) and
// the `banana state archive` clock gates (lib/state-archive.mjs) must agree on
// the same page — the day lint starts WARNing a line is the day the gate lets
// it move, and the day before neither does. Also pins the canon's waiting-form
// example to `isWaitingThread`. All fixtures are synthetic; sandbox temp dirs
// only — never the real home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWaitingThread, lintGlobalState } from '../lib/state.mjs';
import { runStateArchive } from '../lib/state-archive.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'banana-state-agreement-'));
  tempDirs.push(dir);
  return dir;
}

// Local-date components, so formatLocalDate(LOCAL_NOW) === '2026-10-01' in
// every timezone — the same day as the page's newest Active stamp.
const LOCAL_NOW = new Date(2026, 9, 1, 12, 0, 0).getTime();

/** Collapse runs of whitespace so assertions survive source-line wrapping. */
function flatten(/** @type {string} */ text) {
  return text.replace(/\s+/g, ' ');
}

/**
 * Write a target project STATE.md at an arbitrary absolute path (parent
 * dirs created as needed) — for pointer-resolution fixtures.
 * @param {string} path
 * @param {string | null} asOfDate null = keep the bootstrap placeholder (undated)
 */
function makeTargetState(path, asOfDate) {
  mkdirSync(dirname(path), { recursive: true });
  const text =
    asOfDate === null
      ? '# STATE — target\n> Projection of LOGBOOK.md as of (date) (through none). Logbook wins\n'
      : `# STATE — target\n> Projection of LOGBOOK.md as of ${asOfDate} (through target.1). Logbook wins\n`;
  writeFileSync(path, text, 'utf8');
}

const WIDGET_LINE = '- **widget** (as of 2026-10-01) — building the thing → `~/projects/widget/STATE.md`';
const ALPHA_LINE = (/** @type {string} */ stamp) =>
  `- **alpha** (as of ${stamp}) — building the thing → \`~/projects/alpha/STATE.md\``;
const PLACEHOLDER_BACKLOG = '- testagent — ship the next slice (queued 2026-10-01)';
const PLACEHOLDER_WATCH = '- an assumption needing validation (validate-by: 2026-12-01)';
const PLACEHOLDER_CLOSED = '- **gizmo** (closed 2026-10-01) — shipped → `~/projects/gizmo/STATE.md`';

/**
 * A full four-section global page. The fresh widget thread keeps the newest
 * Active stamp at 2026-10-01, so the reference date is never the case line.
 * @param {{ active?: string[], backlog?: string[], closed?: string[] }} [opts]
 */
function buildPage({ active = [], backlog = [PLACEHOLDER_BACKLOG], closed = [PLACEHOLDER_CLOSED] } = {}) {
  return [
    '# GLOBAL STATE — cross-project projection',
    '> One page, hard cap. Edit only your own threads; never rewrite the page.',
    '> Chronology lives in project logbooks; this file only answers "what\'s live and',
    '> what\'s queued across everything." Owner: testagent. Protocol:',
    '> `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    WIDGET_LINE,
    ...active,
    '',
    '## Backlog (owned)',
    ...backlog,
    '',
    '## Watch',
    PLACEHOLDER_WATCH,
    '',
    '## Recently closed (context for next session)',
    ...closed,
    '',
  ].join('\n');
}

/**
 * A fresh sandbox home holding `.agents/STATE.md` = pageText, plus target
 * project pages for the pointers the fixtures use.
 * @param {string} pageText
 * @param {{ alphaAsOf?: string }} [opts]
 */
function makeHome(pageText, { alphaAsOf = '2026-09-01' } = {}) {
  const home = sandbox();
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'STATE.md'), pageText, 'utf8');
  makeTargetState(join(home, 'projects', 'widget', 'STATE.md'), '2026-10-01');
  makeTargetState(join(home, 'projects', 'alpha', 'STATE.md'), alphaAsOf);
  makeTargetState(join(home, 'projects', 'gizmo', 'STATE.md'), '2026-10-01');
  return {
    home,
    pagePath: join(home, '.agents', 'STATE.md'),
    archivePath: join(home, '.agents', 'STATE-archive.md'),
  };
}

/**
 * @param {string} home
 * @param {Partial<import('../lib/state.mjs').StateArchiveFlags>} flagsOverride
 */
async function archive(home, flagsOverride) {
  /** @type {import('../lib/state.mjs').StateArchiveFlags} */
  const flags = {
    verb: 'archive',
    global: true,
    match: '',
    reason: 'removed',
    tag: 'testagent',
    dryRun: false,
    ...flagsOverride,
  };
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const io = { out: (/** @type {string} */ l = '') => out.push(l), err: (/** @type {string} */ l = '') => err.push(l) };
  const result = await runStateArchive(flags, { home, now: LOCAL_NOW, io });
  return { code: result.code, out, err };
}

/** @param {string} pageText @param {string} home */
function lintTypes(pageText, home) {
  return lintGlobalState(pageText, { home }).map((f) => f.type);
}

/**
 * One boundary case: lint and archive must give the same verdict.
 * @param {import('node:test').TestContext} t
 * @param {object} c
 * @param {string} c.page
 * @param {string} c.findingType
 * @param {string} c.match
 * @param {'expired' | 'inactive' | 'dormant'} c.reason
 * @param {boolean} c.moves
 * @param {string} [c.alphaAsOf]
 */
async function assertAgreement(t, { page, findingType, match, reason, moves, alphaAsOf }) {
  const { home, pagePath, archivePath } = makeHome(page, alphaAsOf === undefined ? {} : { alphaAsOf });
  const types = lintTypes(page, home);
  assert.equal(types.includes(findingType), moves, `lint ${findingType}: ${JSON.stringify(types)}`);
  const result = await archive(home, { match, reason });
  if (moves) {
    assert.equal(result.code, 0, `archive should proceed: ${result.err.join(' | ')}`);
    assert.ok(existsSync(archivePath), 'archive file written');
    assert.ok(!readFileSync(pagePath, 'utf8').includes(match), 'matched line left the page');
  } else {
    assert.equal(result.code, 2, 'archive should refuse');
    assert.match(result.err.join('\n'), new RegExp(`not yet ${reason}`));
    assert.ok(!existsSync(archivePath), 'nothing archived');
    assert.ok(readFileSync(pagePath, 'utf8').includes(match), 'page untouched');
  }
}

// =====================================================================
// Clock gates: lint WARN day === archive gate opens
// =====================================================================

test('lint and archive agree: dormant at 22 days (queued 2026-09-09) WARNs backlog-dormant and archives', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ backlog: ['- testagent — sweep the board (queued 2026-09-09)'] }),
    findingType: 'backlog-dormant',
    match: 'sweep the board',
    reason: 'dormant',
    moves: true,
  });
});

test('lint and archive agree: not dormant at 21 days (queued 2026-09-10) — no WARN, gate refuses', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ backlog: ['- testagent — sweep the board (queued 2026-09-10)'] }),
    findingType: 'backlog-dormant',
    match: 'sweep the board',
    reason: 'dormant',
    moves: false,
  });
});

test('lint and archive agree: inactive at 15 days (as of 2026-09-16) WARNs thread-inactive and archives', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ active: [ALPHA_LINE('2026-09-16')] }),
    findingType: 'thread-inactive',
    match: '**alpha**',
    reason: 'inactive',
    moves: true,
  });
});

test('lint and archive agree: not inactive at 14 days (as of 2026-09-17) — no WARN, gate refuses', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ active: [ALPHA_LINE('2026-09-17')] }),
    findingType: 'thread-inactive',
    match: '**alpha**',
    reason: 'inactive',
    moves: false,
  });
});

test('lint and archive agree: expired at 8 days (closed 2026-09-23) WARNs closed-expired and archives', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ closed: [PLACEHOLDER_CLOSED, '- **gadget** (closed 2026-09-23) — shipped → `~/projects/gizmo/STATE.md`'] }),
    findingType: 'closed-expired',
    match: '**gadget**',
    reason: 'expired',
    moves: true,
  });
});

test('lint and archive agree: not expired at 7 days (closed 2026-09-24) — no WARN, gate refuses', async (t) => {
  await assertAgreement(t, {
    page: buildPage({ closed: [PLACEHOLDER_CLOSED, '- **gadget** (closed 2026-09-24) — shipped → `~/projects/gizmo/STATE.md`'] }),
    findingType: 'closed-expired',
    match: '**gadget**',
    reason: 'expired',
    moves: false,
  });
});

test('lint and archive agree: a stale thread (project page newer) is thread-stale, not thread-inactive, and the gate refuses it as stale', async () => {
  const page = buildPage({ active: [ALPHA_LINE('2026-09-01')] });
  const { home, pagePath, archivePath } = makeHome(page, { alphaAsOf: '2026-09-05' });
  const types = lintTypes(page, home);
  assert.ok(types.includes('thread-stale'), JSON.stringify(types));
  assert.ok(!types.includes('thread-inactive'), JSON.stringify(types));
  const result = await archive(home, { match: '**alpha**', reason: 'inactive' });
  assert.equal(result.code, 2);
  assert.match(result.err.join('\n'), /project page is newer than its \(as of 2026-09-01\) stamp \(thread-stale\)/);
  assert.match(result.err.join('\n'), /refresh the stamp instead of archiving it/);
  assert.ok(!existsSync(archivePath), 'nothing archived');
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

// =====================================================================
// Canon <-> code: the waiting-form example in CONTINUITY.md
// =====================================================================

test('canon waiting-form example is a waiting thread to isWaitingThread; (As of …) is not', () => {
  const flat = flatten(readFileSync(join(KIT_ROOT, 'canon', 'CONTINUITY.md'), 'utf8'));
  const match = /`(\*\*name\*\* \(as of YYYY-MM-DD\) — waiting on \{who\}: \{the ask\} → pointer)`/.exec(flat);
  assert.ok(match, 'CONTINUITY.md no longer carries the literal waiting-form example');
  const line =
    '- ' +
    match[1]
      .replace('**name**', '**widget**')
      .replace('YYYY-MM-DD', '2026-10-01')
      .replace('{who}', 'owner')
      .replace('{the ask}', 'review the notes')
      .replace('pointer', '`~/projects/alpha/STATE.md`');
  assert.equal(
    line,
    '- **widget** (as of 2026-10-01) — waiting on owner: review the notes → `~/projects/alpha/STATE.md`',
  );
  assert.equal(isWaitingThread(line), true);
  assert.equal(isWaitingThread(line.replace('(as of', '(As of')), false);
});
