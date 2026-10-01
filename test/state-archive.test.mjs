// `banana state archive` (ticket #20, Lane B): moves — or, for `trimmed`,
// copies — exactly one matched top-level bullet off the global page into
// the append-only STATE-archive.md. Covers parseStateArgs's archive-shaped
// branch (lib/state.mjs — physically extended there, tested here per the
// ticket's lane split) and lib/state-archive.mjs's runStateArchive. All
// fixtures are synthetic (no real project names/people/paths). Sandbox temp
// dirs only — never the real home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStateArgs, prepareText, topLevelBullets } from '../lib/state.mjs';
import { ARCHIVE_HEADER_LINES, runStateArchive } from '../lib/state-archive.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
 * @param {{ now?: number, onBetweenReads?: () => void }} [opts]
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

  const result = await archive(home, { match: 'ship the next slice', reason: 'closed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const expected =
    ARCHIVE_HEADER_LINES.join('\n') +
    '\n\n' +
    `## [${TODAY}] claude — closed · Backlog (owned)\n` +
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
  assert.equal(afterFirst, ARCHIVE_HEADER_LINES.join('\n') + '\n\n' +
    `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`);

  const r2 = await archive(home, { match: 'review the shipped slice', reason: 'closed', tag: 'claude' });
  assert.equal(r2.code, 0, `err: ${r2.err.join('\n')}`);
  const afterSecond = readFileSync(archivePath, 'utf8');
  assert.equal(
    afterSecond,
    afterFirst + `## [${TODAY}] claude — closed · Backlog (owned)\n- ahimsa — review the shipped slice\n\n`,
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

  const r2 = await archive(home, { match: 'an assumption needing validation', reason: 'expired' });
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

  const expected = page.replace('- testagent — ship the next slice', templatePlaceholder('Backlog (owned)'));
  assert.equal(readFileSync(pagePath, 'utf8'), expected);
});

// #20b review Decision D1: the global page is one physical line per
// bullet. lib/state.mjs's `topLevelBulletRanges` (which this module's
// candidate scan is built on) now hands back SINGLE-LINE ranges plus a
// `continuationLines` count, rather than a multi-line span — so a
// continuation line's own text is no longer part of what a bullet matches
// or moves. This is an INTERIM state: the full D1 archive-side contract
// (refuse with exit 2 when the matched bullet has continuation lines,
// "bullet spans N lines; join it into one line first," the archive moves
// are never partial) is lane 2's job (this module's own logic, not touched
// by this lane) — this test pins what today's UNCHANGED runStateArchive
// does with the new shared helper's contract, so lane 2 has a known,
// regression-guarded starting point rather than a silent behavior change.
test('runStateArchive: (interim, pending lane 2\'s D1 refusal) matches and moves only the bullet\'s own line; continuation lines are orphaned, not swept along', async (t) => {
  const page = buildPage({
    backlog: [
      '- testagent — a wrapped backlog item',
      '  continuation line one',
      '  continuation line two',
      '- ahimsa — a second, plain item',
    ],
  });
  const { home, pagePath, archivePath } = makeHome(t, page);

  // A continuation line's own text is not part of the matchable bullet.
  const noMatch = await archive(home, { match: 'continuation line one', reason: 'removed' });
  assert.equal(noMatch.code, 2);
  assert.ok(noMatch.err.some((l) => l.includes('no line matches')));

  const result = await archive(home, { match: 'a wrapped backlog item', reason: 'removed' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  const pageAfter = readFileSync(pagePath, 'utf8');
  assert.ok(!pageAfter.includes('a wrapped backlog item'));
  // The continuation lines are left behind on the page today — lane 2 must
  // add the D1 refusal so the real command never reaches this state.
  assert.ok(pageAfter.includes('continuation line one'));
  assert.ok(pageAfter.includes('continuation line two'));
  assert.ok(pageAfter.includes('- ahimsa — a second, plain item'));

  const archiveText = readFileSync(archivePath, 'utf8');
  assert.ok(archiveText.includes('- testagent — a wrapped backlog item'));
  assert.ok(!archiveText.includes('continuation line one'));
});

test('runStateArchive: --dry-run prints the record and the action line, writes nothing', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, pagePath, archivePath } = makeHome(t, page);

  const result = await archive(home, { match: 'ship the next slice', reason: 'closed', dryRun: true });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);

  assert.equal(readFileSync(pagePath, 'utf8'), page, 'page untouched under --dry-run');
  assert.ok(!existsSync(archivePath), 'archive untouched under --dry-run');
  assert.ok(result.out.some((l) => l.includes('## [') && l.includes('closed · Backlog (owned)')));
  assert.ok(result.out.some((l) => l.includes('- testagent — ship the next slice')));
  assert.ok(result.out.some((l) => l.startsWith('archived (closed): Backlog (owned)')));
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
