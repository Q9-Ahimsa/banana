#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

const COMMANDS = ['init', 'project', 'brief', 'doctor', 'sync', 'log', 'state'];
const [cmd] = process.argv.slice(2);

// --- `log` usage text ---------------------------------------------------
// Verb-specific usage strings for `banana log`. Kept in bin.mjs (not
// lib/log.mjs) because they are presentation, not grammar — lib/log.mjs owns
// zero help text, only orchestration (contract: docs/DESIGN.md `log` write
// contract, ticket #7 final implementation contract §9).

const LOG_USAGE = `Usage: banana log <stub|append|close|supersede> [options]

Stamp session-log entries so the envelope grammar (heading format,
STATUS/NEXT composition, concurrency-guard continuation) is never
hand-typed.

  stub       open a new entry for a feature
  append     add checkpoint body lines to your open entry
  close      write a terminal STATUS + owned NEXT to your open entry
  supersede  correct or retire a specific {feature}.{n} entry

Run \`banana log <verb> --help\` for verb-specific usage and examples.

Exit codes: 0 ok, 1 usage, 2 state`;

const LOG_STUB_USAGE = `Usage: banana log stub <feature> --tag <agent> --phase <phase> --title <text> --approach <text>
                [--body <line>]... [--blocked <text>] [--status <s> [--next-owner <o>] --next <text>]
                [--dry-run] [--quiet] [--no-continue]

Open a new entry for <feature>. --status defaults to in-progress; a terminal
--status (complete|blocked|abandoned) requires an owned --next.

PowerShell:
  banana log stub myapp --tag testagent --phase build --title "Login form" --approach "ship the smallest vertical slice"

POSIX:
  banana log stub myapp --tag testagent --phase build --title "Login form" --approach 'ship the smallest vertical slice'

Exit codes: 0 ok, 1 usage, 2 state`;

const LOG_APPEND_USAGE = `Usage: banana log append <feature> --tag <agent> (--body <line>)... | --body -
                [--dry-run] [--quiet] [--no-continue]

Add checkpoint body lines to your own open entry for <feature>. \`--body -\`
reads stdin to EOF and must be the only --body flag.

PowerShell:
  banana log append myapp --tag testagent --body "FILES: lib/login.mjs" --body "VALIDATED: 12 tests green"

POSIX:
  banana log append myapp --tag testagent --body 'FILES: lib/login.mjs' --body 'VALIDATED: 12 tests green'

Exit codes: 0 ok, 1 usage, 2 state`;

const LOG_CLOSE_USAGE = `Usage: banana log close <feature> --tag <agent> --status <complete|blocked|abandoned>
                [--blocked <text>] [--next-owner <o>] --next <text>
                [--dry-run] [--quiet] [--no-continue]

Write a terminal STATUS + owned NEXT to your own open entry for <feature>.
Closed entries are immutable; corrections go through \`banana log supersede\`.

PowerShell:
  banana log close myapp --tag testagent --status complete --next-owner ahimsa --next "review the shipped form"

POSIX:
  banana log close myapp --tag testagent --status complete --next-owner ahimsa --next 'review the shipped form'

Exit codes: 0 ok, 1 usage, 2 state`;

const LOG_SUPERSEDE_USAGE = `Usage: banana log supersede <feature>.<n> --tag <agent> --reason <text> --status <s>
                [--next-owner <o>] [--next <text>] [--title <text>] [--phase <p>]
                [--feature <slug>] [--body <line>]... [--dry-run] [--quiet]

Correct or retire a specific {feature}.{n} entry; the new entry SUPERSEDES it.
Not tag-restricted to the target's author — closing another agent's ghost is
canon-sanctioned.

Ghost-close example:
  banana log supersede cli.4 --tag testagent --reason "ghost, >48h" --status abandoned --next-owner testagent --next "re-scope and reopen"

PowerShell:
  banana log supersede cli.4 --tag testagent --reason "ghost, >48h" --status abandoned --next-owner testagent --next "re-scope and reopen"

POSIX:
  banana log supersede cli.4 --tag testagent --reason 'ghost, >48h' --status abandoned --next-owner testagent --next 're-scope and reopen'

Exit codes: 0 ok, 1 usage, 2 state`;

const LOG_VERB_USAGE = {
  stub: LOG_STUB_USAGE,
  append: LOG_APPEND_USAGE,
  close: LOG_CLOSE_USAGE,
  supersede: LOG_SUPERSEDE_USAGE,
};

// --- `state` usage text --------------------------------------------------
// Same rationale as the `log` usage strings above: presentation lives here,
// lib/state.mjs owns zero help text (contract: docs/DESIGN.md `state lint`
// — verdict contract).

const STATE_USAGE = `Usage: banana state <lint|archive> [options]

  lint       lint a STATE.md page against the canon's mechanical invariants
  archive    move a bullet off the global page into the append-only
             STATE-archive.md (never grades content, never deletes)

Run \`banana state lint --help\` or \`banana state archive --help\` for
verb-specific usage and exit codes.

Exit codes: 0 ok, 2 usage error OR a refused/failed state — \`archive\` also
exits 2 for a bullet that spans more than one physical line, a reason the
matched bullet's own section doesn't support, a line not yet past its
expiry/inactivity limit, a future-dated stamp on the matched line itself,
invalid UTF-8, or a page missing/changed mid-write — not just a bad flag;
\`lint\` also exits 1 on any FAIL — see each verb's own --help for its exact
tiers.`;

const STATE_LINT_USAGE = `Usage: banana state lint [--global]

Lint never grades content — every verdict is reproducible from file bytes
alone, so no check ever reads the clock.

  (no flag)  lint the project page at <cwd>/STATE.md
  --global   lint the machine-grain page at <home>/.agents/STATE.md

Verdict tiers:
  FAIL   a mechanical invariant is broken
  WARN   ambiguous residue a model should look at
  PASS   neither

Exit codes: 0 PASS or WARN-only, 1 any FAIL, 2 usage error or the target STATE.md is missing/unreadable`;

const STATE_ARCHIVE_USAGE = `Usage: banana state archive --global --match <text> --reason <reason> --tag <agent> [--dry-run]

Move a top-level bullet off <home>/.agents/STATE.md into the append-only
<home>/.agents/STATE-archive.md — removal from the global page is a MOVE,
never a silent delete. \`--match\` is a case-sensitive substring of a
non-placeholder bullet's OWN physical line; it must identify exactly one
bullet across Active threads, Backlog (owned), Watch, and Recently closed —
unless every match is byte-identical, in which case the first occurrence is
archived and the command says so. A matched bullet that wraps onto a
continuation line refuses (exit 2) instead of guessing how much trailing
text belongs to it — join it into one line first. \`--reason trimmed\`
copies only — the page itself is left unmodified, as a reminder to shorten
the line in place; every other reason removes the bullet from the page.

\`--reason expired\` only applies to a Recently-closed line; \`inactive\` and
\`closed\` only apply to an Active-threads line — \`trimmed\`/\`removed\` work
on a bullet in any of the four sections. \`--reason closed\` is a two-step
move: once the Active-threads line is archived, add a one-line
Recently-closed entry for it by hand — the command prints a reminder.

\`--reason expired\`/\`inactive\` also read the clock: they refuse (exit 2)
unless the MATCHED line's own stamp is already past its limit (\`(closed
YYYY-MM-DD)\`, 7 days; \`(as of YYYY-MM-DD)\`, 30 days), naming that stamp if
it is instead dated after today, or suggesting \`--reason removed\` when the
line carries no stamp at all.
A future-dated stamp on a DIFFERENT Active-threads or Recently-closed line
— the same two non-placeholder sections and keywords the reference date
itself reads; Watch and Backlog never carry this stamp convention — never
blocks the move: the command proceeds and prints a one-line note naming
that other line instead.

A pasted secret (a credential, token, or key) is deleted outright, never
archived — not even a copy.

  --global        required — project pages keep their history in LOGBOOK.md instead
  --match <text>  case-sensitive substring identifying exactly one bullet
  --reason <r>    one of: expired | inactive | trimmed | closed | removed
  --tag <agent>   the agent recording the move
  --dry-run       print the record and the action, write nothing

Pick a short, distinctive \`--match\` substring with no quotes, \`$\`, \`%\` or
backtick in it — a plain word or hyphenated slug clears every shell's
quoting rules at once, no per-shell quoting style needed:

PowerShell:
  banana state archive --global --match stale-thread-name --reason inactive --tag testagent

cmd.exe:
  banana state archive --global --match stale-thread-name --reason inactive --tag testagent

POSIX:
  banana state archive --global --match stale-thread-name --reason inactive --tag testagent

Exit codes: 0 ok, 2 usage or a refused/failed state — a wrapped bullet, a
reason the matched line's own section doesn't support, a line not yet past
its expiry/inactivity limit, a future-dated stamp on the matched line
itself, invalid UTF-8, or a page missing or changed mid-write`;

/** Owner inference rung shared by init and project: git config user.name. */
function gitUserName() {
  try {
    const name = execSync('git config --get user.name', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Short-circuit a subcommand to its usage string and exit 0 when --help/-h
 * is present in its argv slice. Every subcommand's own arg parser otherwise
 * throws 'unknown option' for --help/-h, since npm/npx only reserve
 * --help/-h/--version/-v at the top level, not per-subcommand.
 * @param {string[]} argv the subcommand's argv slice (after the command word)
 * @param {string} usage
 */
function maybeSubHelp(argv, usage) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
}

/** Plain stdout/stderr io for the non-interactive commands (brief, doctor, sync, log). */
function makeIo() {
  return {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
    // Raw stdout sink for lib/log.mjs's `--dry-run` byte-exactness seam
    // (io.write ?? io.out): console.log adds its own trailing newline on
    // top of the already-\n-terminated composed entry text, so dry-run
    // stdout would carry one byte more than a real run ever appends to
    // disk. process.stdout.write() writes exactly the given string.
    write: (/** @type {string} */ text) => process.stdout.write(text),
  };
}

/**
 * Interactive io for commands that may prompt (init, project): out/err plus a
 * lazily-created readline prompt. Returns { io, close }; call close() once the
 * command returns to release the readline handle (a no-op if it never prompted).
 */
function makeInteractiveIo() {
  /** @type {import('node:readline/promises').Interface | null} */
  let rl = null;
  const io = {
    out: (/** @type {string} */ line = '') => console.log(line),
    err: (/** @type {string} */ line = '') => console.error(line),
    prompt: async (/** @type {string} */ question) => {
      if (rl === null) {
        const { createInterface } = await import('node:readline/promises');
        rl = createInterface({ input: process.stdin, output: process.stdout });
      }
      return rl.question(question);
    },
  };
  return { io, close: () => rl?.close() };
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(pkg.version);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h' || cmd === undefined) {
  console.log(`banana ${pkg.version} — harness-neutral continuity kit
Usage: banana <command> [options]

Commands:
  init      detect installed agent harnesses, wire the continuity protocol into each
  project   initialize a workspace (git repo or topic dir) with LOGBOOK.md, STATE.md, and .agents/session.log
  brief     compile a per-intent context brief for a session; no feature arg lists active slugs
  doctor    check wiring versions and run liveness audits
  sync      refresh the kit-owned canon and re-apply stale wiring fences
  log       stamp session-log entries: stub / append / close / supersede (envelope computed, never hand-typed)
  state     lint a STATE.md page against the canon's mechanical invariants, or move a bullet into the append-only archive (state lint · archive)

Tip: under npx, run the bare 'version' subcommand (not --version/-v) to check
the version — npm reserves those flags globally and they never reach this
script.`);
  process.exit(cmd === undefined ? 1 : 0);
}

if (!COMMANDS.includes(cmd)) {
  console.error(`banana: unknown command '${cmd}' (expected ${COMMANDS.join('|')})`);
  process.exit(1);
}

if (cmd === 'init') {
  const argv = process.argv.slice(3);
  maybeSubHelp(
    argv,
    'Usage: banana init [--owner <name>] [--tag <agent>] [--harnesses <ids>] [--yes] [--deliver]',
  );
  const { parseInitArgs, runInit } = await import('../lib/init.mjs');
  /** @type {import('../lib/init.mjs').InitFlags} */
  let flags;
  try {
    flags = parseInitArgs(argv);
  } catch (error) {
    console.error(`banana init: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const { io, close } = makeInteractiveIo();
  const result = await runInit(flags, {
    home: homedir(),
    io,
    isTTY: process.stdin.isTTY === true,
    gitUserName,
  });
  close();
  process.exit(result.code);
}

if (cmd === 'project') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana project [--owner <name>] [--tag <agent>] [--yes]');
  const { parseProjectArgs, runProject } = await import('../lib/project.mjs');
  /** @type {import('../lib/project.mjs').ProjectFlags} */
  let flags;
  try {
    flags = parseProjectArgs(argv);
  } catch (error) {
    console.error(`banana project: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const { io, close } = makeInteractiveIo();
  const result = await runProject(flags, {
    cwd: process.cwd(),
    io,
    isTTY: process.stdin.isTTY === true,
    gitUserName,
  });
  close();
  process.exit(result.code);
}

if (cmd === 'brief') {
  const argv = process.argv.slice(3);
  maybeSubHelp(
    argv,
    'Usage: banana brief [feature] --tag <agent>\n  no feature: list active slugs (discovery mode)',
  );
  const { parseBriefArgs, runBrief } = await import('../lib/brief.mjs');
  /** @type {import('../lib/brief.mjs').BriefArgs} */
  let flags;
  try {
    flags = parseBriefArgs(argv);
  } catch (error) {
    console.error(`banana brief: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = makeIo();
  const result = await runBrief(flags, { cwd: process.cwd(), io, home: homedir() });
  process.exit(result.code);
}

if (cmd === 'doctor') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana doctor [--verify]');
  const { parseDoctorArgs, runDoctor } = await import('../lib/doctor.mjs');
  /** @type {import('../lib/doctor.mjs').DoctorFlags} */
  let flags;
  try {
    flags = parseDoctorArgs(argv);
  } catch (error) {
    console.error(`banana doctor: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = makeIo();
  // BANANA_ORIGIN_URL: test seam only, read here and nowhere else in the
  // command surface — points doctor's remote-version check at a local
  // node:http server instead of raw.githubusercontent.com (docs/DESIGN.md
  // `doctor` audit contract). Undefined falls through to lib/doctor.mjs's
  // own DEFAULT_ORIGIN_URL, so real runs are unaffected.
  const result = await runDoctor(flags, {
    cwd: process.cwd(),
    home: homedir(),
    io,
    fetch: globalThis.fetch,
    originUrl: process.env.BANANA_ORIGIN_URL,
  });
  // process.exitCode, not process.exit(): on Windows (Node 24.x observed),
  // calling process.exit() at any point after a real fetch trips libuv —
  // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
  // src\win\async.c, line 76` — regardless of AbortController cleanup or
  // connection: close; idle keep-alive sockets don't hold the loop open, so
  // letting the module finish and the loop drain naturally is the fix
  // (docs/DESIGN.md `doctor` audit contract). This is the only dispatch arm
  // that makes a real network call, so it is the only one that needs this;
  // see the fallthrough guard below the `state` arm, which this relies on.
  process.exitCode = result.code;
}

if (cmd === 'sync') {
  const argv = process.argv.slice(3);
  maybeSubHelp(argv, 'Usage: banana sync');
  const { parseSyncArgs, runSync } = await import('../lib/sync.mjs');
  const { makeExec } = await import('../lib/proc.mjs');
  /** @type {import('../lib/sync.mjs').SyncFlags} */
  let flags;
  try {
    flags = parseSyncArgs(argv);
  } catch (error) {
    console.error(`banana sync: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const io = makeIo();
  const result = await runSync(flags, { home: homedir(), io, exec: makeExec() });
  process.exit(result.code);
}

if (cmd === 'log') {
  const argv = process.argv.slice(3);
  // POSITIONAL help detection only — argv[0] (the verb slot) or argv[1] (the
  // verb's first slot). Deliberately NOT maybeSubHelp/argv.includes: a value
  // like `--title "--help"` must never trigger silent help/no-write data
  // loss (contract §2, flag parsing).
  if (argv.length === 0) {
    console.error(LOG_USAGE);
    process.exit(1);
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(LOG_USAGE);
    process.exit(0);
  }
  if (Object.hasOwn(LOG_VERB_USAGE, argv[0]) && (argv[1] === '--help' || argv[1] === '-h')) {
    console.log(LOG_VERB_USAGE[argv[0]]);
    process.exit(0);
  }
  const { parseLogArgs, runLog } = await import('../lib/log.mjs');
  /** @type {import('../lib/log.mjs').LogFlags} */
  let flags;
  try {
    flags = parseLogArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // parseLogArgs' own parse-shape errors are already self-identifying
    // ("banana log append: missing <feature>", "banana log supersede:
    // missing ... target", "banana log append requires --body ..." — see
    // buildFlags in lib/log.mjs) — prepending the generic "banana log: "
    // prefix on top of those doubles the phrase into a confusing
    // "banana log: banana log append: missing <feature>". Only add the
    // prefix when the message doesn't already carry it.
    console.error(/^banana log\b/.test(message) ? message : `banana log: ${message}`);
    process.exit(1);
  }
  const io = makeIo();
  /** Read process.stdin to EOF as utf8 — only invoked for `--body -`. */
  const readStdin = () =>
    new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  const result = await runLog(flags, { cwd: process.cwd(), io, now: Date.now(), readStdin, home: homedir() });
  process.exit(result.code);
}

if (cmd === 'state') {
  const argv = process.argv.slice(3);
  // POSITIONAL help detection only — mirrors the `log` arm above (argv[0]/
  // argv[1] of the slice after 'state'), not maybeSubHelp, for the same
  // reason (a flag-shaped value must never silently short-circuit). Missing
  // verb and unknown verb/flag all exit 2 here, not 1 — `state lint`'s own
  // usage-error exit code (contract: docs/DESIGN.md `state lint` — verdict
  // contract), distinct from every other subcommand's exit 1.
  if (argv.length === 0) {
    console.error(STATE_USAGE);
    process.exit(2);
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(STATE_USAGE);
    process.exit(0);
  }
  if (argv[0] === 'lint' && (argv[1] === '--help' || argv[1] === '-h')) {
    console.log(STATE_LINT_USAGE);
    process.exit(0);
  }
  if (argv[0] === 'archive' && (argv[1] === '--help' || argv[1] === '-h')) {
    console.log(STATE_ARCHIVE_USAGE);
    process.exit(0);
  }
  const { parseStateArgs, runStateLint } = await import('../lib/state.mjs');
  /** @type {import('../lib/state.mjs').StateFlags} */
  let flags;
  try {
    flags = parseStateArgs(argv);
  } catch (error) {
    console.error(`banana state: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  const io = makeIo();
  if (flags.verb === 'archive') {
    const { runStateArchive } = await import('../lib/state-archive.mjs');
    const result = await runStateArchive(flags, { home: homedir(), now: Date.now(), io });
    process.exit(result.code);
  }
  const result = await runStateLint(flags, { cwd: process.cwd(), io, home: homedir() });
  process.exit(result.code);
}

// Unreachable: the COMMANDS guard above already rejects anything not in the
// seven-command vocabulary, and every member of COMMANDS has a dispatch arm
// above that exits (or, for `doctor` alone, sets process.exitCode and falls
// through here by design — see its arm above). This is an internal-invariant
// guard — if it ever fires for any OTHER command, a COMMANDS entry was added
// without a matching dispatch arm.
if (cmd !== 'doctor') {
  console.error(`banana: internal error — no dispatch arm for '${cmd}'`);
  process.exit(1);
}
