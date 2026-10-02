// `banana state archive` (ticket #20, Lane B): moves — or, for `trimmed`,
// copies — exactly one matched top-level bullet off the global page into
// the append-only STATE-archive.md. Covers parseStateArgs's archive-shaped
// branch (lib/state.mjs — physically extended there, tested here per the
// ticket's lane split) and lib/state-archive.mjs's runStateArchive. All
// fixtures are synthetic (no real project names/people/paths). Sandbox temp
// dirs only — never the real home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStateArgs, prepareText, topLevelBullets } from '../lib/state.mjs';
import { runStateArchive } from '../lib/state-archive.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pinned as LITERAL text, never the module's own ARCHIVE_HEADER_LINES
// export (Lane 2 test requirement) — a typo in the module's constant must
// still fail this test, not silently agree with itself. #20c E6: names the
// one exception to "append-only" — a pasted secret is deleted outright.
const ARCHIVE_HEADER_TEXT =
  '# GLOBAL STATE — archive\n' +
  '> Append-only — except a pasted secret: delete it here too, on sight. Lines moved off\n' +
  '> ~/.agents/STATE.md (or the long form of trimmed ones), verbatim, newest last. Never\n' +
  '> loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md';

/** @type {string[]} */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** @param {import('node:test').TestContext} t */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-state-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// LOCAL_NOW built from local-date components (same pattern as
// test/log.test.mjs's LOCAL_NOW), so formatLocalDate(LOCAL_NOW) === TODAY on
// every machine's timezone.
const LOCAL_NOW = new Date(2026, 9, 1, 12, 0, 0).getTime();
const TODAY = '2026-10-01';

/**
 * The real, shipped placeholder bullet for a global section — read from the
 * template at test time (never hardcoded), so this file never pins Lane A's
 * (possibly-changing) Recently closed placeholder text or drifts from
 * whatever any section's placeholder actually says.
 * @param {string} name
 * @returns {string}
 */
function templatePlaceholder(name) {
  const raw = readFileSync(join(KIT_ROOT, 'templates', 'global-STATE.md'), 'utf8');
  return topLevelBullets(prepareText(raw), name)[0];
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.active]
 * @param {string[]} [opts.backlog]
 * @param {string[]} [opts.watch]
 * @param {string[]} [opts.closed]
 * @param {string} [opts.eol]
 */
function buildPage(opts = {}) {
  const {
    active = ['- **gizmo** (as of 2026-08-01) — building the thing → `~/projects/gizmo/STATE.md`'],
    backlog = ['- testagent — ship the next slice'],
    watch = [templatePlaceholder('Watch')],
    closed = [templatePlaceholder('Recently closed (context for next session)')],
    eol = '\n',
  } = opts;
  const lines = [
    '# GLOBAL STATE — cross-project projection',
    "> One page, hard cap. Edit only your own threads; never rewrite the page.",
    '> Chronology lives in project logbooks; this file only answers "what\'s live and',
    '> what\'s queued across everything." Owner: testagent. Protocol:',
    '> `~/.agents/canon/CONTINUITY.md`.',
    '',
    '## Active threads',
    ...active,
    '',
    '## Backlog (owned)',
    ...backlog,
    '',
    '## Watch',
    ...watch,
    '',
    '## Recently closed (context for next session)',
    ...closed,
    '',
  ];
  return lines.join(eol);
}

/**
 * A global page with GENUINELY mixed line endings, hand-built (never via
 * `buildPage`'s single `eol`): the two archivable Backlog bullets end
 * differently from each other too (#20c C42) — a byte-exact assertion
 * against this fixture can tell "every byte outside the touched line is
 * untouched" apart from "the write path normalized everything to one
 * ending," which a uniform-ending fixture cannot.
 * @returns {string}
 */
function buildMixedPage() {
  return [
    '# GLOBAL STATE — cross-project projection\r\n',
    "> One page, hard cap. Edit only your own threads; never rewrite the page.\n",
    '> Chronology lives in project logbooks; this file only answers "what\'s live and\r\n',
    '> what\'s queued across everything." Owner: testagent. Protocol:\n',
    '> `~/.agents/canon/CONTINUITY.md`.\r\n',
    '\n',
    '## Active threads\r\n',
    '- (one line per in-flight project: **name** (as of YYYY-MM-DD) — status → pointer to its STATE.md)\n',
    '\r\n',
    '## Backlog (owned)\n',
    '- testagent — ship the next slice\r\n',
    '- ahimsa — review the shipped slice\n',
    '\r\n',
    '## Watch\n',
    '- (assumptions and deadlines needing attention, each with a validate-by date)\r\n',
    '\n',
    '## Recently closed (context for next session)\r\n',
    '- (last few finished threads, one line each, with pointers)\n',
    '\n',
  ].join('');
}

/**
 * @param {import('node:test').TestContext} t
 * @param {string} pageText
 * @returns {{ home: string, pagePath: string, archivePath: string }}
 */
function makeHome(t, pageText) {
  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'STATE.md'), pageText, 'utf8');
  return {
    home,
    pagePath: join(home, '.agents', 'STATE.md'),
    archivePath: join(home, '.agents', 'STATE-archive.md'),
  };
}

/**
 * Any leftover temp-file name (substring `.tmp-`, the atomic-write seam's
 * own naming) in `home`'s `.agents` dir — used to assert "the temp file is
 * gone" after a guard/append/rename failure without depending on the exact
 * (randomized) name the module picked.
 * @param {string} home
 * @returns {string[]}
 */
function tmpLeftovers(home) {
  return readdirSync(join(home, '.agents')).filter((f) => f.includes('.tmp-'));
}

function makeIo() {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  return {
    out: (/** @type {string} */ l = '') => out.push(l),
    err: (/** @type {string} */ l = '') => err.push(l),
    outLines: out,
    errLines: err,
  };
}

/**
 * @param {string} home
 * @param {Partial<import('../lib/state.mjs').StateArchiveFlags>} flagsOverride
 * @param {{
 *   now?: number,
 *   onBetweenReads?: () => void,
 *   onBeforeGuard2?: () => void,
 *   onBeforeRename?: () => void,
 *   onBeforeTempWrite?: () => void,
 *   renameSyncOverride?: (from: string, to: string) => void,
 *   renameRetryBudgetMs?: number,
 * }} [opts]
 */
async function archive(home, flagsOverride, opts = {}) {
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
  const io = makeIo();
  const deps = { home, now: opts.now ?? LOCAL_NOW, io };
  if (opts.onBetweenReads) deps.onBetweenReads = opts.onBetweenReads;
  if (opts.onBeforeGuard2) deps.onBeforeGuard2 = opts.onBeforeGuard2;
  if (opts.onBeforeRename) deps.onBeforeRename = opts.onBeforeRename;
  if (opts.onBeforeTempWrite) deps.onBeforeTempWrite = opts.onBeforeTempWrite;
  if (opts.renameSyncOverride) deps.renameSyncOverride = opts.renameSyncOverride;
  if (opts.renameRetryBudgetMs !== undefined) deps.renameRetryBudgetMs = opts.renameRetryBudgetMs;
  const result = await runStateArchive(flags, deps);
  return { code: result.code, out: io.outLines, err: io.errLines };
}

// =====================================================================
// parseStateArgs — the archive-shaped branch (physically in lib/state.mjs,
// tested here per the ticket's lane split)
// =====================================================================

test('parseStateArgs archive: missing --global throws naming it', () => {
  assert.throws(() => parseStateArgs(['archive']), /--global is required/);
});

test('parseStateArgs archive: missing --match throws', () => {
  assert.throws(() => parseStateArgs(['archive', '--global']), /--match is required/);
});

test('parseStateArgs archive: missing --reason throws', () => {
  assert.throws(() => parseStateArgs(['archive', '--global', '--match', 'x']), /--reason is required/);
});

test('parseStateArgs archive: unknown --reason value names the vocabulary', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'bogus']),
    /unknown reason 'bogus' \(expected expired\|inactive\|trimmed\|closed\|removed\)/,
  );
});

test('parseStateArgs archive: missing --tag throws', () => {
  assert.throws(
    () => parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'expired']),
    /--tag is required/,
  );
});

test('parseStateArgs archive: a fully-specified invocation parses to the discriminated shape', () => {
  assert.deepEqual(
    parseStateArgs(['archive', '--global', '--match', 'x', '--reason', 'expired', '--tag', 'testagent']),
    { verb: 'archive', global: true, match: 'x', reason: 'expired', tag: 'testagent', dryRun: false },
  );
});

test('parseStateArgs archive: --dry-run sets dryRun true', () => {
  const flags = parseStateArgs([
    'archive',
    '--global',
    '--match',
    'x',
    '--reason',
    'closed',
    '--tag',
    'testagent',
    '--dry-run',
  ]);
  assert.ok(flags.verb === 'archive' && flags.dryRun === true);
});

test('parseStateArgs archive: unknown flag is rejected', () => {
  assert.throws(() => parseStateArgs(['archive', '--bogus']), /unknown option '--bogus'/);
});

test('parseStateArgs archive: a valued flag with no following value throws', () => {
  assert.throws(() => parseStateArgs(['archive', '--global', '--match']), /--match requires a value/);
});

test('parseStateArgs: `lint`/unknown-verb vocabulary names both verbs truthfully (integration fix, cli-20)', () => {
  // Pinned (updated) alongside test/state.test.mjs/test/bin.e2e.test.mjs:
  // 'archive' is a real STATE_VERBS member now, so the vocabulary text
  // names it instead of pinning the stale pre-#20 "(expected lint)" wording.
  assert.throws(() => parseStateArgs(['frobnicate']), /unknown state verb 'frobnicate' \(expected lint\|archive\)/);
});

// =====================================================================
// runStateArchive
// =====================================================================

test('runStateArchive: move removes exactly the matched bullet and nothing else (byte-exact)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expectedPage = page.replace('- testagent — ship the next slice\n', '');
  assert.equal(readFileSync(pagePath, 'utf8'), expectedPage);
  assert.ok(readFileSync(archivePath, 'utf8').includes('- testagent — ship the next slice'));
});

test('runStateArchive: `trimmed` leaves the page byte-identical, archive still gets the record', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'review the shipped slice', reason: 'trimmed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  assert.equal(readFileSync(pagePath, 'utf8'), page);
  assert.ok(readFileSync(archivePath, 'utf8').includes('- ahimsa — review the shipped slice'));
  assert.ok(result.out.some((l) => l.includes('was not modified')));
});

test('runStateArchive: record format is exact — header once, record heading + bullet, one trailing blank line', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);

  // #20c item 2: `closed` only applies to an Active-threads bullet — this
  // test is about the RECORD'S byte format, not reason semantics, so it
  // uses `removed`, which has no section restriction.
  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expected =
    ARCHIVE_HEADER_TEXT +
    '\n\n' +
    `## [${TODAY}] claude — removed · Backlog (owned)\n` +
    '- testagent — ship the next slice\n\n';
  assert.equal(readFileSync(archivePath, 'utf8'), expected);
});

test('runStateArchive: archive is created with the header, then appended (no duplicate header, one blank line between records)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
  });
  const { home, archivePath } = makeHome(t, page);

  const r1 = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(r1.code, 0, `err: ${r1.err.join('\n')}`);
  const afterFirst = readFileSync(archivePath, 'utf8');
  assert.equal(afterFirst, ARCHIVE_HEADER_TEXT + '\n\n' +
    `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`);

  // #20c item 2: `closed` only applies to an Active-threads bullet — this
  // test is about header/blank-line mechanics across two appends, not
  // reason semantics, so both calls use `removed`.
  const r2 = await archive(home, { match: 'review the shipped slice', reason: 'removed', tag: 'claude' });
  assert.equal(r2.code, 0, `err: ${r2.err.join('\n')}`);
  const afterSecond = readFileSync(archivePath, 'utf8');
  assert.equal(
    afterSecond,
    afterFirst + `## [${TODAY}] claude — removed · Backlog (owned)\n- ahimsa — review the shipped slice\n\n`,
  );
  // Exactly one header, exactly one blank line between the two records.
  assert.equal(afterSecond.split('# GLOBAL STATE — archive').length - 1, 1);
});

test('runStateArchive: a CRLF page stays CRLF (plain removal and sole-bullet placeholder-insertion)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
    watch: ['- an assumption needing validation (validate-by: 2026-09-01)'],
    eol: '\r\n',
  });
  const { home, pagePath } = makeHome(t, page);

  const r1 = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(r1.code, 0, `err: ${r1.err.join('\n')}`);
  let text = readFileSync(pagePath, 'utf8');
  assert.ok(text.includes('\r\n'), 'still CRLF after a plain removal');
  assert.ok(!/(?<!\r)\n/.test(text), 'no bare LF introduced');

  const r2 = await archive(home, { match: 'an assumption needing validation', reason: 'removed' });
  assert.equal(r2.code, 0, `err: ${r2.err.join('\n')}`);
  text = readFileSync(pagePath, 'utf8');
  assert.ok(!/(?<!\r)\n/.test(text), 'no bare LF introduced by the placeholder insertion either');
  assert.ok(text.includes(templatePlaceholder('Watch') + '\r\n'));
});

test('runStateArchive: zero matches exits 2 with nothing written', async (t) => {
  const page = buildPage();
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'no-such-substring-anywhere' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('no line matches')));
  assert.equal(readFileSync(pagePath, 'utf8'), page);
  assert.ok(!existsSync(archivePath));
});

test('runStateArchive: multiple matches exits 2, lists every candidate, nothing written', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — shared-term in backlog'],
    watch: ['- shared-term also in watch (validate-by: 2026-09-01)'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shared-term' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('matches 2 lines')));
  assert.ok(result.err.some((l) => l.includes('Backlog (owned)')));
  assert.ok(result.err.some((l) => l.includes('Watch')));
  assert.equal(readFileSync(pagePath, 'utf8'), page);
  assert.ok(!existsSync(archivePath));
});

test('runStateArchive: a placeholder bullet never matches, even when --match targets its own text', async (t) => {
  const placeholderText = templatePlaceholder('Watch');
  const page = buildPage({ watch: [placeholderText] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const substring = placeholderText.slice(2, 20);
  const result = await archive(home, { match: substring });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('no line matches')));
  assert.equal(readFileSync(pagePath, 'utf8'), page);
  assert.ok(!existsSync(archivePath));
});

test('runStateArchive: the page-changed-between-reads guard aborts with nothing written', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const mutatedByOther = page.replace('ship the next slice', 'ship a DIFFERENT slice entirely');

  const result = await archive(home, { match: 'ship the next slice' }, {
    onBetweenReads: () => writeFileSync(pagePath, mutatedByOther, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed between read and write')));
  assert.equal(readFileSync(pagePath, 'utf8'), mutatedByOther, 'the concurrent edit survives untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: removing the last bullet in a section inserts that section\'s placeholder', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  // #20b review item 4: the re-inserted placeholder has the page's own
  // header owner ("testagent", buildPage's default) substituted in, same as
  // a freshly-bootstrapped page would show — not the raw template's literal
  // __OWNER__ token.
  const expectedPlaceholder = templatePlaceholder('Backlog (owned)').replaceAll('__OWNER__', 'testagent');
  const expected = page.replace('- testagent — ship the next slice', expectedPlaceholder);
  assert.equal(readFileSync(pagePath, 'utf8'), expected);
});

test('runStateArchive: placeholder owner substitution uses the real header owner, including a multi-word name', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] }).replace(
    'Owner: testagent.',
    'Owner: Jane Doe.',
  );
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  assert.ok(pageAfter.includes('`Jane Doe — action`'));
  assert.ok(!pageAfter.includes('__OWNER__'));
});

test('runStateArchive: placeholder insertion leaves the literal __OWNER__ token when the header has no Owner line', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] }).replace(
    'Owner: testagent. Protocol:',
    'Protocol:',
  );
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  assert.ok(pageAfter.includes('`__OWNER__ — action`'));
});

// #20b review Decision D1: the global page is one physical line per
// bullet. A matched bullet with continuation lines refuses outright (exit
// 2) instead of guessing how much trailing text belongs to it — the archive
// only ever moves one physical line.
test('runStateArchive: D1 — a matched bullet with continuation lines refuses, exit 2, nothing written', async (t) => {
  const page = buildPage({
    backlog: [
      '- testagent — a wrapped backlog item',
      '  continuation line one',
      '  continuation line two',
      '- ahimsa — a second, plain item',
    ],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  // A continuation line's own text is still not part of the matchable bullet.
  const noMatch = await archive(home, { match: 'continuation line one', reason: 'removed' });
  assert.equal(noMatch.code, 2);
  assert.ok(noMatch.err.some((l) => l.includes('no line matches')));

  const result = await archive(home, { match: 'a wrapped backlog item', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('bullet spans 3 lines; join it into one line first')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: D1 — a bullet with exactly one continuation line spans 2 lines in the refusal', async (t) => {
  const page = buildPage({
    watch: ['- a loose assumption needing validation (validate-by: 2026-09-01)', '  one lazy continuation line'],
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a loose assumption needing validation', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('bullet spans 2 lines; join it into one line first')));
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: --dry-run prints the record and the action line, writes nothing, every line prefixed `dry run — `', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  // #20c item 2: `closed` only applies to an Active-threads bullet; this
  // fixture is Backlog, so `removed`.
  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', dryRun: true });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched under --dry-run');
  assert.ok(!existsSync(archivePath), 'archive untouched under --dry-run');
  // #20b review item 7: dry-run output can never be mistaken for the real
  // success wording — EVERY line it prints carries the prefix.
  assert.ok(result.out.length > 0);
  assert.ok(
    result.out.every((l) => l.startsWith('dry run — ')),
    `not every line prefixed: ${JSON.stringify(result.out)}`,
  );
  assert.ok(result.out.some((l) => l.includes('## [') && l.includes('removed · Backlog (owned)')));
  assert.ok(result.out.some((l) => l.includes('- testagent — ship the next slice')));
  assert.ok(
    result.out.some(
      (l) => l === `dry run — archived (removed): Backlog (owned) · "- testagent — ship the next slice" → ${archivePath}`,
    ),
  );
});

test('runStateArchive: `inactive` also prints a Backlog-line reminder', async (t) => {
  const page = buildPage({
    active: ['- **gizmo** (as of 2026-08-01) — stalled → `~/projects/gizmo/STATE.md`'],
  });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'gizmo', reason: 'inactive' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(result.out.some((l) => l.includes('Backlog (owned)') && l.includes('reminder')));
});

test('runStateArchive: a missing global page exits 2', async (t) => {
  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  const result = await archive(home, { match: 'anything' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('missing or unreadable')));
});

// =====================================================================
// #20b review Decision D1 retires the "archive moves exactly what the lint
// measures" cross-module span-consistency suite that used to live here: the
// lint now measures a bullet's own physical line only (`line-over-limit`)
// and WARNs separately when it has continuation lines (`bullet-wrapped`,
// lib/state.mjs); the archive's own matching D1 contract (single physical
// line, refuse with exit 2 on continuation lines) is lane 2's job, not this
// lane's. Removed rather than rewritten — the premise it tested (one shared
// multi-line "bullet extent" between lint and archive) no longer exists.
// The one invariant from that old suite that is STILL true under the new
// contract — a bullet-looking line inside a fenced code block is never a
// real bullet, to either side — is kept as its own small test below.
// =====================================================================

test('runStateArchive: a bullet-looking line inside a fenced code block is never matched', async (t) => {
  const page = buildPage({
    watch: [
      '- a real bullet, nothing special',
      '```',
      '- fenced-marker: looks like a bullet but lives inside a fenced code block',
      '```',
    ],
  });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'fenced-marker', dryRun: true });
  assert.equal(result.code, 2, `fenced-marker must not match: ${result.out.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('no line matches')));
});

// =====================================================================
// #20b review Decision D3 — the clock-aware safety gate. Only `--reason
// expired`/`inactive` read the clock; every other reason is ungated (see the
// existing `removed`/`closed`/`trimmed` tests above, none of which carry a
// stamp at all and all of which already succeed).
// =====================================================================

test('runStateArchive: D3 — `expired` without the line\'s own "(closed ...)" stamp refuses, suggests --reason removed', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing, no stamp yet'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('none found — use --reason removed instead')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 — `expired` not yet past the 7-day limit refuses, naming the age and the limit', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-28)'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('is only 3 day(s) before today (2026-10-01) — not yet expired (needs more than 7)')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 — `expired` past the 7-day limit proceeds', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-01)'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('shipped the thing'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('shipped the thing'));
});

test('runStateArchive: D3 — `inactive` without the line\'s own "(as of ...)" stamp refuses, suggests --reason removed', async (t) => {
  const page = buildPage({ active: ['- **widget** — building it → `~/projects/widget/STATE.md`'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'building it', reason: 'inactive' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('none found — use --reason removed instead')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 — `inactive` not yet past the 30-day limit refuses, naming the age and the limit', async (t) => {
  const page = buildPage({
    active: ['- **widget** (as of 2026-09-20) — building it → `~/projects/widget/STATE.md`'],
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'building it', reason: 'inactive' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('is only 11 day(s) before today (2026-10-01) — not yet inactive (needs more than 30)')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 — a future-dated stamp ANYWHERE on the page refuses and names it, even when the matched line\'s own stamp would otherwise pass', async (t) => {
  const page = buildPage({
    active: [
      '- **gizmo** (as of 2026-08-01) — stalled → `~/projects/gizmo/STATE.md`',
      '- **mistyped** (as of 2026-11-01) — a fat-fingered future stamp → `~/projects/mistyped/STATE.md`',
    ],
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'gizmo', reason: 'inactive' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('dated after today (2026-10-01)') && l.includes('2026-11-01') && l.includes('fix that stamp first')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 gate never fires for a non-expired/inactive reason, even with a future stamp elsewhere and no stamp on the match', async (t) => {
  const page = buildPage({
    active: ['- **mistyped** (as of 2026-11-01) — a fat-fingered future stamp → `~/projects/mistyped/STATE.md`'],
    backlog: ['- testagent — ship the next slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('ship the next slice'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'));
});

// =====================================================================
// #20b review item 2 — atomic write and the two re-read guards.
// =====================================================================

test('runStateArchive: a failed append leaves the page untouched and the temp file cleaned up', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  // Pre-creating the archive PATH as a directory makes any attempt to read
  // or write it as a file fail — simulates "the append step fails" without
  // depending on a real, platform-specific disk error.
  mkdirSync(archivePath);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not be read')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: a failed rename leaves the page untouched, the archive already holding the copy, and the temp file cleaned up', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBeforeRename: () => {
      throw new Error('simulated rename failure');
    },
  });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not rename the temp file over')), `err: ${result.err.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('already holds a copy of the line')));
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched — the rename never happened');
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'), 'the archive already has the copy');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: guard 1 catches a SAME-LENGTH concurrent edit (not just a length change)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const sameLengthEdit = page.replace('next slice', 'next SLICE'); // identical length, different bytes

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBetweenReads: () => writeFileSync(pagePath, sameLengthEdit, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed between read and write')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), sameLengthEdit, 'the concurrent edit survives untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: guard 2 catches a SAME-LENGTH edit made after the archive append but before the rename', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const sameLengthEdit = page.replace('next slice', 'next SLICE');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBeforeGuard2: () => writeFileSync(pagePath, sameLengthEdit, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed after archiving')), `err: ${result.err.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('already holds a copy of the line')));
  assert.equal(readFileSync(pagePath, 'utf8'), sameLengthEdit, 'the concurrent edit survives — never renamed over');
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'), 'the archive already has the copy');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

// =====================================================================
// #20b review item 3 — invalid UTF-8 on the page refuses outright.
// =====================================================================

test('runStateArchive: bytes that do not round-trip through UTF-8 refuse, exit 2, nothing written', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice'],
    watch: ['- a marker sits here XXMARKERXX (validate-by: 2026-09-01)'],
  });
  const buf = Buffer.from(page, 'utf8');
  const marker = Buffer.from('XXMARKERXX', 'utf8');
  const idx = buf.indexOf(marker);
  assert.notEqual(idx, -1, 'fixture marker must be present');
  // A lone continuation byte (0x80) is never valid UTF-8 on its own.
  const corrupted = Buffer.concat([buf.subarray(0, idx), Buffer.from([0x80]), buf.subarray(idx + marker.length)]);

  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  const pagePath = join(home, '.agents', 'STATE.md');
  const archivePath = join(home, '.agents', 'STATE-archive.md');
  writeFileSync(pagePath, corrupted);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('not valid UTF-8')), `err: ${result.err.join('\n')}`);
  assert.ok(readFileSync(pagePath).equals(corrupted), 'page untouched, byte-for-byte');
  assert.ok(!existsSync(archivePath), 'nothing written');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

// =====================================================================
// #20b review item 5 — archive append edge cases.
// =====================================================================

test('runStateArchive: an existing-but-EMPTY archive file gets the header first, same as a missing one', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  writeFileSync(archivePath, '', 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    ARCHIVE_HEADER_TEXT + '\n\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
  );
});

// #20c C8: a prior record with NO final newline at all gets TWO
// terminators inserted before the new record — one to end its own last
// line, one to open the blank-line separator every record is supposed to
// have (the pre-fix code added only one, gluing the new heading directly
// under the previous record's last line with no blank line between them).
test('runStateArchive: an existing archive with NO trailing newline gets a full blank-line separator inserted (#20c C8)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  const priorNoTrailingNewline =
    ARCHIVE_HEADER_TEXT + '\n\n' + '## [2026-09-01] testagent — removed · Watch\n- an old archived line';
  writeFileSync(archivePath, priorNoTrailingNewline, 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    priorNoTrailingNewline + '\n\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
  );
});

// #20c C8/H62: a prior record that already ends in exactly ONE newline
// (terminated, but no blank line yet) is the shape that distinguishes
// "add one more EOL" from "add two" — no existing fixture before this one
// ended this way (every kit-written archive ends '\n\n', and the no-newline
// case above ends with zero). Mutating the trailing-count math to
// `endsWith('\n')` instead of the 3-way 0/1/2 count must turn THIS test red
// without necessarily breaking the no-newline test above.
test('runStateArchive: an existing archive ending in exactly ONE newline gets exactly one more (#20c H62)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  const priorOneTrailingNewline =
    ARCHIVE_HEADER_TEXT + '\n\n' + '## [2026-09-01] testagent — removed · Watch\n- an old archived line\n';
  writeFileSync(archivePath, priorOneTrailingNewline, 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    priorOneTrailingNewline + '\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
  );
});

test('runStateArchive: the archive keeps its OWN line ending even when the page uses a different one', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'], eol: '\n' });
  const { home, archivePath } = makeHome(t, page);
  const priorCRLF =
    ARCHIVE_HEADER_TEXT.replace(/\n/g, '\r\n') +
    '\r\n\r\n' +
    '## [2026-09-01] testagent — removed · Watch\r\n- an old archived line\r\n\r\n';
  writeFileSync(archivePath, priorCRLF, 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    priorCRLF + `## [${TODAY}] claude — removed · Backlog (owned)\r\n- testagent — ship the next slice\r\n\r\n`,
  );
});

// =====================================================================
// Byte-preservation on lone-CR and BOM pages.
// =====================================================================

test('runStateArchive: a lone-CR (old-Mac) page stays lone-CR — plain removal', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
    eol: '\r',
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const text = readFileSync(pagePath, 'utf8');
  assert.ok(!text.includes('\n'), 'no LF introduced');
  assert.ok(text.includes('\r'), 'still carries its lone-CR terminators');
  assert.equal(text, page.replace('- testagent — ship the next slice\r', ''));
});

test('runStateArchive: a lone-CR (old-Mac) page stays lone-CR — sole-bullet placeholder insertion', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice'],
    eol: '\r',
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const text = readFileSync(pagePath, 'utf8');
  assert.ok(!text.includes('\n'), 'no LF introduced by the placeholder insertion either');
  const expectedPlaceholder = templatePlaceholder('Backlog (owned)').replaceAll('__OWNER__', 'testagent');
  assert.ok(text.includes(expectedPlaceholder + '\r'), 'the placeholder line keeps the page\'s own lone-CR terminator');
});

test('runStateArchive: a leading BOM elsewhere on the page survives untouched (byte-exact)', async (t) => {
  const page = '﻿' + buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const text = readFileSync(pagePath, 'utf8');
  assert.ok(text.startsWith('﻿# GLOBAL STATE'), 'BOM still sits exactly where it was');
  assert.equal(text, page.replace('- testagent — ship the next slice\n', ''));
});

// =====================================================================
// #20b review item 6 — byte-identical duplicates move the first occurrence.
// =====================================================================

test('runStateArchive: several byte-identical matches move the first occurrence and say so', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — a shared duplicate sentinel wording', '- ahimsa — an unrelated backlog item'],
    watch: ['- testagent — a shared duplicate sentinel wording'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a shared duplicate sentinel wording', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(
    result.out.some((l) => l.includes('matched 2 byte-identical lines') && l.includes('archiving the first occurrence')),
    `out: ${result.out.join('\n')}`,
  );

  const pageAfter = readFileSync(pagePath, 'utf8');
  // Backlog (owned) precedes Watch in REQUIRED_GLOBAL_SECTIONS — its copy is
  // the "first occurrence" and is the one that's gone; Watch's survives.
  const backlogSection = pageAfter.split('## Backlog (owned)')[1].split('## Watch')[0];
  const watchSection = pageAfter.split('## Watch')[1];
  assert.ok(!backlogSection.includes('a shared duplicate sentinel wording'));
  assert.ok(watchSection.includes('a shared duplicate sentinel wording'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('a shared duplicate sentinel wording'));
});

// =====================================================================
// Section name in the record, for every one of the four sections.
// =====================================================================

test('runStateArchive: the record heading names the exact section the bullet came from, for all four sections', async (t) => {
  const page = buildPage({
    active: ['- **widget** (as of 2026-08-01) — building it → `~/projects/widget/STATE.md`'],
    backlog: ['- testagent — a backlog sentinel item'],
    watch: ['- a watch sentinel assumption (validate-by: 2026-09-01)'],
    closed: ['- **widget** — shipped it (closed 2026-09-01)'],
  });

  /** @type {[string, string][]} */
  const cases = [
    ['widget** (as of', 'Active threads'],
    ['a backlog sentinel item', 'Backlog (owned)'],
    ['a watch sentinel assumption', 'Watch'],
    ['shipped it', 'Recently closed (context for next session)'],
  ];
  for (const [match, section] of cases) {
    const { home, archivePath } = makeHome(t, page);
    const result = await archive(home, { match, reason: 'removed' });
    assert.equal(result.code, 0, `${section}: err: ${result.err.join('\n')}`);
    assert.ok(
      readFileSync(archivePath, 'utf8').includes(`· ${section}\n`),
      `${section}: archive did not name the section: ${readFileSync(archivePath, 'utf8')}`,
    );
  }
});

// =====================================================================
// Trailing whitespace preserved verbatim.
// =====================================================================

test('runStateArchive: trailing whitespace on the matched line is preserved verbatim in the archive', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice   '] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('ship the next slice'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('- testagent — ship the next slice   \n'));
});

// =====================================================================
// Record date from injected `now`, pinned at a UTC-midnight boundary.
// =====================================================================

// #20c C60/H27: the #20b-era version of this test pinned TZ='UTC', under
// which the local calendar day and the UTC calendar day ALWAYS agree — so
// it could never tell `formatLocalDate(now)` (correct) apart from
// `new Date(now).toISOString().slice(0, 10)` (wrong: the UTC day). Asia/Jakarta
// (UTC+7, no daylight saving) genuinely disagrees with UTC at this instant.
test('runStateArchive: the record date is the LOCAL calendar day of injected `now`, pinned where local and UTC genuinely differ (#20c C60/H27)', async (t) => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'Asia/Jakarta';
  t.after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  // 2026-09-30T23:30:00Z is 2026-10-01 06:30 local in Jakarta — the local
  // calendar day is a full day AHEAD of the UTC day at this instant.
  const localDayAheadOfUtcDay = Date.UTC(2026, 8, 30, 23, 30, 0);
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });

  const { home, archivePath } = makeHome(t, page);
  const result = await archive(
    home,
    { match: 'ship the next slice', reason: 'removed' },
    { now: localDayAheadOfUtcDay },
  );
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const archiveText = readFileSync(archivePath, 'utf8');
  assert.ok(archiveText.includes('## [2026-10-01]'), `expected the LOCAL day 2026-10-01: ${archiveText}`);
  assert.ok(!archiveText.includes('## [2026-09-30]'), `must not use the UTC day 2026-09-30: ${archiveText}`);
});

// =====================================================================
// #20c C1/E1 — a matched line that opens or closes a multi-line HTML
// comment is refused outright: archiving just that one physical line would
// corrupt the comment structure around it (orphan a closing `-->`, or
// silently extend an unclosed comment over everything that follows).
// =====================================================================

test('runStateArchive: a bullet that opens a multi-line HTML comment it does not close refuses, exit 2, nothing written (#20c C1/E1)', async (t) => {
  // The line AFTER alpha-watch is shaped like a self-contained comment
  // (`<!-- ... -->`, one open and one close) — read in isolation it nets to
  // blank either way, so `continuationLineCount` (which always starts its
  // own `inComment` tracking at false, never inheriting the bullet line's
  // real unterminated-comment state) already ends the bullet there without
  // counting it: continuationLines is 0, so D1 does NOT fire, and only the
  // comment-boundary check below can catch this.
  const page = buildPage({
    watch: ['- alpha-watch: cache check <!-- owner note', '<!-- resume later -->'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'alpha-watch', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(
    !result.err.some((l) => l.includes('join it into one line first')),
    `must be caught by the comment-boundary check, not D1: ${result.err.join('\n')}`,
  );
  assert.ok(
    result.err.some((l) => l.includes('opens or closes a multi-line HTML comment')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: a bullet that closes a multi-line HTML comment opened on an EARLIER line also refuses (#20c C1/E1)', async (t) => {
  const page = buildPage({
    watch: [
      '- alpha-watch: cache check <!-- unterminated note',
      '-->- beta-watch: looks like a fresh bullet after the close',
    ],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'beta-watch', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('opens or closes a multi-line HTML comment')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

// =====================================================================
// #20c H4 — the archive's own excerpts cut at 60 CODE POINTS (lane L's
// exported `excerpt60`), never a naive UTF-16 `.slice(0, 60)` that can split
// a surrogate pair.
// =====================================================================

test('runStateArchive: the printed excerpt cuts at 60 CODE POINTS, never splitting a surrogate pair (#20c H4)', async (t) => {
  // A single code point (2 UTF-16 units) placed so that a naive
  // `.slice(0, 60)` over UTF-16 units would land ON the high surrogate,
  // producing a dangling lone surrogate instead of the whole emoji.
  const emoji = '\u{1F34C}';
  const bulletText = '-' + ' ' + 'a'.repeat(57) + emoji + 'b'.repeat(20);
  const page = buildPage({ backlog: [bulletText] });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'a'.repeat(10), reason: 'removed', dryRun: true });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expectedExcerpt = Array.from(bulletText).slice(0, 60).join('');
  assert.ok(expectedExcerpt.includes(emoji), 'fixture sanity: the 60-code-point excerpt should include the whole emoji');
  assert.ok(
    result.out.some((l) => l.includes(`"${expectedExcerpt}"`)),
    `expected excerpt "${expectedExcerpt}" not found verbatim in: ${JSON.stringify(result.out)}`,
  );
});

// =====================================================================
// #20c item 2 (closing C37's remaining gap) — a reason that only makes
// sense for one section refuses on any other section.
// =====================================================================

test('runStateArchive: `--reason expired` only applies to a Recently-closed bullet (#20c item 2)', async (t) => {
  const page = buildPage({ watch: ['- a watch item that is not a closed thread (validate-by: 2026-09-01)'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a watch item that is not a closed thread', reason: 'expired' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('only applies to a bullet in "Recently closed') && l.includes('this bullet is in "Watch"')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: `--reason inactive` only applies to an Active-threads bullet (#20c item 2)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — not a thread at all'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'not a thread at all', reason: 'inactive' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('only applies to a bullet in "Active threads"') && l.includes('this bullet is in "Backlog (owned)"')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: `--reason closed` only applies to an Active-threads bullet (#20c item 2)', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-01)'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'closed' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some(
      (l) => l.includes('only applies to a bullet in "Active threads"') && l.includes('this bullet is in "Recently closed'),
    ),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: `trimmed` and `removed` have no section restriction (#20c item 2)', async (t) => {
  const page = buildPage({ watch: ['- a watch item, nothing special (validate-by: 2026-09-01)'] });
  {
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'a watch item', reason: 'removed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  }
  {
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'a watch item', reason: 'trimmed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  }
});

// #20c H16: `--reason closed` is a two-step move — the command reminds the
// caller to add the Recently-closed line by hand, the same way `inactive`
// already reminds about the Backlog line.
test('runStateArchive: `closed` prints a reminder to add the Recently-closed entry (#20c H16)', async (t) => {
  const page = buildPage({
    active: ['- **widget** (as of 2026-08-01) — finishing up → `~/projects/widget/STATE.md`'],
  });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'widget', reason: 'closed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(
    result.out.some((l) => l.includes('reminder:') && l.includes('Recently-closed entry')),
    `out: ${result.out.join('\n')}`,
  );
});

// =====================================================================
// #20c H24/H72 — the REAL append-failure path (appendFileSync itself
// throwing), distinct from the compose-read error the existing "failed
// append" test above actually exercises (its archive path is a directory,
// so composeArchiveAppend's own readFileSync throws EISDIR before
// appendFileSync is ever reached).
// =====================================================================

test('runStateArchive: a REAL append failure (read-only archive, not a compose-read error) leaves the page untouched (#20c H24)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const priorArchive =
    ARCHIVE_HEADER_TEXT + '\n\n' + '## [2026-09-01] testagent — removed · Watch\n- an old archived line\n\n';
  writeFileSync(archivePath, priorArchive, 'utf8');
  chmodSync(archivePath, 0o444);
  // Order-independent of sandbox()'s own rmSync cleanup hook (whichever
  // runs first, the other must not throw): chmod back to writable only if
  // the file (and its directory) still exists.
  t.after(() => {
    try {
      chmodSync(archivePath, 0o666);
    } catch {
      // already removed by the sandbox cleanup — nothing to restore
    }
  });

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not write') && l.includes(archivePath)), `err: ${result.err.join('\n')}`);
  assert.ok(
    !result.err.some((l) => l.includes('could not be read')),
    `must reach the REAL append, not the compose-read error: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.equal(readFileSync(archivePath, 'utf8'), priorArchive, 'archive unchanged — no partial write');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: `trimmed`\'s REAL append failure exits 2, still says "nothing written" (#20c H72)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const priorArchive =
    ARCHIVE_HEADER_TEXT + '\n\n' + '## [2026-09-01] testagent — removed · Watch\n- an old archived line\n\n';
  writeFileSync(archivePath, priorArchive, 'utf8');
  chmodSync(archivePath, 0o444);
  t.after(() => {
    try {
      chmodSync(archivePath, 0o666);
    } catch {
      // already removed by the sandbox cleanup — nothing to restore
    }
  });

  const result = await archive(home, { match: 'review the shipped slice', reason: 'trimmed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not write') && l.includes(archivePath)), `err: ${result.err.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('nothing written')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched — trimmed never touches it anyway');
  assert.equal(readFileSync(archivePath, 'utf8'), priorArchive, 'archive unchanged — no partial write');
});

test('runStateArchive: `trimmed`\'s compose-read error (archive path is a directory) exits 2, never a false success (#20c H72)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  mkdirSync(archivePath);

  const result = await archive(home, { match: 'ship the next slice', reason: 'trimmed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not be read')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

// =====================================================================
// #20c H73 — the atomic write's temp-file-write failure, and both guards'
// page-UNREADABLE (not just mutated) branches, none of which any existing
// test reached.
// =====================================================================

test('runStateArchive: a temp-file write failure leaves nothing written, exit 2 (#20c H73)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBeforeTempWrite: () => {
      throw new Error('simulated disk-full on the temp write');
    },
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not write a temp file')), `err: ${result.err.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('nothing written')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: guard 1 catches the page being DELETED (not just rewritten), temp file cleaned up (#20c H73)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBetweenReads: () => rmSync(pagePath),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('missing or unreadable')), `err: ${result.err.join('\n')}`);
  assert.ok(!existsSync(pagePath), 'the deletion is not undone');
  assert.ok(!existsSync(archivePath), 'nothing appended');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: guard 2 catches the page being DELETED after the archive append, temp file cleaned up (#20c H73)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBeforeGuard2: () => rmSync(pagePath),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('missing or unreadable after archiving')), `err: ${result.err.join('\n')}`);
  assert.ok(result.err.some((l) => l.includes('already holds a copy of the line')));
  assert.ok(!existsSync(pagePath), 'the deletion is not undone');
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'), 'the archive already has the copy');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

// =====================================================================
// #20c H30 (also X1): the SUCCESS-path temp file is gone afterward, and
// never left behind — the pin that also catches the X1 mutation (replacing
// the atomic rename with an in-place `writeFileSync(page, readFileSync(temp))`
// copy leaves the temp file sitting there, since nothing unlinks it).
// =====================================================================

test('runStateArchive: after a SUCCESSFUL move, the temp file is gone — no leftover `.tmp-*` (#20c H30, X1)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file after a successful move');
  assert.ok(existsSync(pagePath));
});

// =====================================================================
// #20c C7/C26 — the archive's own line-ending contract on CREATION: it
// takes the PAGE's dominant ending, exact bytes, for CRLF and lone-CR
// pages (not just LF, which every other creation-side test fixture uses).
// =====================================================================

test('runStateArchive: a CRLF page with no existing archive creates the archive in CRLF, byte-exact (#20c C7/C26)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'], eol: '\r\n' });
  const { home, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expectedArchive =
    ARCHIVE_HEADER_TEXT.replace(/\n/g, '\r\n') +
    '\r\n\r\n' +
    `## [${TODAY}] claude — removed · Backlog (owned)\r\n- testagent — ship the next slice\r\n\r\n`;
  assert.equal(readFileSync(archivePath, 'utf8'), expectedArchive);
});

test('runStateArchive: a lone-CR page with no existing archive creates the archive in lone-CR, byte-exact (#20c C7/C26)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'], eol: '\r' });
  const { home, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expectedArchive =
    ARCHIVE_HEADER_TEXT.replace(/\n/g, '\r') +
    '\r\r' +
    `## [${TODAY}] claude — removed · Backlog (owned)\r- testagent — ship the next slice\r\r`;
  assert.equal(readFileSync(archivePath, 'utf8'), expectedArchive);
});

// #20c H33/C7: the inserted placeholder keeps the REMOVED line's OWN
// terminator, never the page's dominant one, when the two differ.
test('runStateArchive: the inserted placeholder keeps the REMOVED line\'s own terminator on a mixed-ending page (#20c H33/C7)', async (t) => {
  const lfPage = buildPage({ watch: ['- a lone assumption on a CRLF line (validate-by: 2026-09-01)'] });
  const page = lfPage.replace(
    '- a lone assumption on a CRLF line (validate-by: 2026-09-01)\n',
    '- a lone assumption on a CRLF line (validate-by: 2026-09-01)\r\n',
  );
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a lone assumption on a CRLF line', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  const expectedPlaceholder = templatePlaceholder('Watch');
  assert.ok(
    pageAfter.includes(expectedPlaceholder + '\r\n'),
    `placeholder should keep the removed line's own CRLF terminator: ${JSON.stringify(pageAfter)}`,
  );
  const withoutPlaceholderLine = pageAfter.replace(expectedPlaceholder + '\r\n', '');
  assert.ok(!/\r/.test(withoutPlaceholderLine), 'no other CRLF introduced anywhere else on the page');
});

// =====================================================================
// #20c C42 — "no other byte of the page changes" on a GENUINELY mixed-
// ending page (not two uniform halves), with and without a leading BOM.
// =====================================================================

test('runStateArchive: a genuinely MIXED-ending page stays byte-exact outside the touched line — plain removal (#20c C42)', async (t) => {
  const page = buildMixedPage();
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const expected = page.replace('- testagent — ship the next slice\r\n', '');
  assert.equal(readFileSync(pagePath, 'utf8'), expected);
});

test('runStateArchive: a genuinely MIXED-ending page WITH a leading BOM stays byte-exact outside the touched line (#20c C42)', async (t) => {
  const page = '﻿' + buildMixedPage();
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'review the shipped slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  const expected = page.replace('- ahimsa — review the shipped slice\n', '');
  assert.equal(readFileSync(pagePath, 'utf8'), expected);
  assert.ok(readFileSync(pagePath, 'utf8').startsWith('﻿# GLOBAL STATE'));
});

// =====================================================================
// #20c H34 — the "byte-identical duplicates" rule is a STRICT `===`: two
// matches differing only by trailing whitespace are a REAL ambiguity.
// =====================================================================

test('runStateArchive: two matches differing only by trailing whitespace are a REAL ambiguity, not byte-identical duplicates (#20c H34)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — a near duplicate wording task'],
    watch: ['- testagent — a near duplicate wording task '],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a near duplicate wording task', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('matches 2 lines')), `err: ${result.err.join('\n')}`);
  assert.ok(
    !result.err.some((l) => l.includes('byte-identical')),
    `must not be treated as byte-identical: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

// =====================================================================
// #20c H35 — `trimmed`'s OWN re-read guard (a separate code path from the
// removing reasons' guard 1) catches a concurrent edit.
// =====================================================================

test('runStateArchive: `trimmed`\'s own re-read guard catches a concurrent edit (#20c H35)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const mutatedByOther = page.replace('review the shipped slice', 'review a DIFFERENT slice entirely');

  const result = await archive(home, { match: 'review the shipped slice', reason: 'trimmed' }, {
    onBetweenReads: () => writeFileSync(pagePath, mutatedByOther, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed between read and write')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), mutatedByOther, 'the concurrent edit survives untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

// =====================================================================
// #20c C41 — the re-read guards (and `trimmed`'s own guard) catch a
// same-length edit to a DIFFERENT, unmatched line — not just a same-length
// edit to the matched bullet itself.
// =====================================================================

test('runStateArchive: guard 1 catches a SAME-LENGTH edit to a DIFFERENT (unmatched) line (#20c C41)', async (t) => {
  const page = buildPage({
    active: ['- **alpha** (as of 2026-09-30) — in progress → `~/projects/alpha/STATE.md`'],
    backlog: ['- testagent — ship the next slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const otherSessionBump = page.replace('(as of 2026-09-30)', '(as of 2026-10-01)');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBetweenReads: () => writeFileSync(pagePath, otherSessionBump, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed between read and write')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), otherSessionBump, "the other session's edit survives untouched");
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: guard 2 catches a SAME-LENGTH edit to a DIFFERENT line, made after the archive append (#20c C41)', async (t) => {
  const page = buildPage({
    active: ['- **alpha** (as of 2026-09-30) — in progress → `~/projects/alpha/STATE.md`'],
    backlog: ['- testagent — ship the next slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const otherSessionBump = page.replace('(as of 2026-09-30)', '(as of 2026-10-01)');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, {
    onBeforeGuard2: () => writeFileSync(pagePath, otherSessionBump, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed after archiving')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), otherSessionBump, "the other session's edit survives — never renamed over");
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'), 'the archive already has the copy');
});

test('runStateArchive: `trimmed`\'s own guard catches a SAME-LENGTH edit to a DIFFERENT line too (#20c C41)', async (t) => {
  const page = buildPage({
    active: ['- **alpha** (as of 2026-09-30) — in progress → `~/projects/alpha/STATE.md`'],
    backlog: ['- testagent — ship the next slice', '- ahimsa — review the shipped slice'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);
  const otherSessionBump = page.replace('(as of 2026-09-30)', '(as of 2026-10-01)');

  const result = await archive(home, { match: 'review the shipped slice', reason: 'trimmed' }, {
    onBetweenReads: () => writeFileSync(pagePath, otherSessionBump, 'utf8'),
  });

  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('changed between read and write')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), otherSessionBump, "the other session's edit survives");
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

// =====================================================================
// #20c H56 — the D1 (one-physical-line) and invalid-UTF-8 refusals apply to
// EVERY reason, not just `removed`.
// =====================================================================

test('runStateArchive: D1\'s one-physical-line refusal applies to EVERY reason, not just `removed` (#20c H56)', async (t) => {
  const page = buildPage({
    closed: ['- **widget** — shipped the thing (closed 2026-09-01)', '  a stray continuation line'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const trimmedResult = await archive(home, { match: 'shipped the thing', reason: 'trimmed' });
  assert.equal(trimmedResult.code, 2);
  assert.ok(
    trimmedResult.err.some((l) => l.includes('bullet spans 2 lines; join it into one line first')),
    `err: ${trimmedResult.err.join('\n')}`,
  );

  const expiredResult = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(expiredResult.code, 2);
  assert.ok(
    expiredResult.err.some((l) => l.includes('bullet spans 2 lines; join it into one line first')),
    `err: ${expiredResult.err.join('\n')}`,
  );

  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});

test('runStateArchive: the invalid-UTF-8 refusal applies to EVERY reason, not just `removed` (#20c H56)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — ship the next slice'],
    watch: ['- a marker sits here XXMARKERXX (validate-by: 2026-09-01)'],
  });
  const buf = Buffer.from(page, 'utf8');
  const marker = Buffer.from('XXMARKERXX', 'utf8');
  const idx = buf.indexOf(marker);
  assert.notEqual(idx, -1, 'fixture marker must be present');
  const corrupted = Buffer.concat([buf.subarray(0, idx), Buffer.from([0x80]), buf.subarray(idx + marker.length)]);

  const home = sandbox(t);
  mkdirSync(join(home, '.agents'), { recursive: true });
  const pagePath = join(home, '.agents', 'STATE.md');
  writeFileSync(pagePath, corrupted);

  const result = await archive(home, { match: 'ship the next slice', reason: 'trimmed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('not valid UTF-8')), `err: ${result.err.join('\n')}`);
  assert.ok(readFileSync(pagePath).equals(corrupted), 'page untouched, byte-for-byte');
});

// =====================================================================
// #20c H57 — a bullet with an inline comment that opens AND closes on the
// same line is archived byte-verbatim, comment included — the record must
// come from the RAW line, never the comment-stripped prepared one.
// =====================================================================

test('runStateArchive: a bullet with a same-line inline comment is archived byte-verbatim, comment included (#20c H57)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship it <!-- ask the owner first -->'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship it', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('ship it'));
  assert.ok(
    readFileSync(archivePath, 'utf8').includes('- testagent — ship it <!-- ask the owner first -->\n'),
    'the record must keep the comment, not the comment-stripped text',
  );
});

// =====================================================================
// #20c H60 — dry-run PARITY with the real run: every refusal, note, and
// error the real run would hit must also show up (and still write nothing)
// under --dry-run.
// =====================================================================

test('runStateArchive: --dry-run on a D1-refused wrapped bullet still refuses (#20c H60)', async (t) => {
  const page = buildPage({
    watch: ['- a loose assumption needing validation (validate-by: 2026-09-01)', '  one lazy continuation line'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a loose assumption needing validation', reason: 'removed', dryRun: true });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('bullet spans 2 lines; join it into one line first')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing written, not even in dry-run form');
});

test('runStateArchive: --dry-run on a D3-refused move still refuses (#20c H60)', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-28)'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired', dryRun: true });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('not yet expired')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: --dry-run still shows the byte-identical-duplicates note (#20c H60)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — a shared duplicate sentinel wording', '- ahimsa — an unrelated backlog item'],
    watch: ['- testagent — a shared duplicate sentinel wording'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a shared duplicate sentinel wording', reason: 'removed', dryRun: true });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(
    result.out.some((l) => l.includes('dry run — ') && l.includes('matched 2 byte-identical lines')),
    `out: ${result.out.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched under dry-run');
  assert.ok(!existsSync(archivePath), 'archive untouched under dry-run');
});

test('runStateArchive: --dry-run surfaces an unreadable-archive compose error too (#20c H60)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  mkdirSync(archivePath);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', dryRun: true });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not be read')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

// #20c H32: dry-run prefixes the REMINDER line too, for both `inactive` and
// `trimmed` — not just the record and action lines.
test('runStateArchive: --dry-run prefixes the REMINDER line too (#20c H32)', async (t) => {
  {
    const page = buildPage({ active: ['- **gizmo** (as of 2026-08-01) — stalled → `~/projects/gizmo/STATE.md`'] });
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'gizmo', reason: 'inactive', dryRun: true });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(
      result.out.some(
        (l) => l === 'dry run — reminder: add a one-line Backlog (owned) item for this thread — `owner — name: waiting on … → pointer`',
      ),
      `out: ${JSON.stringify(result.out)}`,
    );
    assert.ok(!result.out.some((l) => l.startsWith('reminder:')), 'the bare, unprefixed form must not appear');
  }
  {
    const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'ship the next slice', reason: 'trimmed', dryRun: true });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(
      result.out.some((l) => l === `dry run — reminder: ${pagePath} was not modified — shorten this line in place`),
      `out: ${JSON.stringify(result.out)}`,
    );
  }
});

// =====================================================================
// #20c H65 — an archive holding no real content yet (a lone BOM, or
// nothing but line breaks) gets the header, same as a missing/empty one.
// =====================================================================

test('runStateArchive: an archive holding only a BOM gets the header, same as an empty one (#20c H65)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  writeFileSync(archivePath, '﻿', 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    '﻿' + ARCHIVE_HEADER_TEXT + '\n\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
  );
});

test('runStateArchive: an archive holding only a line break gets the header, same as an empty one (#20c H65)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  writeFileSync(archivePath, '\n', 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    '\n' + ARCHIVE_HEADER_TEXT + '\n\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
  );
});

// =====================================================================
// #20c H74 (overlaps C22 part b) — placeholder insertion edge cases: a
// section that already holds [placeholder, real bullet] keeps its single
// placeholder (no second copy); an emptied Active-threads or Recently-closed
// section gets ITS OWN placeholder, never Watch's.
// =====================================================================

test('runStateArchive: a section holding [placeholder, real bullet] keeps ITS SINGLE placeholder, no second copy (#20c H74)', async (t) => {
  const watchPlaceholder = templatePlaceholder('Watch');
  const page = buildPage({ watch: [watchPlaceholder, '- a real watch item (validate-by: 2026-12-01)'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a real watch item', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  const expected = page.replace('- a real watch item (validate-by: 2026-12-01)\n', '');
  assert.equal(pageAfter, expected, "the real line is gone; the section's own placeholder is untouched, no SECOND placeholder inserted");
});

test('runStateArchive: emptying Active threads or Recently closed inserts THAT section\'s own placeholder, never Watch\'s (#20c H74/C22)', async (t) => {
  {
    const page = buildPage({
      active: ['- **widget** (as of 2026-08-01) — building it → `~/projects/widget/STATE.md`'],
    });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'widget', reason: 'removed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    const expected = page.replace(
      '- **widget** (as of 2026-08-01) — building it → `~/projects/widget/STATE.md`',
      templatePlaceholder('Active threads'),
    );
    assert.equal(readFileSync(pagePath, 'utf8'), expected);
  }
  {
    const page = buildPage({ closed: ['- **widget** — shipped it (closed 2026-09-01)'] });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'shipped it', reason: 'expired' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    const expected = page.replace(
      '- **widget** — shipped it (closed 2026-09-01)',
      templatePlaceholder('Recently closed (context for next session)'),
    );
    assert.equal(readFileSync(pagePath, 'utf8'), expected);
  }
});

// =====================================================================
// #20c H75 — the placeholder owner comes ONLY from the page header's own
// `Owner: <name>. Protocol:` sentence, never from "Owner:"-looking text in
// a body bullet.
// =====================================================================

test('runStateArchive: the placeholder owner comes ONLY from the page header, never from body text (#20c H75)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] })
    .replace('Owner: testagent. Protocol:', 'Protocol:')
    .replace(templatePlaceholder('Watch'), '- Owner: ops team. rotates the signing key (validate-by: 2026-12-01)');
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  assert.ok(pageAfter.includes('`__OWNER__ — action`'), 'must keep the literal __OWNER__ token, not "ops team" from the body');
});

// #20c E9/H7: the owner's name runs to the LITERAL ". Protocol:" that
// follows it, not just up to the first period — so a middle-initial name
// survives whole.
test('runStateArchive: a header owner with a period in the name survives whole, including the period (#20c E9/H7)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] }).replace(
    'Owner: testagent.',
    'Owner: Jane Q. Public.',
  );
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  assert.ok(pageAfter.includes('`Jane Q. Public — action`'), `expected the whole name kept: ${pageAfter}`);
});

// =====================================================================
// #20c C24 — `inactive` and `closed` really remove the matched bullet from
// the page (not just the already-pinned `removed`/`expired`).
// =====================================================================

test('runStateArchive: `inactive` and `closed` both really remove the bullet from the page (#20c C24)', async (t) => {
  {
    const page = buildPage({
      active: ['- **gizmo** (as of 2026-08-01) — stalled → `~/projects/gizmo/STATE.md`'],
    });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'gizmo', reason: 'inactive' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!readFileSync(pagePath, 'utf8').includes('gizmo'), 'inactive really removed the line');
  }
  {
    const page = buildPage({
      active: ['- **widget** (as of 2026-08-01) — finishing up → `~/projects/widget/STATE.md`'],
    });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'widget', reason: 'closed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!readFileSync(pagePath, 'utf8').includes('widget'), 'closed really removed the line');
  }
});

// =====================================================================
// #20c C30 — `--match` is case-sensitive.
// =====================================================================

test('runStateArchive: --match is case-sensitive — a case-only difference does not match (#20c C30)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — Ship The Next Slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('no line matches')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath));
});

// =====================================================================
// #20c C31 — the multi-match ambiguity listing shows EACH candidate's
// excerpt (not just its section name).
// =====================================================================

test('runStateArchive: the multi-match ambiguity listing shows EACH candidate\'s excerpt, not just its section (#20c C31)', async (t) => {
  const backlogLine = '- testagent — this backlog line runs well past the sixty character excerpt cut mark by quite a lot';
  const watchLine = '- testagent — runs well past, a second candidate entirely (validate-by: 2026-09-01)';
  const page = buildPage({ backlog: [backlogLine], watch: [watchLine] });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'runs well past' });
  assert.equal(result.code, 2);
  const expectedBacklogExcerpt = Array.from(backlogLine).slice(0, 60).join('');
  const expectedWatchExcerpt = Array.from(watchLine).slice(0, 60).join('');
  assert.ok(
    result.err.some((l) => l.includes('Backlog (owned)') && l.includes(expectedBacklogExcerpt)),
    `err: ${result.err.join('\n')}`,
  );
  assert.ok(
    result.err.some((l) => l.includes('Watch') && l.includes(expectedWatchExcerpt)),
    `err: ${result.err.join('\n')}`,
  );
});

// =====================================================================
// #20c C58 — the ACTION line names the exact section too, for a
// non-Backlog section (the record heading's own section name is already
// pinned for all four; the action line's was pinned for Backlog only).
// =====================================================================

test('runStateArchive: the ACTION line names the exact section too, not just the record heading (#20c C58)', async (t) => {
  const page = buildPage({ watch: ['- a watch sentinel assumption (validate-by: 2026-09-01)'] });
  const { home } = makeHome(t, page);

  const result = await archive(home, { match: 'a watch sentinel assumption', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(
    result.out.some((l) => l.startsWith('archived (removed): Watch · ')),
    `out: ${result.out.join('\n')}`,
  );
});

// =====================================================================
// #20c C46 — reminder lines are printed ONLY for their own reason, never
// for any other.
// =====================================================================

test('runStateArchive: no reminder line prints for `removed`, `expired`, or `trimmed` (#20c C46)', async (t) => {
  {
    const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!result.out.some((l) => l.includes('reminder:')), `out: ${result.out.join('\n')}`);
  }
  {
    const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-01)'] });
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!result.out.some((l) => l.includes('reminder:')), `out: ${result.out.join('\n')}`);
  }
  {
    const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
    const { home } = makeHome(t, page);
    const result = await archive(home, { match: 'ship the next slice', reason: 'trimmed' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!result.out.some((l) => l.includes('Backlog (owned) item')), `out: ${result.out.join('\n')}`);
    assert.ok(!result.out.some((l) => l.includes('Recently-closed entry')), `out: ${result.out.join('\n')}`);
  }
});

test('runStateArchive: `inactive` never prints the trimmed/closed reminder text (#20c C46)', async (t) => {
  const page = buildPage({ active: ['- **gizmo** (as of 2026-08-01) — stalled → `~/projects/gizmo/STATE.md`'] });
  const { home } = makeHome(t, page);
  const result = await archive(home, { match: 'gizmo', reason: 'inactive' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!result.out.some((l) => l.includes('was not modified')), `out: ${result.out.join('\n')}`);
  assert.ok(!result.out.some((l) => l.includes('Recently-closed entry')), `out: ${result.out.join('\n')}`);
});

test('runStateArchive: `closed` never prints the trimmed/inactive reminder text (#20c C46)', async (t) => {
  const page = buildPage({
    active: ['- **widget** (as of 2026-08-01) — finishing up → `~/projects/widget/STATE.md`'],
  });
  const { home } = makeHome(t, page);
  const result = await archive(home, { match: 'widget', reason: 'closed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!result.out.some((l) => l.includes('was not modified')), `out: ${result.out.join('\n')}`);
  assert.ok(!result.out.some((l) => l.includes('Backlog (owned) item')), `out: ${result.out.join('\n')}`);
});

// =====================================================================
// #20c H25 — the D3 clock gate's boundary (age == limit, limit + 1), the
// oldest-stamp selection rule (#20c E10/H12), and the real-calendar-date
// filter on the matched line's own stamp.
// =====================================================================

test('runStateArchive: D3 — `expired` at EXACTLY the 7-day limit still refuses; one day more proceeds (#20c H25)', async (t) => {
  {
    const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-24)'] });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
    assert.equal(result.code, 2);
    assert.ok(result.err.some((l) => l.includes('not yet expired')), `err: ${result.err.join('\n')}`);
    assert.equal(readFileSync(pagePath, 'utf8'), page);
  }
  {
    const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-09-23)'] });
    const { home, pagePath, archivePath } = makeHome(t, page);
    const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!readFileSync(pagePath, 'utf8').includes('shipped the thing'));
    assert.ok(readFileSync(archivePath, 'utf8').includes('shipped the thing'));
  }
});

test('runStateArchive: D3 — `inactive` at EXACTLY the 30-day limit still refuses; one day more proceeds (#20c H25)', async (t) => {
  {
    const page = buildPage({
      active: ['- **widget** (as of 2026-09-01) — building it → `~/projects/widget/STATE.md`'],
    });
    const { home, pagePath } = makeHome(t, page);
    const result = await archive(home, { match: 'building it', reason: 'inactive' });
    assert.equal(result.code, 2);
    assert.ok(result.err.some((l) => l.includes('not yet inactive')), `err: ${result.err.join('\n')}`);
    assert.equal(readFileSync(pagePath, 'utf8'), page);
  }
  {
    const page = buildPage({
      active: ['- **widget** (as of 2026-08-31) — building it → `~/projects/widget/STATE.md`'],
    });
    const { home, pagePath, archivePath } = makeHome(t, page);
    const result = await archive(home, { match: 'building it', reason: 'inactive' });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(!readFileSync(pagePath, 'utf8').includes('building it'));
    assert.ok(readFileSync(archivePath, 'utf8').includes('building it'));
  }
});

test('runStateArchive: D3 — a line with TWO closed stamps uses the OLDEST, agreeing with the lint\'s own WARN rule (#20c H12/E10)', async (t) => {
  const page = buildPage({
    closed: ['- **twice-closed** reopened (closed 2026-09-01), then (closed 2026-09-29) — done → pointer'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  // The OLDEST stamp (2026-09-01) is 30 days before TODAY — past the 7-day
  // limit — so the gate must now PROCEED, even though the NEWEST stamp
  // (2026-09-29) is only 2 days old. Before #20c E10 the gate used the
  // newest stamp and would have refused here.
  const result = await archive(home, { match: 'twice-closed', reason: 'expired' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('twice-closed'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('twice-closed'));
});

test('runStateArchive: D3 — an impossible date-shaped stamp is filtered, refusing as "none found" rather than a false age (#20c H25)', async (t) => {
  const page = buildPage({ closed: ['- **widget** — shipped the thing (closed 2026-02-30)'] });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('none found — use --reason removed instead')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page);
});

// =====================================================================
// #20c H26 — the future-stamp-anywhere refusal: strictness of the
// comparison (today itself does not trigger it), section scope (Recently
// closed, not just Active threads), the real-calendar-date filter, and that
// it fires for `expired` too (the only prior fixture used `inactive`).
// =====================================================================

test('runStateArchive: D3 — a stamp dated EXACTLY today does not trigger the future-stamp refusal (#20c H26)', async (t) => {
  const page = buildPage({
    active: [
      '- **today-stamped** (as of 2026-10-01) — stamped today, not future → `~/projects/today/STATE.md`',
      '- **widget** (as of 2026-08-01) — stalled → `~/projects/widget/STATE.md`',
    ],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'widget', reason: 'inactive' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('stalled'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('stalled'));
});

test('runStateArchive: D3 — a future `(closed ...)` stamp in Recently closed ALSO refuses, including for `--reason expired` itself (#20c H26)', async (t) => {
  const page = buildPage({
    closed: [
      '- **mistyped** — a fat-fingered future close (closed 2026-11-01)',
      '- **widget** — shipped the thing (closed 2026-09-01)',
    ],
  });
  const { home, pagePath } = makeHome(t, page);

  const result = await archive(home, { match: 'shipped the thing', reason: 'expired' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some(
      (l) => l.includes('dated after today (2026-10-01)') && l.includes('2026-11-01') && l.includes('fix that stamp first'),
    ),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
});

test('runStateArchive: D3 — an impossible future-SHAPED stamp (month 13) is filtered, never a real future date (#20c H26)', async (t) => {
  const page = buildPage({
    active: [
      '- **bogus** (as of 2026-13-45) — an impossible, future-shaped stamp → `~/projects/bogus/STATE.md`',
      '- **widget** (as of 2026-08-01) — stalled → `~/projects/widget/STATE.md`',
    ],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'widget', reason: 'inactive' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('stalled'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('stalled'));
});

// =====================================================================
// #20c E5/H1 — a page with more than one hard link is refused outright,
// before any write is attempted.
// =====================================================================

test('runStateArchive: a page with more than one hard link is refused outright, before any write (#20c E5/H1)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);
  linkSync(pagePath, join(home, '.agents', 'canonical-STATE.md'));

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('more than one hard link')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing written');
});

// =====================================================================
// #20c E5/H2 — a transient EPERM/EACCES/EBUSY on rename is retried with
// backoff; a permanent one gives up once the retry budget is spent; a
// non-retryable error code is never retried at all.
// =====================================================================

test('runStateArchive: a transient EPERM on rename is retried and eventually succeeds (#20c E5/H2)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  let attempts = 0;
  const flakyRename = (/** @type {string} */ from, /** @type {string} */ to) => {
    attempts++;
    if (attempts < 3) {
      const error = /** @type {Error & { code?: string }} */ (new Error('simulated transient hold'));
      error.code = 'EPERM';
      throw error;
    }
    renameSync(from, to);
  };

  const result = await archive(
    home,
    { match: 'ship the next slice', reason: 'removed' },
    { renameSyncOverride: flakyRename, renameRetryBudgetMs: 2000 },
  );
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(attempts, 3, 'retried exactly twice before succeeding on the third attempt');
  assert.ok(!readFileSync(pagePath, 'utf8').includes('ship the next slice'));
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'));
});

test('runStateArchive: a PERMANENTLY failing rename gives up once its retry budget is spent (#20c E5/H2)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const alwaysFlaky = () => {
    const error = /** @type {Error & { code?: string }} */ (new Error('simulated permanent hold'));
    error.code = 'EBUSY';
    throw error;
  };

  const result = await archive(
    home,
    { match: 'ship the next slice', reason: 'removed' },
    { renameSyncOverride: alwaysFlaky, renameRetryBudgetMs: 120 },
  );
  assert.equal(result.code, 2);
  assert.ok(result.err.some((l) => l.includes('could not rename the temp file over')), `err: ${result.err.join('\n')}`);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched — the rename never happened');
  assert.ok(readFileSync(archivePath, 'utf8').includes('ship the next slice'), 'the archive already has the copy');
  assert.deepEqual(tmpLeftovers(home), [], 'no leftover temp file');
});

test('runStateArchive: a NON-retryable rename error fails immediately, no retry (#20c E5/H2)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home } = makeHome(t, page);

  let attempts = 0;
  const nonRetryable = () => {
    attempts++;
    const error = /** @type {Error & { code?: string }} */ (new Error('simulated unrelated failure'));
    error.code = 'ENOTDIR';
    throw error;
  };

  const result = await archive(
    home,
    { match: 'ship the next slice', reason: 'removed' },
    { renameSyncOverride: nonRetryable, renameRetryBudgetMs: 2000 },
  );
  assert.equal(result.code, 2);
  assert.equal(attempts, 1, 'must not retry a non-retryable error code');
});

// =====================================================================
// #20c E5 — skip the append entirely when the archive's last record is
// already byte-identical to the one about to be written (a retry, or two
// concurrent identical runs, must never duplicate a record).
// =====================================================================

test('runStateArchive: a retried rename after append does NOT duplicate the archive record (#20c E5, C48/H38)', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  // First attempt: the append succeeds, but the rename fails permanently —
  // the archive now holds ONE record, the page still has the line.
  const first = await archive(
    home,
    { match: 'ship the next slice', reason: 'removed', tag: 'claude' },
    {
      renameSyncOverride: () => {
        const error = /** @type {Error & { code?: string }} */ (new Error('simulated permanent hold'));
        error.code = 'EBUSY';
        throw error;
      },
      renameRetryBudgetMs: 60,
    },
  );
  assert.equal(first.code, 2);
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page unchanged after the failed rename');
  const archiveAfterFirst = readFileSync(archivePath, 'utf8');
  assert.equal(archiveAfterFirst.split('## [').length - 1, 1, 'exactly one record after the first (failed) attempt');

  // Retry, same command, same tag, same `now` — this time the rename
  // succeeds. The archive must still hold exactly ONE record of the line,
  // not two.
  const second = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(second.code, 0, `err: ${second.err.join('\n')}`);
  assert.ok(!readFileSync(pagePath, 'utf8').includes('ship the next slice'));
  const archiveAfterSecond = readFileSync(archivePath, 'utf8');
  assert.equal(archiveAfterSecond.split('## [').length - 1, 1, 'still exactly one record — the retry must not duplicate it');
});

// =====================================================================
// #20c E2 — the archive's D1 refusal must count continuation lines the
// SAME way the lint's `bullet-wrapped` WARN does: an indented fence (and
// its body) under a bullet is a continuation line whatever it holds. If
// the archive instead fell back to counting continuations on the
// FENCE/COMMENT-BLANKED prepared text (dropping `rawLines`, the third
// argument `topLevelBulletRanges` needs), every line of an indented fenced
// block blanks to '', loses its indentation marker, and the whole
// continuation undercounts to 0 — D1 would then silently let the fence's
// tail be left behind on the page.
// =====================================================================

test('runStateArchive: D1 counts an indented fenced block under a bullet as continuation lines, matching the lint\'s rule (#20c E2)', async (t) => {
  const page = buildPage({
    backlog: ['- testagent — a bullet with an indented fence tail', '  ```', '  fenced body line', '  ```'],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'a bullet with an indented fence tail', reason: 'removed' });
  assert.equal(result.code, 2);
  assert.ok(
    result.err.some((l) => l.includes('bullet spans 4 lines; join it into one line first')),
    `err: ${result.err.join('\n')}`,
  );
  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched');
  assert.ok(!existsSync(archivePath), 'nothing appended');
});
