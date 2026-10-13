// US-010 acceptance: the doctor command reports detected harnesses + fence
// block versions and runs the four liveness audits from docs/DESIGN.md —
// ghosts (in-progress > 48h), unowned NEXT lines, stale STATE.md projection,
// continuity files over the 700-line rotation threshold. Seeded-violation
// fixture flags all four types with exit 1; a clean fixture exits 0; --verify
// prints (never executes) the per-harness recital commands.
// US-007 (v2) acceptance: two upstream audits — a home canon dir missing or
// older than the kit's bundled canon, and any wired fence block older than
// its current template — each flagged with exit 1 and a finding naming its fix
// command (banana sync, or banana project for the project AGENTS.md — #19, or
// banana init --harnesses <id> for a home file whose stale block has no
// owner/tag line, which sync skips — #26);
// a current canon + current fences add no finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
import { CANON_FILES, FILE_ADAPTERS, parseInitArgs, runInit } from '../lib/init.mjs';
import { parseSyncArgs, runSync } from '../lib/sync.mjs';
import { wiringTemplateVersion } from '../lib/wiring.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fence version the current claude-code wiring template declares. */
const CURRENT_FENCE = wiringTemplateVersion('claude-code.md');

/** A stale (v1) block whose identity line sync can read back: sync re-fences it. */
const STALE_FENCE = fencedBlock('- **Identity:** you are `alpha`; owner: `alice`.', 1);

/** A stale (v1) block with no owner/tag line (the #26 repro): sync skips it. */
const STALE_FENCE_NO_IDENTITY = '<!-- banana:begin v1 -->\nno identity line here\n<!-- banana:end -->\n';

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
  assert.ok(output.includes('run banana sync to refresh the canon'), 'finding names the full command');
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
  assert.ok(output.includes('run banana sync to install the canon'), 'finding names the full command');
});

test('stale fence: v1 block in a wired home file flagged with exit 1, finding names sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), STALE_FENCE + '\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1, 'a stale fence is a finding');
  const output = captured.text();
  assert.ok(output.includes('[stale-fence]'), 'stale fence flagged');
  assert.ok(output.includes('sync'), 'finding names sync as the remediation');
  assert.ok(output.includes('— run banana sync to re-fence'), 'a home file is re-fenced by banana sync');
  assert.ok(output.includes('CLAUDE.md'), 'finding names the wired file');
  assert.ok(
    output.includes('v1') && output.includes(`v${CURRENT_FENCE}`),
    'finding names both versions',
  );
});

// A real v3 agents-md block (placeholders alpha / owner-x), as the v3 kit rendered it.
const V3_AGENTS_MD_BLOCK = `<!-- banana:begin v3 -->
## Continuity bootstrap (banana)

- **Identity:** you are \`alpha\`; owner: \`owner-x\`. Sign every entry
  you author with your tag.
- **Protocol authority:** \`~/.agents/canon/\` — the harness-neutral continuity
  protocol shared by every agent and human on this machine (CONTINUITY.md,
  STANDARD.md, SESSION-LOG.md). All rules live behind this pointer, never in
  this block; on conflict, the canon wins. Read CONTINUITY.md before your
  first entry.
- **Kit:** \`banana <command>\` (commands: init · project · brief · doctor ·
  sync · log · state lint). Install once:
  \`npm install -g github:Q9-Ahimsa/banana\`; then \`banana sync\` updates the
  kit and refreshes this block. Not installed yet? Prefix
  \`npx --yes github:Q9-Ahimsa/banana\` instead. Kits can drift between
  machines: the brief prints the kit version, and \`banana doctor\` warns when
  a newer one exists.
- **Self-setup:** if this workspace (git repo or non-code topic dir) lacks
  continuity files, initialize it yourself per the canon's agent bootstrap
  section: run \`banana project\` from the workspace root.
- **Session ritual:** read \`~/.agents/STATE.md\` first (machine grain — the
  brief does not carry it), then your brief
  (\`banana brief <feature> --tag alpha\`);
  end by closing your log entry with an owned \`NEXT:\` (\`banana log close\`).
<!-- banana:end -->`;

// #10: a real v2-rendered block, as the v2 kit actually produced it (before
// this ticket's Kit-bullet rewrite) — the literal migration case the
// stale-fence audit must flag once the bundled template moves past v2.
const V2_CLAUDE_CODE_BLOCK = `<!-- banana:begin v2 -->
## Continuity bootstrap (banana)

- **Identity:** you are \`alpha\`; owner: \`owner-x\`. Sign every entry
  you author with your tag.
- **Protocol authority:** \`~/.agents/canon/\` — CONTINUITY.md (protocol),
  STANDARD.md (logbook), SESSION-LOG.md (task journal). Every continuity rule
  lives behind this pointer, not in this block; read CONTINUITY.md before your
  first entry on this machine. On conflict, the canon wins.
- **Kit:** \`npx --yes github:Q9-Ahimsa/banana <command>\` — commands: init ·
  project · brief · doctor · sync. npx always fetches the latest kit.
- **Self-setup:** landing in a workspace (git repo or non-code topic dir) with
  no continuity files, initialize it yourself per the canon's agent bootstrap
  section: run \`npx --yes github:Q9-Ahimsa/banana project\` from the workspace
  root.
- **Session ritual:** read \`~/.agents/STATE.md\` first (machine grain — the
  brief does not carry it), then your brief
  (\`npx --yes github:Q9-Ahimsa/banana brief <feature> --tag alpha\`);
  end by closing your log entry with an owned \`NEXT:\`.
<!-- banana:end -->`;

test('stale fence (#10): a real v2 claude-code block is flagged once the bundled template is newer', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), V2_CLAUDE_CODE_BLOCK + '\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1, 'a v2 fence is a finding once current is past v2');
  const output = captured.text();
  assert.ok(output.includes('[stale-fence]'), 'stale fence flagged');
  assert.ok(output.includes('sync'), 'finding names sync as the remediation');
  assert.ok(output.includes('— run banana sync to re-fence'), 'a home file is re-fenced by banana sync');
  assert.ok(output.includes('CLAUDE.md'), 'finding names the wired file');
  assert.ok(
    output.includes('v2') && output.includes(`v${CURRENT_FENCE}`),
    'finding names both the v2 block and the current version',
  );
});

test('stale fence (#24, #25): a real v3 agents-md block is flagged — banana sync for a home file, banana project for a project', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const homeAgents = join(home, '.codex', 'AGENTS.md');
  mkdirSync(dirname(homeAgents), { recursive: true });
  writeFileSync(homeAgents, V3_AGENTS_MD_BLOCK + '\n');
  const projectAgents = join(project, 'AGENTS.md');
  writeFileSync(projectAgents, V3_AGENTS_MD_BLOCK + '\n');

  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 1);
  const current = wiringTemplateVersion('agents-md.md');
  const output = captured.text();
  assert.ok(
    output.includes(`[stale-fence] ${homeAgents} fence is v3 but current is v${current} — run banana sync to re-fence`),
  );
  assert.ok(
    output.includes(`[stale-fence] ${projectAgents} fence is v3 but current is v${current} — run banana project to re-fence`),
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
  assert.ok(output.includes('— run banana project to re-fence'), 'a project fence is re-fenced by banana project');
  assert.ok(!output.includes('run banana sync to re-fence'), 'sync never touches project files');
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

// -----------------------------------------------------------------------
// #6 B: doctor's best-effort remote-vs-local version check (v2 upstream
// model, ADR 0002). Fake fetch only — no test in this suite touches the
// network. The advisory is never a Finding: it must never move the exit
// code, and any failure mode (no fetch injected, a rejection, a non-2xx
// response, unparseable JSON, a missing/unparseable version on either side,
// or remote <= local) must print nothing.
// -----------------------------------------------------------------------

/**
 * A fake fetch resolving to a JSON body, or rejecting. Only the two members
 * checkOriginAhead actually reads (`ok`, `json()`) are real; the JSDoc cast
 * below stands in for the rest of the real `Response` shape.
 * @param {unknown} body @param {{ ok?: boolean, rejectWith?: unknown }} [opts]
 * @returns {typeof globalThis.fetch}
 */
function fakeFetch(body, { ok = true, rejectWith } = {}) {
  return async () => {
    if (rejectWith) throw rejectWith;
    return /** @type {Response} */ ({ ok, json: async () => body });
  };
}

/** A sandbox "installed kit" root: just enough for readKitVersion to work. */
function sandboxKitRoot(t, version) {
  const dir = mkdtempSync(join(tmpdir(), 'banana-doctor-kitroot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-kit', version }));
  return dir;
}

test('origin-ahead: remote newer than local prints the advisory AFTER the Audits block, set off by a blank line; exit code unaffected', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '0.3.0' }), kitRoot },
  );
  assert.equal(result.code, 0, 'origin-ahead alone must not fail the exit code');
  const lines = captured.lines;
  const auditsIdx = lines.indexOf('Audits:');
  assert.notEqual(auditsIdx, -1, 'Audits: heading present');
  // Review N8: the advisory is its own paragraph AFTER the whole Audits
  // block (contradicts nothing there — it is not itself a finding), set
  // off by a blank line, in the "advice: ..." style (not "[origin-ahead]",
  // which reads as a bracketed finding even though it is never counted as
  // one).
  const cleanIdx = lines.indexOf('  clean — no findings', auditsIdx);
  assert.notEqual(cleanIdx, -1, 'clean audits line present');
  assert.equal(lines[cleanIdx + 1], '', 'a blank line separates the advice from the Audits block');
  assert.equal(lines[cleanIdx + 2], 'advice: kit v0.2.0 is behind origin v0.3.0 — run banana sync');
});

test('origin-ahead: findings present AND remote ahead — both surface, exit code still 1 (from findings alone)', async (t) => {
  const project = seededProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '0.3.0' }), kitRoot },
  );
  assert.equal(result.code, 1, 'local findings still fail the exit code');
  const output = captured.text();
  assert.ok(output.includes('[ghost]'), 'existing findings still present');
  assert.ok(
    output.includes('advice: kit v0.2.0 is behind origin v0.3.0 — run banana sync'),
    'advisory present alongside findings, in its own advice line — not counted as a finding',
  );
});

test('origin-ahead: remote equal to local prints nothing', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '0.2.0' }), kitRoot },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

test('origin-ahead: remote older than local prints nothing', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '0.1.0' }), kitRoot },
  );
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

test('origin-ahead: a non-2xx response prints nothing and does not throw', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '9.9.9' }, { ok: false }), kitRoot },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

test('origin-ahead: a rejecting fetch (network error / timeout) prints nothing and does not throw', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    {
      cwd: project,
      home,
      io: captured.io,
      now: NOW,
      env: ENV,
      fetch: fakeFetch(null, { rejectWith: new Error('simulated network failure') }),
      kitRoot,
    },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

test('origin-ahead: missing remote version prints nothing', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ notAVersion: true }), kitRoot },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

// Review N10: a genuinely malformed body (json() throws, as the real
// Response.json() does on invalid JSON text), distinct from the case above
// (valid JSON, just no usable version field).
test('origin-ahead: malformed JSON (json() throws) prints nothing and does not crash doctor', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  /** @type {typeof globalThis.fetch} */
  const throwingFetch = async () =>
    /** @type {Response} */ (/** @type {unknown} */ ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token in JSON');
      },
    }));
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: throwingFetch, kitRoot },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

// Review S3: clearTimeout must wrap BOTH the fetch AND the response.json()
// read in one finally — moving it right after the fetch (before .json())
// lets a stalled body hang doctor forever. A fake response whose json()
// only settles when the SAME AbortSignal fires proves this within budget
// (~2s, doctor's own timeout), rather than hanging the test suite.
test('origin-ahead: a response whose json() stalls resolves within doctor\'s own budget and prints nothing', { timeout: 10000 }, async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const kitRoot = sandboxKitRoot(t, '0.2.0');
  /** @type {typeof globalThis.fetch} */
  const stallingFetch = async (_url, opts) =>
    /** @type {Response} */ ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          /** @type {RequestInit | undefined} */ (opts)?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    });
  const captured = capturedIo();
  const start = Date.now();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: stallingFetch, kitRoot },
  );
  const elapsedMs = Date.now() - start;
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
  assert.ok(elapsedMs < 5000, `doctor must resolve within its own ~2s timeout budget, took ${elapsedMs}ms`);
});

test('origin-ahead: an unreadable local kit version prints nothing', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const badKitRoot = sandbox(t); // no package.json at all
  const captured = capturedIo();
  const result = await runDoctor(
    { verify: false },
    { cwd: project, home, io: captured.io, now: NOW, env: ENV, fetch: fakeFetch({ version: '9.9.9' }), kitRoot: badKitRoot },
  );
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
  assert.ok(!captured.text().includes('advice:'));
});

test('origin-ahead: no fetch dependency injected — never checked (default, back-compat)', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  const captured = capturedIo();
  const result = await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.equal(result.code, 0);
  assert.ok(!captured.text().includes('origin-ahead'));
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
  writeFileSync(join(driftedHome, '.claude', 'CLAUDE.md'), STALE_FENCE + '\n');
  assert.deepEqual(
    auditUpstream(driftedHome, cwd).map((f) => f.type).sort(),
    ['stale-canon', 'stale-fence'],
  );
});

test('stale fence (#19): each stale fence names the command that re-fences it — banana sync for a home file, banana project for the project AGENTS.md', (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const homeAgents = join(home, '.codex', 'AGENTS.md');
  const projectAgents = join(project, 'AGENTS.md');
  writeFileSync(homeAgents, STALE_FENCE + '\n');
  writeFileSync(projectAgents, fencedBlock('# continuity wiring', 1) + '\n');

  const current = wiringTemplateVersion('agents-md.md');
  const messages = auditUpstream(home, project)
    .filter((finding) => finding.type === 'stale-fence')
    .map((finding) => finding.message);
  assert.deepEqual(messages, [
    `[stale-fence] ${homeAgents} fence is v1 but current is v${current} — run banana sync to re-fence`,
    `[stale-fence] ${projectAgents} fence is v1 but current is v${current} — run banana project to re-fence`,
  ]);
});

test('stale fence (#19): with cwd in a home harness dir, the shared AGENTS.md is audited once and names banana sync', (t) => {
  const home = sandbox(t);
  installCanon(home);
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  const shared = join(codexDir, 'AGENTS.md');
  writeFileSync(shared, STALE_FENCE + '\n');

  const findings = auditUpstream(home, codexDir).filter((finding) => finding.type === 'stale-fence');
  assert.equal(findings.length, 1, findings.map((finding) => finding.message).join('\n'));
  assert.ok(findings[0].message.includes('run banana sync to re-fence'), findings[0].message);
});

test('stale fence (#19): a cwd naming the home harness dir another way (letter case, symlink) still audits the shared AGENTS.md once', (t) => {
  const home = sandbox(t);
  installCanon(home);
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, 'AGENTS.md'), STALE_FENCE + '\n');
  const linkDir = join(home, 'codex-link');
  symlinkSync(codexDir, linkDir, 'junction'); // a junction on Windows (no privilege), a dir symlink elsewhere

  const spellings = [linkDir];
  if (process.platform === 'win32') spellings.push(join(home, '.CODEX'), codexDir[0].toLowerCase() + codexDir.slice(1));
  for (const cwd of spellings) {
    assert.ok(existsSync(cwd), cwd);
    const findings = auditUpstream(home, cwd).filter((finding) => finding.type === 'stale-fence');
    assert.equal(findings.length, 1, `cwd ${cwd}:\n${findings.map((finding) => finding.message).join('\n')}`);
    assert.ok(findings[0].message.includes('run banana sync to re-fence'), findings[0].message);
  }

  // The HOME itself spelled another way (a junction to it).
  const homeLink = join(sandbox(t), 'home-link');
  symlinkSync(home, homeLink, 'junction');
  const viaHomeLink = auditUpstream(homeLink, codexDir).filter((finding) => finding.type === 'stale-fence');
  assert.equal(
    viaHomeLink.length,
    1,
    `home ${homeLink}, cwd ${codexDir}:\n${viaHomeLink.map((finding) => finding.message).join('\n')}`,
  );
  assert.ok(viaHomeLink[0].message.includes('run banana sync to re-fence'), viaHomeLink[0].message);

  // The pi harness: <home>/.pi/agent/AGENTS.md.
  const piDir = join(home, '.pi', 'agent');
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, 'AGENTS.md'), STALE_FENCE + '\n');
  const piSpellings = [piDir];
  if (process.platform === 'win32') piSpellings.push(join(home, '.PI', 'AGENT'));
  for (const cwd of piSpellings) {
    assert.ok(existsSync(cwd), cwd);
    const findings = auditUpstream(home, cwd).filter(
      (finding) => finding.type === 'stale-fence' && finding.message.includes('AGENTS.md'),
    );
    const piFindings = findings.filter((finding) => finding.message.toLowerCase().includes(join('.pi', 'agent', 'agents.md')));
    assert.equal(piFindings.length, 1, `pi, home ${home}, cwd ${cwd}:\n${findings.map((finding) => finding.message).join('\n')}`);
    assert.ok(piFindings[0].message.includes('run banana sync to re-fence'), piFindings[0].message);
    assert.equal(
      findings.filter((finding) => finding.message.includes('run banana project')).length,
      0,
      `pi, home ${home}, cwd ${cwd}:\n${findings.map((finding) => finding.message).join('\n')}`,
    );
  }
});

test('report (#19): with cwd at a home harness dir, the Wiring fences section lists the shared AGENTS.md once', async (t) => {
  const home = sandbox(t);
  installCanon(home);
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  const shared = join(codexDir, 'AGENTS.md');
  writeFileSync(shared, STALE_FENCE + '\n');

  const linkDir = join(home, 'codex-link');
  symlinkSync(codexDir, linkDir, 'junction');
  const homeLink = join(sandbox(t), 'home-link');
  symlinkSync(home, homeLink, 'junction');

  /** @type {Array<[string, string]>} */
  const runs = [
    [codexDir, home],
    [linkDir, home],
    [codexDir, homeLink],
  ];
  if (process.platform === 'win32') runs.push([join(home, '.CODEX'), home]);
  for (const [cwd, homeArg] of runs) {
    assert.ok(existsSync(cwd), cwd);
    const section = await wiringSection(cwd, homeArg);
    const label = `cwd ${cwd}, home ${homeArg}:\n${section.join('\n')}`;
    const rows = section.filter((line) => line.includes(join(homeArg, '.codex', 'AGENTS.md')));
    assert.equal(rows.length, 1, label);
    assert.ok(rows[0].trim().startsWith('codex '), label);
    assert.equal(section.filter((line) => line.trim().startsWith('project ')).length, 0, label);
  }

  // pi: <home>/.pi/agent/AGENTS.md
  const piDir = join(home, '.pi', 'agent');
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, 'AGENTS.md'), STALE_FENCE + '\n');
  const piSection = await wiringSection(piDir, home);
  const piLabel = `pi, cwd ${piDir}, home ${home}:\n${piSection.join('\n')}`;
  const piRows = piSection.filter((line) => line.includes(join(home, '.pi', 'agent', 'AGENTS.md')));
  assert.equal(piRows.length, 1, piLabel);
  assert.ok(piRows[0].trim().startsWith('pi '), piLabel);
  assert.equal(piSection.filter((line) => line.trim().startsWith('project ')).length, 0, piLabel);
});

test('report (#19): a home harness dir with no AGENTS.md yet, reached another way, is listed once', async (t) => {
  const home = sandbox(t);
  installCanon(home);
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true }); // no AGENTS.md inside
  const linkDir = join(home, 'codex-link');
  symlinkSync(codexDir, linkDir, 'junction');

  const cwds = [linkDir];
  if (process.platform === 'win32') cwds.push(join(home, '.CODEX'));
  for (const cwd of cwds) {
    assert.ok(existsSync(cwd), cwd);
    const section = await wiringSection(cwd, home);
    const label = `cwd ${cwd}, home ${home}:\n${section.join('\n')}`;
    assert.equal(section.filter((line) => line.trim().startsWith('project ')).length, 0, label);
    assert.equal(section.filter((line) => line.includes(join(home, '.codex', 'AGENTS.md'))).length, 1, label);
  }
});

test('stale fence (#19): cwd at <home>/.claude keeps its AGENTS.md a project file — the home target there is CLAUDE.md', async (t) => {
  const home = sandbox(t);
  installCanon(home);
  const claudeDir = join(home, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  let section = await wiringSection(claudeDir, home); // neither file exists yet
  assert.equal(section.filter((line) => line.trim().startsWith('project ')).length, 1, section.join('\n'));
  writeFileSync(join(claudeDir, 'CLAUDE.md'), fencedBlock('# continuity wiring', CURRENT_FENCE) + '\n');
  const projectAgents = join(claudeDir, 'AGENTS.md');
  writeFileSync(projectAgents, fencedBlock('# continuity wiring', 1) + '\n');
  section = await wiringSection(claudeDir, home);
  assert.equal(section.filter((line) => line.trim().startsWith('project ')).length, 1, section.join('\n'));
  const staleFences = auditUpstream(home, claudeDir).filter((finding) => finding.type === 'stale-fence');
  assert.deepEqual(staleFences.map((finding) => finding.message), [
    `[stale-fence] ${projectAgents} fence is v1 but current is v${wiringTemplateVersion('agents-md.md')} — run banana project to re-fence`,
  ]);
});

test('report (#19): an ordinary project lists its AGENTS.md once, under a project row', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  writeFileSync(join(project, 'AGENTS.md'), fencedBlock('# continuity wiring', 1) + '\n');
  const section = await wiringSection(project, home);
  const rows = section.filter((line) => line.trim().startsWith('project '));
  assert.equal(rows.length, 1, section.join('\n'));
  assert.ok(rows[0].includes(`${join(project, 'AGENTS.md')}  fence v1`), section.join('\n'));
});

for (const [dir, name] of [
  ['.codex', 'AGENTS.md'],
  ['.claude', 'CLAUDE.md'],
]) {
  test(`#19: a home ${dir}/${name} linked into the project (dotfiles) is audited and listed once, as the home file`, async (t) => {
    const home = sandbox(t);
    installCanon(home);
    const repo = join(home, 'dotfiles');
    mkdirSync(repo, { recursive: true });
    const repoFile = join(repo, 'AGENTS.md');
    writeFileSync(repoFile, STALE_FENCE + '\n');
    mkdirSync(join(home, dir), { recursive: true });
    const homeFile = join(home, dir, name);
    let isFileLink = true;
    try {
      symlinkSync(repoFile, homeFile, 'file');
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code !== 'EPERM' && code !== 'EACCES') throw error;
      // No symlink privilege: a junction to a directory named AGENTS.md is the same final-component link.
      isFileLink = false;
      rmSync(repoFile);
      mkdirSync(repoFile);
      symlinkSync(repoFile, homeFile, 'junction');
    }

    const section = await wiringSection(repo, home);
    const label = section.join('\n');
    assert.equal(section.filter((line) => line.trim().startsWith('project ')).length, 0, label);
    assert.equal(section.filter((line) => line.includes(homeFile)).length, 1, label);

    if (isFileLink) {
      const findings = auditUpstream(home, repo).filter((finding) => finding.type === 'stale-fence');
      assert.equal(findings.length, 1, findings.map((finding) => finding.message).join('\n'));
      assert.ok(findings[0].message.includes(homeFile), findings[0].message);
      assert.ok(findings[0].message.includes('run banana sync to re-fence'), findings[0].message);
    }
  });
}

test('stale fence (#19): the shared AGENTS.md finding names the home path whatever the cwd spelling', (t) => {
  const home = sandbox(t);
  installCanon(home);
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  const shared = join(codexDir, 'AGENTS.md');
  writeFileSync(shared, STALE_FENCE + '\n');
  const linkDir = join(home, 'codex-link');
  symlinkSync(codexDir, linkDir, 'junction');
  const current = wiringTemplateVersion('agents-md.md');
  assert.deepEqual(
    auditUpstream(home, linkDir)
      .filter((finding) => finding.type === 'stale-fence')
      .map((finding) => finding.message),
    [`[stale-fence] ${shared} fence is v1 but current is v${current} — run banana sync to re-fence`],
  );
});

/**
 * The 'Wiring fences:' section of the doctor report: its header through the line before the next blank.
 * @param {string} cwd
 * @param {string} home
 * @returns {Promise<string[]>}
 */
async function wiringSection(cwd, home) {
  const captured = capturedIo();
  await runDoctor({ verify: false }, { cwd, home, io: captured.io, now: NOW, env: ENV });
  const start = captured.lines.indexOf('Wiring fences:');
  assert.ok(start >= 0, captured.text());
  return captured.lines.slice(start, captured.lines.indexOf('', start));
}

/** The stale-fence messages doctor reports for a home + project pair. */
function staleFenceMessages(home, project) {
  return auditUpstream(home, project)
    .filter((finding) => finding.type === 'stale-fence')
    .map((finding) => finding.message);
}

test('stale fence (#26): a stale home fence with no identity line names banana init — banana sync skips it', (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const homeAgents = join(home, '.codex', 'AGENTS.md');
  const projectAgents = join(project, 'AGENTS.md');
  writeFileSync(homeAgents, STALE_FENCE_NO_IDENTITY);
  writeFileSync(projectAgents, STALE_FENCE_NO_IDENTITY);

  const current = wiringTemplateVersion('agents-md.md');
  assert.deepEqual(staleFenceMessages(home, project), [
    `[stale-fence] ${homeAgents} fence is v1 but current is v${current} — run banana init --harnesses codex to re-fence (banana sync skips a block with no owner/tag line)`,
    `[stale-fence] ${projectAgents} fence is v1 but current is v${current} — run banana project to re-fence`,
  ]);
});

test('stale fence (#26): a stale home fence with an identity line keeps banana sync', (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const homeAgents = join(home, '.codex', 'AGENTS.md');
  writeFileSync(homeAgents, STALE_FENCE + '\n');

  const current = wiringTemplateVersion('agents-md.md');
  assert.deepEqual(staleFenceMessages(home, project), [
    `[stale-fence] ${homeAgents} fence is v1 but current is v${current} — run banana sync to re-fence`,
  ]);
});

test('stale fence (#26): each named remedy does what doctor says', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const codexFile = join(home, '.codex', 'AGENTS.md');
  writeFileSync(codexFile, STALE_FENCE_NO_IDENTITY);
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), STALE_FENCE + '\n');

  // (1) sync, with no exec (no npm, no network): re-fences CLAUDE.md, skips the codex file.
  /** @type {string[]} */
  const errLines = [];
  const syncIo = { out: () => {}, err: (/** @type {string} */ line = '') => errLines.push(line) };
  const synced = await runSync(parseSyncArgs([]), { home, io: syncIo });
  assert.equal(synced.code, 0);
  assert.equal(readFileSync(codexFile, 'utf8'), STALE_FENCE_NO_IDENTITY, 'the skipped file is byte-identical');
  assert.ok(
    errLines.some((line) => line.startsWith('skipped ') && line.includes(codexFile)),
    errLines.join('\n'),
  );

  // (2) exactly one finding remains, naming the codex file.
  const remaining = staleFenceMessages(home, project);
  assert.equal(remaining.length, 1, remaining.join('\n'));
  assert.ok(remaining[0].includes(codexFile), remaining[0]);

  // (3) run the init command doctor printed.
  const printed = /— run banana init (.+?) to re-fence/.exec(remaining[0])?.[1];
  assert.ok(printed, remaining[0]);
  const initResult = await runInit(parseInitArgs([...printed.split(' '), '--yes']), {
    home,
    env: ENV,
    io: {
      out: () => {},
      err: () => {},
      prompt: async () => {
        throw new Error('init --yes must not prompt');
      },
    },
    gitUserName: () => 'alice',
  });

  // (4) the codex file is re-fenced and nothing stale is left.
  assert.equal(initResult.code, 0);
  assert.deepEqual(staleFenceMessages(home, project), []);
});

test('stale fence (#26): owner without a tag still gets the init remedy', (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const homeAgents = join(home, '.codex', 'AGENTS.md');
  writeFileSync(homeAgents, fencedBlock('- **Identity:** owner: `alice`.', 1) + '\n');

  const messages = staleFenceMessages(home, project);
  assert.equal(messages.length, 1, messages.join('\n'));
  assert.ok(messages[0].includes('run banana init --harnesses codex to re-fence'), messages[0]);
});

test("stale fence (#26): every home harness gets its own init remedy, sync's skip line names the same command, and that command re-fences only that file", async (t) => {
  for (const adapter of FILE_ADAPTERS) {
    const project = cleanProject(t);
    const home = sandbox(t);
    installCanon(home);
    // Every file harness's dot-dir exists, so a plain `banana init` would detect and wire them all.
    for (const other of FILE_ADAPTERS) {
      mkdirSync(dirname(join(home, other.describe().target)), { recursive: true });
    }
    const target = join(home, adapter.describe().target);
    writeFileSync(target, STALE_FENCE_NO_IDENTITY);
    const current = wiringTemplateVersion(adapter.describe().template);

    // (a) doctor names this adapter's id.
    const messages = staleFenceMessages(home, project);
    assert.deepEqual(messages, [
      `[stale-fence] ${target} fence is v1 but current is v${current} — run banana init --harnesses ${adapter.id} to re-fence (banana sync skips a block with no owner/tag line)`,
    ]);

    // (b) sync, with no exec, skips the file and names the same command.
    /** @type {string[]} */
    const errLines = [];
    const syncIo = { out: () => {}, err: (/** @type {string} */ line = '') => errLines.push(line) };
    const synced = await runSync(parseSyncArgs([]), { home, io: syncIo });
    assert.equal(synced.code, 0);
    assert.equal(readFileSync(target, 'utf8'), STALE_FENCE_NO_IDENTITY, `${adapter.id}: the skipped file is byte-identical`);
    assert.ok(
      errLines.includes(
        `skipped ${target}: cannot recover owner/tag from the v1 block — run banana init --harnesses ${adapter.id} to re-fence`,
      ),
      errLines.join('\n'),
    );

    // (c) the command doctor printed re-fences this file and creates no other target.
    const printed = /— run banana init (.+?) to re-fence/.exec(messages[0])?.[1];
    assert.ok(printed, messages[0]);
    const initResult = await runInit(parseInitArgs([...printed.split(' '), '--yes']), {
      home,
      env: ENV,
      io: {
        out: () => {},
        err: () => {},
        prompt: async () => {
          throw new Error('init --yes must not prompt');
        },
      },
      gitUserName: () => 'alice',
    });
    assert.equal(initResult.code, 0, adapter.id);
    assert.deepEqual(staleFenceMessages(home, project), [], adapter.id);
    for (const other of FILE_ADAPTERS) {
      if (other.id === adapter.id) continue;
      assert.equal(
        existsSync(join(home, other.describe().target)),
        false,
        `${adapter.id}: init --harnesses ${adapter.id} must not create the ${other.id} target`,
      );
    }
  }
});

test('stale fence (#26): identity text outside the fence does not count — doctor agrees with sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const codexFile = join(home, '.codex', 'AGENTS.md');
  const text = 'Note: you are `alpha`; owner: `alice`.\n\n' + STALE_FENCE_NO_IDENTITY;
  writeFileSync(codexFile, text);

  const messages = staleFenceMessages(home, project);
  assert.equal(messages.length, 1, messages.join('\n'));
  assert.ok(messages[0].includes('run banana init --harnesses codex to re-fence'), messages[0]);

  /** @type {string[]} */
  const errLines = [];
  const syncIo = { out: () => {}, err: (/** @type {string} */ line = '') => errLines.push(line) };
  await runSync(parseSyncArgs([]), { home, io: syncIo });
  assert.equal(readFileSync(codexFile, 'utf8'), text, 'sync leaves the file byte-identical');
  assert.ok(errLines.some((line) => line.startsWith(`skipped ${codexFile}`)), errLines.join('\n'));
});

test('stale fence (#26): a tag without an owner still gets the init remedy', (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'AGENTS.md'), fencedBlock('- **Identity:** you are `alpha`.', 1) + '\n');

  const messages = staleFenceMessages(home, project);
  assert.equal(messages.length, 1, messages.join('\n'));
  assert.ok(messages[0].includes('run banana init --harnesses codex to re-fence'), messages[0]);
});

for (const [label, body] of [
  ['owner only', '- **Identity:** owner: `alice`.'],
  ['tag only', '- **Identity:** you are `alpha`.'],
]) {
  test(`stale fence (#26): sync really skips a half-identity block (${label}), as doctor's init remedy says`, async (t) => {
    const home = sandbox(t);
    installCanon(home);
    mkdirSync(join(home, '.codex'), { recursive: true });
    const file = join(home, '.codex', 'AGENTS.md');
    const text = fencedBlock(body, 1) + '\n';
    writeFileSync(file, text);

    /** @type {string[]} */
    const errLines = [];
    const syncIo = { out: () => {}, err: (/** @type {string} */ line = '') => errLines.push(line) };
    const synced = await runSync(parseSyncArgs([]), { home, io: syncIo });
    assert.equal(synced.code, 0);
    assert.equal(readFileSync(file, 'utf8'), text, 'the skipped file is byte-identical');
    assert.ok(
      errLines.includes(
        `skipped ${file}: cannot recover owner/tag from the v1 block — run banana init --harnesses codex to re-fence`,
      ),
      errLines.join('\n'),
    );
  });
}

test('stale fence (#26): identity text after the fence does not count either — doctor agrees with sync', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const codexFile = join(home, '.codex', 'AGENTS.md');
  const text = STALE_FENCE_NO_IDENTITY + '\nNote: you are `alpha`; owner: `alice`.\n';
  writeFileSync(codexFile, text);

  const messages = staleFenceMessages(home, project);
  assert.equal(messages.length, 1, messages.join('\n'));
  assert.ok(messages[0].includes('run banana init --harnesses codex to re-fence'), messages[0]);

  /** @type {string[]} */
  const errLines = [];
  const syncIo = { out: () => {}, err: (/** @type {string} */ line = '') => errLines.push(line) };
  await runSync(parseSyncArgs([]), { home, io: syncIo });
  assert.equal(readFileSync(codexFile, 'utf8'), text, 'sync leaves the file byte-identical');
  assert.ok(errLines.some((line) => line.startsWith(`skipped ${codexFile}`)), errLines.join('\n'));
});

test('stale fence: a directory where a home harness file belongs never aborts doctor', async (t) => {
  const project = cleanProject(t);
  const home = sandbox(t);
  installCanon(home);
  mkdirSync(join(home, '.codex', 'AGENTS.md'), { recursive: true });

  const captured = capturedIo();
  await runDoctor({ verify: false }, { cwd: project, home, io: captured.io, now: NOW, env: ENV });
  assert.ok(!captured.text().includes('banana doctor: EISDIR'), captured.text());
  assert.deepEqual(staleFenceMessages(home, project), []);
});
