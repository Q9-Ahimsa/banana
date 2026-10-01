// `banana state archive` (ticket #20, Lane B): moves — or, for `trimmed`,
// copies — exactly one matched top-level bullet off the global page into
// the append-only STATE-archive.md. Covers parseStateArgs's archive-shaped
// branch (lib/state.mjs — physically extended there, tested here per the
// ticket's lane split) and lib/state-archive.mjs's runStateArchive. All
// fixtures are synthetic (no real project names/people/paths). Sandbox temp
// dirs only — never the real home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStateArgs, prepareText, topLevelBullets } from '../lib/state.mjs';
import { runStateArchive } from '../lib/state-archive.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pinned as LITERAL text, never the module's own ARCHIVE_HEADER_LINES
// export (Lane 2 test requirement) — a typo in the module's constant must
// still fail this test, not silently agree with itself.
const ARCHIVE_HEADER_TEXT =
  '# GLOBAL STATE — archive\n' +
  '> Append-only. Lines moved off ~/.agents/STATE.md (or the long form of trimmed ones), verbatim,\n' +
  '> newest last. Never loaded at session start. Search: grep -i "<term>" ~/.agents/STATE-archive.md';

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
 * @param {{ now?: number, onBetweenReads?: () => void, onBeforeGuard2?: () => void, onBeforeRename?: () => void }} [opts]
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
    ARCHIVE_HEADER_TEXT +
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
  assert.equal(afterFirst, ARCHIVE_HEADER_TEXT + '\n\n' +
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

  const result = await archive(home, { match: 'ship the next slice', reason: 'closed', dryRun: true });
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
  assert.ok(result.out.some((l) => l.includes('## [') && l.includes('closed · Backlog (owned)')));
  assert.ok(result.out.some((l) => l.includes('- testagent — ship the next slice')));
  assert.ok(
    result.out.some(
      (l) => l === `dry run — archived (closed): Backlog (owned) · "- testagent — ship the next slice" → ${archivePath}`,
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

test('runStateArchive: an existing archive with NO trailing newline gets one inserted before the new record', async (t) => {
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });
  const { home, archivePath } = makeHome(t, page);
  const priorNoTrailingNewline =
    ARCHIVE_HEADER_TEXT + '\n\n' + '## [2026-09-01] testagent — removed · Watch\n- an old archived line';
  writeFileSync(archivePath, priorNoTrailingNewline, 'utf8');

  const result = await archive(home, { match: 'ship the next slice', reason: 'removed', tag: 'claude' });
  assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
  assert.equal(
    readFileSync(archivePath, 'utf8'),
    priorNoTrailingNewline + '\n' + `## [${TODAY}] claude — removed · Backlog (owned)\n- testagent — ship the next slice\n\n`,
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

test('runStateArchive: the record date is the LOCAL calendar day of injected `now`, pinned on either side of a UTC-midnight boundary', async (t) => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  t.after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  // With TZ pinned to UTC, local-calendar getters and UTC agree, so these
  // two epoch values — each built directly from UTC components via
  // Date.UTC, never through formatLocalDate (the function under test's own
  // date math) — independently pin the calendar day on EITHER side of a UTC
  // midnight boundary.
  const justBeforeMidnight = Date.UTC(2026, 8, 30, 23, 59, 0); // 2026-09-30T23:59:00Z
  const justAfterMidnight = Date.UTC(2026, 9, 1, 0, 1, 0); // 2026-10-01T00:01:00Z
  const page = buildPage({ backlog: ['- testagent — ship the next slice'] });

  {
    const { home, archivePath } = makeHome(t, page);
    const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, { now: justBeforeMidnight });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(readFileSync(archivePath, 'utf8').includes('## [2026-09-30]'));
  }
  {
    const { home, archivePath } = makeHome(t, page);
    const result = await archive(home, { match: 'ship the next slice', reason: 'removed' }, { now: justAfterMidnight });
    assert.equal(result.code, 0, `err: ${result.err.join('\n')}`);
    assert.ok(readFileSync(archivePath, 'utf8').includes('## [2026-10-01]'));
  }
});
