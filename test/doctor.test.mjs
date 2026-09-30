// US-010 acceptance: the doctor command reports detected harnesses + fence
// block versions and runs the four liveness audits from docs/DESIGN.md —
// ghosts (in-progress > 48h), unowned NEXT lines, stale STATE.md projection,
// continuity files over the 700-line rotation threshold. Seeded-violation
// fixture flags all four types with exit 1; a clean fixture exits 0; --verify
// prints (never executes) the per-harness recital commands.
// US-007 (v2) acceptance: two upstream audits — a home canon dir missing or
// older than the kit's bundled canon, and any wired fence block older than
// its current template — each flagged with exit 1 and a finding naming sync;
// a current canon + current fences add no finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  auditProject,
  auditUpstream,
  canonRev,
  newestLogbookDate,
  parseDoctorArgs,
  ROTATION_THRESHOLD_LINES,
  runDoctor,
  stateAsOf,
  stateAsOfMalformed,
} from '../lib/doctor.mjs';
import { fencedBlock } from '../lib/fence.mjs';
import { CANON_FILES } from '../lib/init.mjs';
import { wiringTemplateVersion } from '../lib/wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fence version the current claude-code wiring template declares. */
const CURRENT_FENCE = wiringTemplateVersion('claude-code.md');

/** Fixed clock: audits must be deterministic, never read the real time. */
const NOW = Date.parse('2026-07-04T12:00:00Z');

/** Empty PATH so detection sees only the sandbox home, never this machine. */
const ENV = { PATH: '' };

/** @param {import('node:test').TestContext} t @returns {string} */
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Install the kit's bundled canon into a sandbox home — the current-canon
 * baseline every home fixture needs now that a missing/stale canon is itself
 * a finding.
 * @param {string} home
 * @returns {string} the canon dir
 */
function installCanon(home) {
  const canonDir = join(home, '.agents', 'canon');
  mkdirSync(canonDir, { recursive: true });
  for (const name of CANON_FILES) copyFileSync(join(KIT_ROOT, 'canon', name), join(canonDir, name));
  return canonDir;
}

/** Captured-output io. */
function capturedIo() {
  /** @type {string[]} */
  const lines = [];
  return {
    lines,
    text: () => lines.join('\n'),
    io: { out: (/** @type {string} */ line = '') => lines.push(line) },
  };
}

/**
 * Snapshot every file under root: relative path -> content bytes.
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
function snapshot(root) {
  const files = new Map();
  const walk = (/** @type {string} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return files;
}

/**
 * Project fixture violating all four audits: a ghost entry, an unowned NEXT,
 * a STATE.md older than the newest LOGBOOK entry, and an oversize LOGBOOK.
 * @param {import('node:test').TestContext} t
 */
function seededProject(t) {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — seeded fixture',
      '',
      '## [2026-06-20] claude payments.1 | build — Retry queue spike',
      'APPROACH: exponential backoff via a cron sweep.',
      'STATUS: in-progress',
      'NEXT: pick a retry ceiling',
      '',
      '## [2026-07-04] claude checkout.1 | build — Checkout flow',
      'APPROACH: thin controller over the cart model.',
      'STATUS: complete',
      'NEXT: claude — wire the webhook next session',
      '',
    ].join('\n'),
  );
  const filler = Array.from({ length: ROTATION_THRESHOLD_LINES }, (_, i) => `- filler ${i}`);
  writeFileSync(
    join(dir, 'LOGBOOK.md'),
    [
      '# LOGBOOK — fixture',
      '',
      '## [2026-06-20] owner banana.1 | DECISION — Ship the kit',
      'WHAT: decision body.',
      ...filler,
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'STATE.md'),
    [
      '# STATE — fixture',
      '> Projection of LOGBOOK.md as of 2026-06-01 (through banana.1).',
      '',
      '## Now',
      '- fixture focus',
      '',
    ].join('\n'),
  );
  return dir;
}

/**
 * Project fixture with a healthy record: closed entries, owned NEXT, a fresh
 * STATE.md projection, everything under the rotation threshold.
 * @param {import('node:test').TestContext} t
 */
function cleanProject(t) {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — clean fixture',
      '',
      '## [2026-07-03] claude checkout.1 | build — Checkout flow',
      'APPROACH: thin controller over the cart model.',
      'STATUS: complete',
      'NEXT: claude — wire the webhook next session',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'LOGBOOK.md'),
    [
      '# LOGBOOK — fixture',
      '',
      '## [2026-07-03] owner banana.1 | DECISION — Ship the kit',
      'WHAT: decision body.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'STATE.md'),
    ['# STATE — fixture', '> Projection of LOGBOOK.md as of 2026-07-03 (through banana.1).', ''].join('\n'),
  );
  return dir;
}

test('parseDoctorArgs: defaults, --verify, unknown option', () => {
  assert.deepEqual(parseDoctorArgs([]), { verify: false });
  assert.deepEqual(parseDoctorArgs(['--verify']), { verify: true });
  assert.throws(() => parseDoctorArgs(['--bogus']), /unknown doctor option/);
});

test('stateAsOf and newestLogbookDate parse dates, tolerate their absence', () => {
  assert.equal(stateAsOf('> Projection of LOGBOOK.md as of 2026-07-01 (through x.1).'), '2026-07-01');
  assert.equal(stateAsOf('> Projection of LOGBOOK.md as of (date).'), null);
  const logbook = '## [2026-06-01] a x.1 | DECISION — one\n## [2026-06-20] a x.2 | FIX — two\n';
  assert.equal(newestLogbookDate(logbook), '2026-06-20');
  assert.equal(newestLogbookDate('# no entries yet\n'), null);
});

// Review hardening 2026-09-28 (F3/F4/F10): header-only scope, case-insensitive,
// last match wins, and a date-shaped-but-impossible value is distinguishable
// from "no date" via stateAsOfMalformed rather than silently null either way.
test('stateAsOf: case-insensitive "As of", header-only scope, last match wins', () => {
  assert.equal(stateAsOf('> Projection. As of 2026-09-28.'), '2026-09-28', 'capital "As of" recognized');
  // Body text (past the first "## " heading) is out of scope — a date
  // mentioned only in a body section must not date an otherwise-undated page.
  const bodyOnly = '# STATE — x\n> Projection of LOGBOOK.md.\n\n## Dead ends\n- tried X as of 2026-09-28; abandoned\n';
  assert.equal(stateAsOf(bodyOnly), null, 'a body-only "as of" does not count');
  // Two header mentions: the LAST one wins (the real projection line, not an
  // earlier "rebuilt from the plan as of ..." aside).
  const twoMentions = '# STATE — x\n> Rebuilt from the plan as of 2026-01-01; projection of LOGBOOK.md as of 2026-09-28.\n';
  assert.equal(stateAsOf(twoMentions), '2026-09-28');
});

test('stateAsOf / stateAsOfMalformed: a date-shaped but impossible value is distinguishable from absent', () => {
  assert.equal(stateAsOf('> as of 2026-13-45'), null, 'month 13 is not a real date');
  assert.equal(stateAsOfMalformed('> as of 2026-13-45'), '2026-13-45');
  assert.equal(stateAsOf('> as of 2026-09-31'), null, 'September has no 31st');
  assert.equal(stateAsOfMalformed('> as of 2026-09-31'), '2026-09-31');
  assert.equal(stateAsOf('> as of 2026-02-30'), null, 'February has no 30th');
  assert.equal(stateAsOfMalformed('> as of 2026-02-30'), '2026-02-30');
  // A genuinely absent date: both return null, not just stateAsOf.
  assert.equal(stateAsOf('> Projection of LOGBOOK.md as of (date).'), null);
  assert.equal(stateAsOfMalformed('> Projection of LOGBOOK.md as of (date).'), null);
});

test('seeded-violation fixture: all four audit types flagged, exit 1, nothing written', async (t) => {
  const project = seededProject(t);
  const home = sandbox(t);
  installCanon(home);
  const before = snapshot(project);

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });

  assert.equal(result.code, 1, 'findings must exit 1');
  const output = captured.text();
  assert.ok(output.includes('[ghost]'), 'ghost flagged');
  assert.ok(output.includes('payments.1'), 'ghost names the entry');
  assert.ok(output.includes('[unowned-next]'), 'unowned NEXT flagged');
  assert.ok(output.includes('pick a retry ceiling'), 'unowned NEXT quotes the line');
  assert.ok(output.includes('[stale-state]'), 'stale STATE.md flagged');
  assert.ok(output.includes('2026-06-01') && output.includes('2026-06-20'), 'staleness names both dates');
  assert.ok(output.includes('[oversize]'), 'oversize continuity file flagged');
  assert.ok(output.includes('LOGBOOK.md'), 'oversize names the file');
  assert.ok(!output.includes('wire the webhook'), 'owned NEXT is not a finding');

  const after = snapshot(project);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'doctor writes no files');
  for (const [path, bytes] of before) {
    assert.ok(after.get(path)?.equals(bytes), `${path} must be untouched`);
  }
});

test('auditProject: exactly the four seeded finding types, one each', (t) => {
  const project = seededProject(t);
  const findings = auditProject(project, NOW);
  assert.deepEqual(
    findings.map((f) => f.type).sort(),
    ['ghost', 'oversize', 'stale-state', 'unowned-next'],
  );
});

test('auditProject: superseded ghost entry produces no ghost finding; non-superseded ghost still flags (regression); unowned-next for the superseded entry excluded too (#17)', (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — supersede fixture',
      '',
      '## [2026-06-20] claude payments.1 | build — Retry queue spike',
      'APPROACH: exponential backoff via a cron sweep.',
      'STATUS: in-progress',
      'NEXT: pick a retry ceiling',
      '',
      '## [2026-06-20] claude billing.1 | build — a ghost that stays a ghost',
      'APPROACH: still open, never superseded.',
      'STATUS: in-progress',
      '',
      '## [2026-07-04] testagent payments.2 | build — continuation closes the ghost',
      'SUPERSEDES: payments.1 (continuation — closes the entry left open above)',
      'STATUS: complete',
      'NEXT: testagent — done',
      '',
    ].join('\n'),
  );
  const findings = auditProject(dir, NOW);
  const ghostMessages = findings.filter((f) => f.type === 'ghost').map((f) => f.message);
  assert.ok(!ghostMessages.some((m) => m.includes('payments.1')), 'superseded ghost excluded from the audit');
  assert.ok(
    ghostMessages.some((m) => m.includes('billing.1')),
    'non-superseded ghost still flagged (regression)'
  );
  // Unowned-NEXT audit now honors supersession too (#17): payments.1 is
  // superseded by payments.2, so its own unowned NEXT is excluded here.
  const unownedMessages = findings.filter((f) => f.type === 'unowned-next').map((f) => f.message);
  assert.ok(
    !unownedMessages.some((m) => m.includes('pick a retry ceiling')),
    'unowned-NEXT for a superseded entry is excluded (#17)'
  );
});

// #17: the unowned-NEXT audit skips entries retired by a SUPERSEDES:
// reference, the same exemption the ghost audit already had. Canon
// CONTINUITY rule 3 names a superseding entry as the prescribed remedy for
// an unowned NEXT; a closed entry is immutable, so without this exemption a
// malformed NEXT in it could never be cleared even after that remedy landed.

test('auditProject: unowned NEXT (hyphen, no owner) in a non-superseded entry is flagged (#17 characterization)', (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — #17 fixture',
      '',
      '## [2026-06-20] claude widgets.1 | build — Widget queue',
      'APPROACH: draft only.',
      'STATUS: complete',
      'NEXT: someone - do the thing',
      '',
    ].join('\n'),
  );
  const findings = auditProject(dir, NOW);
  const unowned = findings.filter((f) => f.type === 'unowned-next');
  assert.equal(unowned.length, 1, 'the malformed (hyphen) NEXT is flagged');
  assert.ok(unowned[0].message.includes('someone - do the thing'));
});

test('auditProject: a superseding entry clears the unowned-NEXT finding for the superseded entry (#17)', (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — #17 fixture',
      '',
      '## [2026-06-20] claude widgets.1 | build — Widget queue',
      'APPROACH: draft only.',
      'STATUS: complete',
      'NEXT: someone - do the thing',
      '',
      '## [2026-07-04] claude widgets.2 | build — restate the NEXT with an owner',
      'SUPERSEDES: widgets.1 (correction — owner restated below)',
      'STATUS: complete',
      'NEXT: claude — do the thing, now owned',
      '',
    ].join('\n'),
  );
  const findings = auditProject(dir, NOW);
  const unowned = findings.filter((f) => f.type === 'unowned-next');
  assert.equal(unowned.length, 0, "the superseded entry's unowned NEXT is excluded, and the new NEXT is owned");
});

test('auditProject: the unowned-NEXT exemption is per entry, not per log — an unrelated superseded entry does not silence a live malformed NEXT (#17)', (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(
    join(dir, '.agents', 'session.log'),
    [
      '# Session Log v2 — #17 fixture',
      '',
      '## [2026-06-20] claude widgets.1 | build — Widget queue, still live',
      'APPROACH: draft only.',
      'STATUS: complete',
      'NEXT: someone - do the thing',
      '',
      '## [2026-06-21] claude sprockets.1 | build — Sprocket spike, gets superseded',
      'APPROACH: throwaway spike.',
      'STATUS: complete',
      'NEXT: claude — cleanup',
      '',
      '## [2026-07-04] claude sprockets.2 | build — restate sprockets.1',
      'SUPERSEDES: sprockets.1 (correction)',
      'STATUS: complete',
      'NEXT: claude — carry on',
      '',
    ].join('\n'),
  );
  const findings = auditProject(dir, NOW);
  const unowned = findings.filter((f) => f.type === 'unowned-next');
  assert.equal(unowned.length, 1, 'widgets.1 is not superseded, so its malformed NEXT still flags');
  assert.ok(unowned[0].message.includes('someone - do the thing'));
});

test('auditProject: LOGBOOK.md unowned NEXT is still flagged, unaffected by session-log supersession parsing (#17, unchanged)', (t) => {
  const dir = sandbox(t);
  writeFileSync(
    join(dir, 'LOGBOOK.md'),
    [
      '# LOGBOOK — fixture',
      '',
      '## [2026-06-20] owner banana.1 | DECISION — Ship the kit',
      'WHAT: decision body.',
      'NEXT: someone - x',
      '',
    ].join('\n'),
  );
  const findings = auditProject(dir, NOW);
  const unowned = findings.filter((f) => f.type === 'unowned-next');
  assert.equal(unowned.length, 1, 'LOGBOOK.md unowned NEXT still flags');
  assert.ok(unowned[0].message.includes('LOGBOOK.md'));
});

test('clean fixture exits 0 and reports clean audits', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 0);
  assert.ok(captured.text().includes('clean — no findings'));
});

test('a dir with no continuity files is clean, not a failure', async (t) => {
  const dir = sandbox(t);
  const home = sandbox(t);
  installCanon(home);
  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: dir, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 0, 'not-a-project is not a liveness failure');
});

test('report: detected harnesses and fence versions from a wired sandbox home', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'CLAUDE.md'),
    fencedBlock('# continuity wiring', CURRENT_FENCE) + '\n',
  );
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'AGENTS.md'), '# hand-written, no fence\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 0);

  const output = captured.text();
  assert.match(output, /claude-code\s+detected/, 'claude-code detected via home dir');
  assert.match(output, /pi\s+not detected/, 'pi absent from the sandbox');
  assert.match(
    output,
    new RegExp(`CLAUDE\\.md\\s+fence v${CURRENT_FENCE}`),
    'wired file reports its fence version',
  );
  assert.match(output, /AGENTS\.md\s+\(no fence block\)/, 'unfenced file reported as such');
  assert.ok(output.includes('(file missing)'), 'missing wiring targets reported');
});

test('--verify prints recital commands for every harness, and only prints', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const before = snapshot(home);

  const withFlag = capturedIo();
  const result = await runDoctor({ verify: true }, { cwd: project, home, io: withFlag.io, now: NOW, env: ENV });
  assert.equal(result.code, 0, '--verify does not change the exit contract');
  const output = withFlag.text();
  assert.ok(output.includes('never executed'), 'verify section states the print-only contract');
  for (const command of ['claude -p', 'pi -p', 'codex exec', 'hermes -z']) {
    assert.ok(output.includes(command), `recital command for '${command}' printed`);
  }
  assert.deepEqual([...snapshot(home).keys()], [...before.keys()], 'nothing executed or written');

  const withoutFlag = capturedIo();
  await runDoctor({ verify: false }, { cwd: project, home, io: withoutFlag.io, now: NOW, env: ENV });
  assert.ok(!withoutFlag.text().includes('recital'), 'recital section only appears under --verify');
});

test('canonRev parses the marker line, tolerates its absence', () => {
  assert.equal(canonRev('<!-- banana:canon rev 1.2 -->\n# CONTINUITY\n'), '1.2');
  assert.equal(canonRev('# no marker here\n'), null);
});

test('stale canon: older rev marker flagged with exit 1, finding names sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  const canonDir = installCanon(home);
  writeFileSync(join(canonDir, 'CONTINUITY.md'), '<!-- banana:canon rev 1.1 -->\nstale\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1, 'stale canon is a finding');
  const output = captured.text();
  assert.ok(output.includes('[stale-canon]'), 'stale canon flagged');
  assert.ok(output.includes('sync'), 'finding names sync as the remediation');
  assert.ok(output.includes('rev 1.1'), 'finding names the installed rev');
  assert.ok(output.includes('CONTINUITY.md'), 'finding names the stale file');
});

test('missing canon dir flagged with exit 1, finding names sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1, 'a machine without the canon is drifted');
  const output = captured.text();
  assert.ok(output.includes('[stale-canon]'), 'missing canon dir flagged');
  assert.ok(output.includes('sync'), 'finding names sync as the remediation');
});

test('stale fence: v1 block in a wired home file flagged with exit 1, finding names sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), fencedBlock('# continuity wiring', 1) + '\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1, 'a stale fence is a finding');
  const output = captured.text();
  assert.ok(output.includes('[stale-fence]'), 'stale fence flagged');
  assert.ok(output.includes('sync'), 'finding names sync as the remediation');
  assert.ok(output.includes('CLAUDE.md'), 'finding names the wired file');
  assert.ok(
    output.includes('v1') && output.includes(`v${CURRENT_FENCE}`),
    'finding names both versions',
  );
});

test('stale fence: repo-local AGENTS.md audited too', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  writeFileSync(join(project, 'AGENTS.md'), fencedBlock('# continuity wiring', 1) + '\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1);
  const output = captured.text();
  assert.ok(output.includes('[stale-fence]'), 'project fence staleness flagged');
  assert.ok(output.includes(join(project, 'AGENTS.md')), 'finding names the project file');
});

test('corrupt fence: dangling begin marker (no end) does not throw, surfaced via fenceStatus', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), '<!-- banana:begin v2 -->\nno end marker here\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 0, 'a corrupt fence alone is a report state, not an audit finding');
  const output = captured.text();
  assert.ok(output.includes('corrupt fence'), 'corrupt fence state surfaced in the wiring report');
  assert.ok(output.includes('CLAUDE.md'), 'finding names the corrupt file');
});

test('auditUpstream: current canon + current fences add no finding; both drifts typed', (t) => {
  const cwd = sandbox(t);
  const currentHome = sandbox(t);
  installCanon(currentHome);
  mkdirSync(join(currentHome, '.claude'), { recursive: true });
  writeFileSync(
    join(currentHome, '.claude', 'CLAUDE.md'),
    fencedBlock('# continuity wiring', CURRENT_FENCE) + '\n',
  );
  assert.deepEqual(auditUpstream(currentHome, cwd), [], 'current fixture is clean');

  const driftedHome = sandbox(t);
  const canonDir = installCanon(driftedHome);
  writeFileSync(join(canonDir, 'STANDARD.md'), '<!-- banana:canon rev 1.1 -->\nstale\n');
  mkdirSync(join(driftedHome, '.claude'), { recursive: true });
  writeFileSync(join(driftedHome, '.claude', 'CLAUDE.md'), fencedBlock('# continuity wiring', 1) + '\n');
  assert.deepEqual(
    auditUpstream(driftedHome, cwd).map((f) => f.type).sort(),
    ['stale-canon', 'stale-fence'],
  );
});
