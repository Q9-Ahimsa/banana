import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseLogArgs, runLog } from '../lib/log.mjs';
import { sessionLogPath, parseSessionLog, supersededIds } from '../lib/sessionlog.mjs';

/** @type {string[]} */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Shared fixture home for the state-lint global side (#14) — no
// ~/.agents/STATE.md, so every test below that doesn't pass its own `home`
// gets a deterministic `global: none (...)`. Read-only — log never writes
// to home — so one shared dir is safe across tests.
const HOME = mkdtempSync(join(tmpdir(), 'banana-log-home-'));
tempDirs.push(HOME);

// LOCAL_NOW is built from local-date components (like formatLocalDate itself),
// so formatLocalDate(LOCAL_NOW) === TODAY on every machine's timezone —
// no TZ-dependent flakiness in the write-mechanics/verb tests. Ghost-math
// fixtures below use dates far enough in the past that the widest real UTC
// skew (+-14h, sessionlog.mjs's GHOST-SKEW note) never flips the verdict.
const LOCAL_NOW = new Date(2026, 7, 12, 12, 0, 0).getTime();
const TODAY = '2026-08-12';

const SEED =
  '# Session log — task-grain work journal (Session Log v2)\n' +
  '> Append-only. Envelope: `## [YYYY-MM-DD] {agent} {feature}.{n} | {PHASE} — {title}`\n';

/**
 * @param {string | null} logText null = no .agents/session.log at all
 * @returns {string}
 */
function makeProject(logText = SEED) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-log-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  if (logText !== null) writeFileSync(sessionLogPath(dir), logText, 'utf8');
  return dir;
}

/** @param {string} dir @param {string} name @param {string} text */
function makeArchive(dir, name, text) {
  mkdirSync(join(dir, '.agents', 'sessions'), { recursive: true });
  writeFileSync(join(dir, '.agents', 'sessions', name), text, 'utf8');
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
 * @param {string} cwd
 * @param {string[]} argv the full `log` slice, e.g. ['stub','cli',...]
 * @param {{now?: number, readStdin?: () => Promise<string>|string, home?: string}} [opts]
 */
async function run(cwd, argv, opts = {}) {
  const io = makeIo();
  const flags = parseLogArgs(argv);
  const readStdin =
    opts.readStdin ??
    (() => {
      throw new Error('stdin not expected in this test');
    });
  const result = await runLog(flags, { cwd, io, now: opts.now ?? LOCAL_NOW, readStdin, home: opts.home ?? HOME });
  return { code: result.code, out: io.outLines, err: io.errLines };
}

/**
 * Like `run`, but injects an `io.write` raw sink alongside `io.out` — lib's
 * dry-run path prefers `io.write ?? io.out` (B5: the bin boundary's io.out
 * is console.log, which adds a process-level newline; a raw sink is how a
 * caller gets the exact composed bytes back).
 * @param {string} cwd
 * @param {string[]} argv
 * @param {{now?: number, home?: string}} [opts]
 */
async function runWithWriteSink(cwd, argv, opts = {}) {
  const flags = parseLogArgs(argv);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  /** @type {string[]} */
  const writes = [];
  const io = {
    out: (/** @type {string} */ l = '') => out.push(l),
    err: (/** @type {string} */ l = '') => err.push(l),
    write: (/** @type {string} */ s) => writes.push(s),
  };
  const readStdin = () => {
    throw new Error('stdin not expected in this test');
  };
  const result = await runLog(flags, { cwd, io, now: opts.now ?? LOCAL_NOW, readStdin, home: opts.home ?? HOME });
  return { code: result.code, out, err, writes };
}

/** @param {string} cwd */
function readLog(cwd) {
  return readFileSync(sessionLogPath(cwd), 'utf8');
}

// =====================================================================
// parseLogArgs: verb vocabulary, flag syntax
// =====================================================================

test('parseLogArgs: missing verb throws a usage error', () => {
  assert.throws(() => parseLogArgs([]), /verb/);
});

test('parseLogArgs: unknown verb names the vocabulary', () => {
  assert.throws(
    () => parseLogArgs(['frobnicate', 'cli']),
    /unknown log verb 'frobnicate' \(expected stub\|append\|close\|supersede\)/
  );
});

test('parseLogArgs: --flag=value and --flag value both work', () => {
  const a = parseLogArgs(['stub', 'cli', '--tag=testagent', '--phase', 'build', '--title=t', '--approach=a']);
  assert.equal(a.tag, 'testagent');
  assert.equal(a.phase, 'build');
});

test('parseLogArgs: a value that is exactly another known flag errors distinctively', () => {
  assert.throws(
    () => parseLogArgs(['stub', 'cli', '--tag', 't', '--title', '--phase']),
    /--title requires a value \(got '--phase'\)/
  );
});

test('parseLogArgs: unknown option lists the verb valid flags', () => {
  assert.throws(() => parseLogArgs(['stub', 'cli', '--bogus', 'x']), /unknown option '--bogus'/);
});

test('parseLogArgs: repeatable --body collects every occurrence in order', () => {
  const a = parseLogArgs(['append', 'cli', '--tag', 't', '--body', 'one', '--body', 'two']);
  assert.deepEqual(a.body, ['one', 'two']);
});

test('parseLogArgs: -- terminator stops flag parsing (a flag-shaped token becomes positional)', () => {
  const a = parseLogArgs([
    'stub', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a', '--', '--looks-like-a-flag',
  ]);
  assert.equal(a.feature, '--looks-like-a-flag');
});

test('parseLogArgs: required flags missing per verb', () => {
  assert.throws(() => parseLogArgs(['stub', 'cli']), /--tag/);
  assert.throws(() => parseLogArgs(['stub', 'cli', '--tag', 't']), /--phase/);
  assert.throws(() => parseLogArgs(['close', 'cli', '--tag', 't']), /--status/);
  assert.throws(
    () => parseLogArgs(['close', 'cli', '--tag', 't', '--status', 'complete']),
    /--next/
  );
  assert.throws(() => parseLogArgs(['supersede', 'cli.1', '--tag', 't']), /--reason/);
  assert.throws(() => parseLogArgs(['append', 'cli']), /--tag/);
  assert.throws(() => parseLogArgs(['append', 'cli', '--tag', 't']), /--body/);
});

test('parseLogArgs: --body - must be the only --body occurrence', () => {
  assert.throws(
    () => parseLogArgs(['append', 'cli', '--tag', 't', '--body', '-', '--body', 'x']),
    /--body -.*only/
  );
  const a = parseLogArgs(['append', 'cli', '--tag', 't', '--body', '-']);
  assert.equal(a.bodyStdin, true);
});

// =====================================================================
// stub
// =====================================================================

test('stub: n=1 on a seed-only log; writes exactly one STATUS line', async () => {
  const dir = makeProject();
  const res = await run(dir, [
    'stub', 'cli', '--tag', 'testagent', '--phase', 'build', '--title', 'first entry', '--approach', 'do the thing',
  ]);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.1']);
  const text = readLog(dir);
  assert.match(text, /## \[2026-08-12\] testagent cli\.1 \| build — first entry/);
  const statusCount = (text.match(/^STATUS:/gm) || []).length;
  assert.equal(statusCount, 1);
  assert.match(text, /STATUS: in-progress/);
});

test('stub: auto-increments n; gaps are not filled', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent gappy.1 | build — one\nSTATUS: complete\nNEXT: testagent — x\n\n' +
      '## [2026-08-02] testagent gappy.5 | build — five\nSTATUS: complete\nNEXT: testagent — x\n'
  );
  const res = await run(dir, [
    'stub', 'gappy', '--tag', 'testagent', '--phase', 'build', '--title', 'six', '--approach', 'a',
  ]);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['gappy.6']);
});

test('stub: archive-aware n (archive max beats a lower active max)', async () => {
  const dir = makeProject(SEED + '\n## [2026-08-01] testagent cli.1 | build — one\nSTATUS: complete\nNEXT: t — x\n');
  makeArchive(dir, '2026-Q1.log', '## [2026-02-01] testagent cli.9 | build — archived\nSTATUS: complete\nNEXT: t — x\n');
  const res = await run(dir, ['stub', 'cli', '--tag', 'testagent', '--phase', 'build', '--title', 't', '--approach', 'a']);
  assert.deepEqual(res.out, ['cli.10']);
});

test('stub: case-split feature refused, naming the existing slug', async () => {
  const dir = makeProject(SEED + '\n## [2026-08-01] testagent Cli.1 | build — one\nSTATUS: complete\nNEXT: t — x\n');
  const res = await run(dir, ['stub', 'cli', '--tag', 'testagent', '--phase', 'build', '--title', 't', '--approach', 'a']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /case-variant of existing feature 'Cli'/);
  assert.equal(readLog(dir), SEED + '\n## [2026-08-01] testagent Cli.1 | build — one\nSTATUS: complete\nNEXT: t — x\n');
});

test('stub: PHASE case-folds to lowercase', async () => {
  const dir = makeProject();
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'BUILD', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 0);
  assert.match(readLog(dir), /\| build — x/);
});

test('stub: invalid PHASE names all six phases', async () => {
  const dir = makeProject();
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'nope', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 1);
  const msg = res.err.join('\n');
  for (const p of ['discuss', 'build', 'refactor', 'debug', 'review', 'ops']) {
    assert.ok(msg.includes(p), `phase error names '${p}'`);
  }
});

test('stub: terminal --status is one-shot (single STATUS line, no in-progress line)', async () => {
  const dir = makeProject();
  const res = await run(dir, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
    '--status', 'complete', '--next-owner', 't', '--next', 'ship it',
  ]);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.ok(!text.includes('STATUS: in-progress'));
  assert.match(text, /STATUS: complete/);
  assert.match(text, /NEXT: t — ship it/);
});

test('stub: --next without --status writes STATUS: in-progress plus the NEXT line', async () => {
  const dir = makeProject();
  const res = await run(dir, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
    '--next-owner', 't', '--next', 'later',
  ]);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.match(text, /STATUS: in-progress/);
  assert.match(text, /NEXT: t — later/);
});

test('stub: terminal status without NEXT is rejected', async () => {
  const dir = makeProject();
  const res = await run(dir, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a', '--status', 'complete',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /terminal STATUS/);
  assert.equal(readLog(dir), SEED);
});

test('stub: zero-byte log is legal (n=1) and warns about the missing seed header', async () => {
  const dir = makeProject('');
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.1']);
  assert.match(res.err.join('\n'), /no seed header/);
});

test('stub: seed-only log (non-empty) is legal and silent about the seed header', async () => {
  const dir = makeProject(SEED);
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 0);
  assert.ok(!res.err.join('\n').includes('seed header'));
});

test('clock skew: writing dated before the log\'s last entry warns on stderr', async () => {
  const dir = makeProject(
    SEED + '\n## [2026-08-15] testagent future.1 | build — from the future\nSTATUS: complete\nNEXT: testagent — x\n'
  );
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /clock skew: last entry dated 2026-08-15, writing 2026-08-12/);
});

test('rotation advisory: appending onto a 700+ line log warns and names the archive dir', async () => {
  const filler = [];
  for (let i = 0; i < 700; i++) filler.push(`FILES: filler line ${i}`);
  const body = ['APPROACH: big.', ...filler, 'STATUS: in-progress'].join('\n');
  const dir = makeProject(SEED + `\n## [2026-08-10] testagent cli.1 | build — huge entry\n${body}\n`);
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'one more line']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /\.agents\/session\.log is \d+ lines \(over 700\)/);
  assert.match(res.err.join('\n'), /archive to \.agents\/sessions\/\{YYYY\}-\{Qn\}\.log/);
});

test('title: --title over 120 chars WARNs but still writes', async () => {
  const dir = makeProject();
  const title = 'x'.repeat(121);
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', title, '--approach', 'a']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /--title is 121 chars \(over 120\) - consider trimming/);
});

test('title: --title over 300 chars is a hard reject, file untouched', async () => {
  const dir = makeProject();
  const title = 'x'.repeat(301);
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', title, '--approach', 'a']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /--title exceeds 300 characters \(301\)/);
  assert.equal(readLog(dir), SEED);
});

test('tag: --tag containing whitespace is rejected (single-token agent field)', async () => {
  const dir = makeProject();
  const res = await run(dir, ['stub', 'cli', '--tag', 'agent one', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /whitespace-delimited/);
});

test('stub: missing .agents/session.log exits 2, pointing to banana project', async () => {
  const dir = makeProject(null);
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /banana project/);
});

test('stub: missing .agents/session.log but a legacy .claude/session.log exists — read-only note appended', async () => {
  const dir = makeProject(null);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'session.log'), 'legacy pre-v2 content\n', 'utf8');
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /banana project/);
  assert.match(
    res.err.join('\n'),
    /a legacy \.claude\/session\.log exists — honored read-only for history; write new entries to \.agents\/session\.log/
  );
});

// =====================================================================
// append
// =====================================================================

/** Build a project with one open entry cli.1 under `testagent`. */
function projectWithOpenEntry(agent = 'testagent') {
  return makeProject(
    SEED + `\n## [2026-08-10] ${agent} cli.1 | build — write mechanics\nAPPROACH: implement the write path.\nSTATUS: in-progress\n`
  );
}

test('append: verbatim multi-line body lands on the open entry, target id on stdout', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'FILES: lib/log.mjs', '--body', 'line two']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.1']);
  const text = readLog(dir);
  assert.match(text, /FILES: lib\/log\.mjs\nline two/);
});

test('append: multiple own-open entries WARN, listing the earlier ids, target the latest', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent cli.1 | build — first open\nAPPROACH: a.\nSTATUS: in-progress\n\n' +
      '## [2026-08-02] testagent cli.2 | build — second open\nAPPROACH: b.\nSTATUS: in-progress\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.2']);
  assert.match(
    res.err.join('\n'),
    /WARN: multiple open entries for 'cli' under 'testagent' — targeting cli\.2; also open: cli\.1/
  );
});

test('append: refusal matrix — no entries for feature at all', async () => {
  const dir = makeProject();
  const res = await run(dir, ['append', 'nope', '--tag', 't', '--body', 'x']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /no entries for 'nope' yet/);
});

test('append: refusal matrix — latest own entry is closed', async () => {
  const dir = makeProject(
    SEED + '\n## [2026-08-10] testagent cli.1 | build — done\nSTATUS: complete\nNEXT: testagent — x\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'x']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /cli\.1 is closed \(complete\)/);
  assert.match(res.err.join('\n'), /banana log supersede cli\.1/);
});

test('append: refusal matrix — open entry exists only under another tag', async () => {
  const dir = projectWithOpenEntry('alice');
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'x']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /no open entry for 'cli' tagged 'testagent'/);
  assert.match(res.err.join('\n'), /open under 'alice'/);
});

test('append: refusal matrix — fourth refusal names closed-or-superseded, not just "closed"', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent cli.1 | build — original\nAPPROACH: a.\nSTATUS: in-progress\n\n' +
      '## [2026-08-02] alice cli.2 | build — correction\nSUPERSEDES: cli.1 (ghost, reopened wrong)\nAPPROACH: b.\nSTATUS: complete\nNEXT: alice — done\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'x']);
  assert.equal(res.code, 2);
  assert.match(
    res.err.join('\n'),
    /no open entry for 'cli' — remaining entries are closed or superseded; open one with `banana log stub`/
  );
});

test('append: refusal matrix — missing .agents/session.log', async () => {
  const dir = makeProject(null);
  const res = await run(dir, ['append', 'cli', '--tag', 't', '--body', 'x']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /banana project/);
});

test('append: body lines starting with STATUS:/NEXT:/SUPERSEDES: are rejected, file untouched', async () => {
  const dir = projectWithOpenEntry();
  const before = readLog(dir);
  for (const bad of ['STATUS: complete', 'NEXT: t — x', 'SUPERSEDES: cli.0 (x)']) {
    const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', bad]);
    assert.equal(res.code, 1, bad);
    assert.equal(readLog(dir), before, bad); // each rejected write leaves the file byte-unchanged
  }
});

test('append: a body line matching /^## \\[/ is rejected, naming the offending line', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', '## [not a real heading]']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /## \[not a real heading\]/);
});

test('append: --body - reads stdin to EOF via injected readStdin', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => 'line one\nline two\n',
  });
  assert.equal(res.code, 0);
  assert.match(readLog(dir), /line one\nline two/);
});

test('append: stdin BOM stripped, UTF-16 BOM and U+FFFD rejected', async () => {
  const dir = projectWithOpenEntry();
  const bom = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => '\uFEFFclean text',
  });
  assert.equal(bom.code, 0);
  assert.match(readLog(dir), /clean text/);
  assert.ok(!readLog(dir).includes('\uFEFF'));

  const dir2 = projectWithOpenEntry();
  const utf16 = await run(dir2, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => '\uFFFD\uFFFDgarbled',
  });
  assert.equal(utf16.code, 1);
  assert.match(utf16.err.join('\n'), /looks UTF-16/);

  const dir3 = projectWithOpenEntry();
  const fffd = await run(dir3, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => 'good line\nbad \uFFFD line',
  });
  assert.equal(fffd.code, 1);
  assert.match(fffd.err.join('\n'), /not valid UTF-8/);
});

test('append: NUL and C0 control characters rejected (tab allowed)', async () => {
  const dir = projectWithOpenEntry();
  const nul = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => 'bad\u0000line',
  });
  assert.equal(nul.code, 1);
  assert.match(nul.err.join('\n'), /control character/);

  const dir2 = projectWithOpenEntry();
  const tab = await run(dir2, ['append', 'cli', '--tag', 'testagent', '--body', '-'], {
    readStdin: () => 'tab\there',
  });
  assert.equal(tab.code, 0);
});

test('append: body over 10 lines warns on stderr but still writes', async () => {
  const dir = projectWithOpenEntry();
  const args = ['append', 'cli', '--tag', 'testagent'];
  for (let i = 0; i < 11; i++) args.push('--body', `line ${i}`);
  const res = await run(dir, args);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /bodies <=10 lines/);
});

test('append: 2 new lines onto an entry with 9 existing body lines WARNs (resulting count 11, not this write\'s 2)', async () => {
  const existingBody = [];
  for (let i = 0; i < 8; i++) existingBody.push(`FILES: filler ${i}`);
  existingBody.push('STATUS: in-progress');
  const dir = makeProject(
    SEED + `\n## [2026-08-10] testagent cli.1 | build — write mechanics\n${existingBody.join('\n')}\n`
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'new one', '--body', 'new two']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /WARN: entry body is 11 lines \(canon: bodies <=10 lines, pointers not payloads\)/);
});

test('append: 1 new line onto an entry with 3 existing body lines does not WARN', async () => {
  const dir = makeProject(
    SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nFILES: b\nSTATUS: in-progress\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'one more']);
  assert.equal(res.code, 0);
  assert.ok(!res.err.join('\n').includes('entry body is'));
});

test('append: over 100 body lines or 16KB is a hard reject', async () => {
  const dir = projectWithOpenEntry();
  const args = ['append', 'cli', '--tag', 'testagent'];
  for (let i = 0; i < 101; i++) args.push('--body', `line ${i}`);
  const res = await run(dir, args);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /too large/);
});

test('append: empty-after-normalization body is rejected', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', '\n\n\n']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /at least one body line/);
});

test('append: ghost target proceeds with a stderr WARN', async () => {
  const dir = makeProject(
    SEED + '\n## [2020-01-01] testagent cli.1 | build — ancient\nAPPROACH: old.\nSTATUS: in-progress\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /ghost/i);
});

// =====================================================================
// close
// =====================================================================

test('close: --next is a structural requirement at parse time (terminal always needs an owned NEXT)', () => {
  assert.throws(
    () => parseLogArgs(['close', 'cli', '--tag', 'testagent', '--status', 'complete']),
    /--next/
  );
});

test('close: a pre-composed --next with no owner before the em-dash is rejected', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next', '— no owner here']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /must be owned/);
});

test('NEXT: an empty composed action (--next-owner t --next "") is rejected, not silently written', async () => {
  const dir = makeProject();
  const before = readLog(dir);
  const res = await run(dir, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
    '--next-owner', 't', '--next', '',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /--next action is empty — NEXT must say what happens next/);
  assert.equal(readLog(dir), before);
});

test('NEXT: a whitespace-only composed action (--next-owner t --next "   ") is rejected', async () => {
  const dir = makeProject();
  const before = readLog(dir);
  const res = await run(dir, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
    '--next-owner', 't', '--next', '   ',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /--next action is empty — NEXT must say what happens next/);
  assert.equal(readLog(dir), before);
});

test('NEXT: a pre-composed "t — " with an empty action is rejected, not silently written', async () => {
  const dir = projectWithOpenEntry();
  const before = readLog(dir);
  const res = await run(dir, ['close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next', 't — ']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /--next action is empty — NEXT must say what happens next/);
  assert.equal(readLog(dir), before);
});

test('close: --status in-progress is rejected, points to append', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'in-progress', '--next-owner', 't', '--next', 'x',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /banana log append for checkpoints/);
});

test('close: near-miss dash separators are rejected with the em-dash-education message', async () => {
  const dir = projectWithOpenEntry();
  for (const bad of ['t - x', 't \u2013 x', 't \u2015 x', 't -- x']) {
    const d = projectWithOpenEntry();
    const res = await run(d, ['close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next', bad]);
    assert.equal(res.code, 1, bad);
    assert.match(res.err.join('\n'), /em-dash \(U\+2014\)/);
  }
});

test('close: --next-owner + --next composes a real em-dash', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'alice', '--next', 'review it',
  ]);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.ok(text.includes('NEXT: alice \u2014 review it'));
});

test('close: --blocked lands its own line', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'blocked', '--blocked', 'waiting on review',
    '--next-owner', 't', '--next', 'ping reviewer',
  ]);
  assert.equal(res.code, 0);
  assert.match(readLog(dir), /BLOCKED: waiting on review\nSTATUS: blocked/);
});

test('close: STATUS qualifier keeps the remainder verbatim', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete (pending PR review)', '--next-owner', 't', '--next', 'x',
  ]);
  assert.equal(res.code, 0);
  assert.match(readLog(dir), /STATUS: complete \(pending PR review\)/);
});

test('close: promotion notice fires on a DECISION line, not on a plain close', async () => {
  const withDecision = makeProject(
    SEED +
      '\n## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nDECISION: went with X.\nSTATUS: in-progress\n'
  );
  const res1 = await run(withDecision, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 't', '--next', 'x',
  ]);
  assert.equal(res1.code, 0);
  assert.match(res1.err.join('\n'), /promotion to LOGBOOK\.md is mandatory/);

  const plain = projectWithOpenEntry();
  const res2 = await run(plain, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 't', '--next', 'x',
  ]);
  assert.equal(res2.code, 0);
  assert.ok(!res2.err.join('\n').includes('promotion'));
});

test('close: PROBLEM with no FIX triggers promotion; PROBLEM with FIX does not', async () => {
  const noFix = makeProject(
    SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nPROBLEM: it broke.\nSTATUS: in-progress\n'
  );
  const res1 = await run(noFix, ['close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 't', '--next', 'x']);
  assert.match(res1.err.join('\n'), /promotion/);

  const withFix = makeProject(
    SEED +
      '\n## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nPROBLEM: it broke.\nFIX: patched.\nSTATUS: in-progress\n'
  );
  const res2 = await run(withFix, ['close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 't', '--next', 'x']);
  assert.ok(!res2.err.join('\n').includes('promotion'));
});

// =====================================================================
// supersede
// =====================================================================

function projectWithClosedCli1() {
  return makeProject(
    SEED + '\n## [2026-08-01] testagent cli.1 | build — old\nAPPROACH: a.\nSTATUS: complete\nNEXT: testagent — x\n'
  );
}

test('supersede: typo guard — reason wrapped in parens is rejected, file untouched', async () => {
  const dir = projectWithClosedCli1();
  const before = readLog(dir);
  const res = await run(dir, [
    'supersede', 'cli.1', '--tag', 'testagent', '--reason', '(oops typo)', '--status', 'abandoned',
    '--next-owner', 't', '--next', 'redo',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /tool adds the parentheses/);
  assert.equal(readLog(dir), before);
});

test('supersede: superseding another agent\'s entry notes the foreign author', async () => {
  const dir = projectWithClosedCli1(); // authored by testagent
  const res = await run(dir, [
    'supersede', 'cli.1', '--tag', 'alice', '--reason', 'handoff correction', '--status', 'abandoned',
    '--next-owner', 'alice', '--next', 'redo',
  ]);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /note: cli\.1 was authored by 'testagent', not 'alice'/);
});

test('supersede: a leading-zero numeric target (cli.02) resolves to n=2', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent cli.1 | build — one\nSTATUS: complete\nNEXT: t — x\n\n' +
      '## [2026-08-02] testagent cli.2 | build — two\nSTATUS: complete\nNEXT: t — x\n'
  );
  const res = await run(dir, [
    'supersede', 'cli.02', '--tag', 'testagent', '--reason', 'correction', '--status', 'abandoned',
    '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(res.code, 0);
  assert.match(readLog(dir), /SUPERSEDES: cli\.2 \(correction\)/);
});

test('supersede: unknown id lists known ids for the feature', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent cli.1 | build — one\nSTATUS: complete\nNEXT: t — x\n\n' +
      '## [2026-08-02] testagent cli.2 | build — two\nSTATUS: complete\nNEXT: t — x\n'
  );
  const res = await run(dir, [
    'supersede', 'cli.99', '--tag', 'testagent', '--reason', 'typo', '--status', 'abandoned', '--next-owner', 't', '--next', 'redo',
  ]);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /known: cli\.1, cli\.2/);
});

test('feature slug: a dotted stub feature suggests supersede', async () => {
  const dir = makeProject();
  const res = await run(dir, ['stub', 'cli.4', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /banana log supersede cli\.4/);
});

test('feature slug: a non-dotted invalid shape gets a plain shape error', async () => {
  const dir = makeProject();
  const res = await run(dir, ['stub', 'bad slug!', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /feature slug must match/);
});

test('supersede: bad target shape is rejected before any resolution', async () => {
  const dir = projectWithClosedCli1();
  const res = await run(dir, ['supersede', 'cli', '--tag', 't', '--reason', 'x', '--status', 'abandoned', '--next-owner', 't', '--next', 'y']);
  assert.equal(res.code, 1);
  assert.match(res.err.join('\n'), /\{feature\}\.\{n\}/);
});

test('supersede: ambiguous id requires --target-agent to disambiguate', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] alice dup.1 | build — a version\nSTATUS: complete\nNEXT: alice — x\n\n' +
      '## [2026-08-02] bob dup.1 | build — b version\nSTATUS: complete\nNEXT: bob — x\n'
  );
  const ambiguous = await run(dir, [
    'supersede', 'dup.1', '--tag', 'testagent', '--reason', 'x', '--status', 'abandoned', '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.err.join('\n'), /ambiguous/);
  assert.match(ambiguous.err.join('\n'), /--target-agent/);

  const resolved = await run(dir, [
    'supersede', 'dup.1', '--tag', 'testagent', '--target-agent', 'alice', '--reason', 'x', '--status', 'abandoned',
    '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(resolved.code, 0);
  assert.match(readLog(dir), /SUPERSEDES: dup\.1 \(x\)/);
});

test('supersede: an archive-only target resolves with a stderr note naming the archive', async () => {
  const dir = makeProject(SEED + '\n## [2026-08-02] testagent cli.2 | build — two\nSTATUS: complete\nNEXT: t — x\n');
  makeArchive(dir, '2026-Q1.log', '## [2026-02-01] testagent cli.1 | build — archived one\nSTATUS: complete\nNEXT: t — x\n');
  const res = await run(dir, [
    'supersede', 'cli.1', '--tag', 'testagent', '--reason', 'correction', '--status', 'abandoned',
    '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /2026-Q1\.log/);
  // New entry lands in the ACTIVE log, n computed over active+archive union (max 2 -> 3).
  assert.deepEqual(res.out, ['cli.3']);
});

test('supersede: --feature redirects the new entry cross-feature, n computed for that feature', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-01] testagent old-name.1 | ops — renamed\nSTATUS: complete\nNEXT: t — x\n\n' +
      '## [2026-08-02] testagent newname.1 | ops — already exists\nSTATUS: complete\nNEXT: t — x\n'
  );
  const res = await run(dir, [
    'supersede', 'old-name.1', '--tag', 'testagent', '--feature', 'newname', '--reason', 'renamed project',
    '--status', 'complete', '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['newname.2']);
  assert.match(readLog(dir), /SUPERSEDES: old-name\.1 \(renamed project\)/);
});

test('supersede: title/phase copied from target by default, overridable', async () => {
  const dir = projectWithClosedCli1();
  const copied = await run(dir, [
    'supersede', 'cli.1', '--tag', 'testagent', '--reason', 'correct it', '--status', 'abandoned', '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(copied.code, 0);
  assert.match(readLog(dir), /cli\.2 \| build — old/);

  const dir2 = projectWithClosedCli1();
  const overridden = await run(dir2, [
    'supersede', 'cli.1', '--tag', 'testagent', '--reason', 'correct it', '--status', 'abandoned',
    '--title', 'new title', '--phase', 'review', '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(overridden.code, 0);
  assert.match(readLog(dir2), /cli\.2 \| review — new title/);
});

test('supersede: ghost-close flow — supersede a stale open entry as abandoned', async () => {
  const dir = makeProject(
    SEED + '\n## [2020-01-01] testagent cli.4 | build — stale\nAPPROACH: x.\nSTATUS: in-progress\n'
  );
  const res = await run(dir, [
    'supersede', 'cli.4', '--tag', 'testagent', '--reason', 'ghost, >48h', '--status', 'abandoned',
    '--next-owner', 'testagent', '--next', 're-scope and reopen',
  ]);
  assert.equal(res.code, 0);
  const entries = parseSessionLog(readLog(dir));
  const ids = supersededIds(entries);
  assert.ok(ids.has('cli.4'));
});

test('supersede: terminal status without NEXT is rejected; in-progress supersede needs none', async () => {
  const dir = projectWithClosedCli1();
  const noNext = await run(dir, ['supersede', 'cli.1', '--tag', 't', '--reason', 'x', '--status', 'complete']);
  assert.equal(noNext.code, 1);
  assert.match(noNext.err.join('\n'), /terminal STATUS/);

  const dir2 = projectWithClosedCli1();
  const openCorrection = await run(dir2, ['supersede', 'cli.1', '--tag', 't', '--reason', 'reopening', '--status', 'in-progress']);
  assert.equal(openCorrection.code, 0);
});

// =====================================================================
// concurrency guard / continuation
// =====================================================================

function projectWithIntruder() {
  return makeProject(
    SEED +
      '\n## [2026-08-10] testagent cli.1 | build — write mechanics\nAPPROACH: implement.\nSTATUS: in-progress\n\n' +
      '## [2026-08-11] alice other.1 | build — unrelated work\nSTATUS: complete\nNEXT: alice — x\n'
  );
}

test('continuation: append after an intruder writes a continuation carrying STATUS: in-progress', async () => {
  const dir = projectWithIntruder();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint line']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.2']);
  const text = readLog(dir);
  assert.match(text, /cli\.2 \| build — write mechanics/); // phase/title copied
  assert.match(text, /SUPERSEDES: cli\.1 \(continuation — closes the entry left open above\)\nSTATUS: in-progress\ncheckpoint line/);
  assert.match(res.err.join('\n'), /note: cli\.1 was no longer the last heading — wrote continuation cli\.2/);
});

test('continuation: close after an intruder writes close lines directly (no in-progress line)', async () => {
  const dir = projectWithIntruder();
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
  ]);
  assert.equal(res.code, 0);
  // res.out[0] is the id line; res.out[1+] is the post-close state-lint
  // block (#14) — its own content is covered by the dedicated tests below.
  assert.equal(res.out[0], 'cli.2');
  const text = readLog(dir);
  const cli2Body = text.slice(text.indexOf('cli.2'));
  assert.ok(!cli2Body.includes('STATUS: in-progress'));
  assert.match(cli2Body, /SUPERSEDES: cli\.1 \(continuation — closes the entry left open above\)\nSTATUS: complete\nNEXT: testagent — ship/);
});

test('continuation: a mangled /^## \\[/ intruder also triggers continuation, plus a corrupt-heading WARN', async () => {
  const dir = makeProject(
    SEED +
      '\n## [2026-08-10] testagent cli.1 | build — write mechanics\nAPPROACH: implement.\nSTATUS: in-progress\n\n' +
      '## [2026-08-11] testagent cli.9 build - hyphen not em-dash (malformed)\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.2']);
  assert.match(res.err.join('\n'), /corrupt heading at line/);
});

test('continuation: --no-continue refuses instead of writing, file untouched', async () => {
  const dir = projectWithIntruder();
  const before = readLog(dir);
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'x', '--no-continue']);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /cli\.1 is no longer the last heading/);
  assert.match(res.err.join('\n'), /cli\.2/);
  assert.equal(readLog(dir), before);
});

test('continuation (close): --no-continue refuses instead of writing, file untouched', async () => {
  const dir = projectWithIntruder();
  const before = readLog(dir);
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
    '--no-continue',
  ]);
  assert.equal(res.code, 2);
  assert.match(res.err.join('\n'), /cli\.1 is no longer the last heading/);
  assert.match(res.err.join('\n'), /cli\.2/);
  assert.equal(readLog(dir), before);
});

test('GOLDEN: the continuation-entry byte shape (append) matches canon SESSION-LOG.md §3 exactly', async () => {
  const dir = projectWithIntruder();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint line']);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  const entry = text.slice(text.indexOf('## [2026-08-12] testagent cli.2'));
  assert.equal(
    entry,
    '## [2026-08-12] testagent cli.2 | build — write mechanics\n' +
      'SUPERSEDES: cli.1 (continuation — closes the entry left open above)\n' +
      'STATUS: in-progress\n' +
      'checkpoint line\n'
  );
});

test('BOM: a heading-first BOM\'d log appends in place, no spurious continuation', async () => {
  const dir = makeProject('﻿## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nSTATUS: in-progress\n');
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, ['cli.1']);
  assert.ok(!res.err.join('\n').includes('continuation'));
  assert.ok(!res.err.join('\n').includes('note:'));
  const text = readLog(dir);
  assert.match(text, /checkpoint/);
  assert.ok(!text.includes('cli.2'));
});

test('body: a lone CR (no LF) splits into two lines, matching \\r\\n/\\n behavior', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'line one\rline two']);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.match(text, /line one\nline two/);
  assert.ok(!text.includes('\r'));
});

test('continuation cascade: a second append after a continuation targets it directly (no second continuation)', async () => {
  const dir = projectWithIntruder();
  const first = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'first checkpoint']);
  assert.deepEqual(first.out, ['cli.2']);
  const second = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'second checkpoint']);
  assert.equal(second.code, 0);
  assert.deepEqual(second.out, ['cli.2']); // same entry, not cli.3
  assert.ok(!second.err.join('\n').includes('continuation'));
  const text = readLog(dir);
  assert.ok(!text.includes('cli.3'));
  assert.match(text, /first checkpoint\nsecond checkpoint/);
});

// =====================================================================
// write mechanics
// =====================================================================

test('write mechanics: CRLF log keeps CRLF for the appended block', async () => {
  const dir = makeProject(
    SEED.replaceAll('\n', '\r\n') +
      '\r\n## [2026-08-10] testagent cli.1 | build — x\r\nAPPROACH: a.\r\nSTATUS: in-progress\r\n'
  );
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.ok(text.includes('checkpoint\r\n'));
  assert.ok(!/[^\r]\n/.test(text.slice(text.indexOf('checkpoint'))), 'no bare LF introduced after the append point');
});

test('write mechanics: no trailing newline gets a terminator inserted, never glued', async () => {
  const dir = makeProject(SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nAPPROACH: a.\nSTATUS: in-progress');
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.ok(!text.includes('in-progresscheckpoint'));
  assert.match(text, /STATUS: in-progress\ncheckpoint\n/);
});

test('write mechanics: 2+ trailing blank lines before a new heading get nothing added', async () => {
  const before = SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nSTATUS: complete\nNEXT: t — x\n\n\n\n';
  const dir = makeProject(before);
  const res = await run(dir, ['stub', 'other', '--tag', 't', '--phase', 'build', '--title', 'y', '--approach', 'a']);
  assert.equal(res.code, 0);
  const text = readLog(dir);
  assert.equal(text, before + '## [2026-08-12] t other.1 | build — y\nAPPROACH: a\nSTATUS: in-progress\n');
});

test('write mechanics: single-appendFileSync atomicity — file after equals before + exact composed bytes', async () => {
  const dir = projectWithOpenEntry();
  const before = readLog(dir);
  const dry = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint', '--dry-run']);
  const real = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(real.code, 0);
  const after = readLog(dir);
  assert.equal(after, before + dry.out[0]);
});

test('--dry-run: prints exact bytes, touches nothing, exit 0', async () => {
  const dir = projectWithOpenEntry();
  const before = readLog(dir);
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint', '--dry-run']);
  assert.equal(res.code, 0);
  assert.equal(res.out.length, 1);
  assert.match(res.out[0], /checkpoint\n$/);
  assert.equal(readLog(dir), before);
});

test('--dry-run on a new-heading write includes the leading separator newlines', async () => {
  const dir = makeProject(SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nSTATUS: complete\nNEXT: t — x\n');
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'y', '--approach', 'a', '--dry-run']);
  assert.equal(res.code, 0);
  assert.ok(res.out[0].startsWith('\n'), 'blank-line separator included in the dry-run bytes');
  assert.equal(readLog(dir), SEED + '\n## [2026-08-10] testagent cli.1 | build — x\nSTATUS: complete\nNEXT: t — x\n');
});

test('--dry-run: advisories still fire — ghost WARN and body-length WARN both emitted, file untouched', async () => {
  const dir = makeProject(
    SEED + '\n## [2020-01-01] testagent cli.1 | build — ancient\nAPPROACH: old.\nSTATUS: in-progress\n'
  );
  const before = readLog(dir);
  const args = ['append', 'cli', '--tag', 'testagent', '--dry-run'];
  for (let i = 0; i < 9; i++) args.push('--body', `line ${i}`);
  const res = await run(dir, args);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /ghost/i);
  assert.match(res.err.join('\n'), /WARN: entry body is 11 lines \(canon: bodies <=10 lines, pointers not payloads\)/);
  assert.equal(readLog(dir), before);
});

test('--dry-run: a continuation still emits the note: line on stderr, file untouched', async () => {
  const dir = projectWithIntruder();
  const before = readLog(dir);
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint', '--dry-run']);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /note: cli\.1 was no longer the last heading — wrote continuation cli\.2/);
  assert.equal(readLog(dir), before);
});

test('--dry-run: byte-exact via an injected io.write sink (io.write ?? io.out)', async () => {
  const dir = projectWithOpenEntry();
  const before = readLog(dir);
  const dry = await runWithWriteSink(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.deepEqual(dry.out, [], 'dry-run bytes go through io.write, not io.out, once a write sink is injected');
  assert.equal(dry.writes.length, 1);
  const real = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(real.code, 0);
  const after = readLog(dir);
  assert.equal(after, before + dry.writes[0]);
});

test('stdout id line suppressed by --quiet, exit code and file write unaffected', async () => {
  const dir = projectWithOpenEntry();
  const res = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint', '--quiet']);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, []);
  assert.match(readLog(dir), /checkpoint/);
});

test('exit codes: 0 ok / 1 usage-validation / 2 state-precondition, exactly', async () => {
  const dir = projectWithOpenEntry();
  const ok = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'x']);
  assert.equal(ok.code, 0);
  const usage = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'STATUS: sneaky']);
  assert.equal(usage.code, 1);
  const state = await run(dir, ['append', 'nope', '--tag', 'testagent', '--body', 'x']);
  assert.equal(state.code, 2);
});

test('stub: 10 --body lines compose a 12-line entry body and WARN (resulting body, not just this write)', async () => {
  const dir = makeProject();
  const args = ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a'];
  for (let i = 0; i < 10; i++) args.push('--body', `line ${i}`);
  const res = await run(dir, args);
  assert.equal(res.code, 0);
  assert.match(res.err.join('\n'), /WARN: entry body is 12 lines \(canon: bodies <=10 lines, pointers not payloads\)/);
});

test('envelope round-trip: an exotic-but-legal title composes and parses back on a real write', async () => {
  const dir = makeProject();
  const title = 'title with an em-dash \u2014 and, punctuation!';
  const res = await run(dir, ['stub', 'cli', '--tag', 't', '--phase', 'build', '--title', title, '--approach', 'a']);
  assert.equal(res.code, 0);
  const [entry] = parseSessionLog(readLog(dir));
  assert.equal(entry.title, title);
});

// =====================================================================
// state lint wiring (#14) \u2014 `log close`/terminal `log stub` carry the
// early catch (brief carries the guarantee; this is a second chance to
// catch drift for a session that closes cleanly).
// =====================================================================

// A lint-clean project page: all six required sections present, `## Next`
// left empty (no bullets to own-check), and an as-of date far enough in the
// future that no session-log fixture used below can ever stale it.
const CLEAN_PROJECT_STATE = [
  '# STATE \u2014 fixture',
  '> Projection of LOGBOOK.md as of 2099-01-01 (through none).',
  '',
  '## Now',
  '- x',
  '',
  '## Truths',
  '- x',
  '',
  '## Next',
  '',
  '## Blocked',
  '- x',
  '',
  '## Watch',
  '- x',
  '',
  '## Dead ends',
  '- x',
  '',
].join('\n');

const BROKEN_PROJECT_STATE = CLEAN_PROJECT_STATE.replace('## Blocked\n- x\n\n', '');

test('log close: a clean project+global lint prints the summary line after the id line, exit 0', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), CLEAN_PROJECT_STATE, 'utf8');
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
  ]);
  assert.equal(res.code, 0);
  assert.equal(res.out[0], 'cli.1');
  assert.equal(res.out[1], 'project: PASS \u00b7 global: none (no ~/.agents/STATE.md)');
});

test('log close: a FAIL project page prints its finding lines and the fix-it closing line, exit still 0', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
  ]);
  assert.equal(res.code, 0);
  const printed = res.out.join('\n');
  assert.match(printed, /FAIL \[missing-section\] STATE\.md: missing required section "## Blocked"/);
  assert.match(printed, /Fix these before relying on the page: a FAIL means STATE no longer projects its sources\./);
});

test('log stub: a terminal --status lints; a non-terminal (default in-progress) stub does not', async () => {
  const dirTerminal = makeProject();
  writeFileSync(join(dirTerminal, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const terminal = await run(dirTerminal, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
    '--status', 'complete', '--next-owner', 't', '--next', 'ship it',
  ]);
  assert.equal(terminal.code, 0);
  assert.match(terminal.out.join('\n'), /FAIL \[missing-section\]/);

  const dirInProgress = makeProject();
  writeFileSync(join(dirInProgress, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const inProgress = await run(dirInProgress, [
    'stub', 'cli', '--tag', 't', '--phase', 'build', '--title', 'x', '--approach', 'a',
  ]);
  assert.equal(inProgress.code, 0);
  assert.deepEqual(inProgress.out, ['cli.1']);
});

test('log append and supersede never lint, even with a FAIL project page present', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const appendRes = await run(dir, ['append', 'cli', '--tag', 'testagent', '--body', 'checkpoint']);
  assert.equal(appendRes.code, 0);
  assert.deepEqual(appendRes.out, ['cli.1']);

  const dir2 = projectWithClosedCli1();
  writeFileSync(join(dir2, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const supersedeRes = await run(dir2, [
    'supersede', 'cli.1', '--tag', 'testagent', '--reason', 'correction', '--status', 'abandoned',
    '--next-owner', 't', '--next', 'y',
  ]);
  assert.equal(supersedeRes.code, 0);
  assert.deepEqual(supersedeRes.out, ['cli.2']);
});

test('log close --dry-run: no lint is printed (nothing was closed)', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
    '--dry-run',
  ]);
  assert.equal(res.code, 0);
  assert.ok(!res.out.some((l) => l.includes('project:')));
  assert.ok(!res.out.some((l) => l.startsWith('FAIL')));
});

test('log close --quiet: a clean lint prints nothing lint-related (id line also suppressed)', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), CLEAN_PROJECT_STATE, 'utf8');
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
    '--quiet',
  ]);
  assert.equal(res.code, 0);
  assert.deepEqual(res.out, []);
});

test('log close --quiet: a FAIL project lint still prints the summary line and every finding', async () => {
  const dir = projectWithOpenEntry();
  writeFileSync(join(dir, 'STATE.md'), BROKEN_PROJECT_STATE, 'utf8');
  const res = await run(dir, [
    'close', 'cli', '--tag', 'testagent', '--status', 'complete', '--next-owner', 'testagent', '--next', 'ship',
    '--quiet',
  ]);
  assert.equal(res.code, 0);
  const printed = res.out.join('\n');
  assert.match(printed, /project: FAIL \(1 fail, 0 warn\) \u00b7 global: none \(no ~\/\.agents\/STATE\.md\)/);
  assert.match(printed, /FAIL \[missing-section\] STATE\.md: missing required section "## Blocked"/);
  assert.match(printed, /Fix these before relying on the page/);
});
