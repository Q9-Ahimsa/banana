// log command: the single writer of `.agents/session.log`. Stamps stub /
// append / close / supersede entries so no agent hand-types the envelope
// grammar (heading format, STATUS/NEXT composition, concurrency-guard
// continuation) again. The heading grammar and PHASE/STATUS vocab live in
// lib/sessionlog.mjs; this module composes the body prefix lines
// (STATUS:/NEXT:/APPROACH:/BLOCKED:/SUPERSEDES:) it writes, and sessionlog.mjs
// is what parses them back on the read side — this module's own job is
// orchestration: argv parsing, field validation, target resolution, and the
// one-appendFileSync write mechanics (contract: docs/DESIGN.md `log` write
// contract, ticket #7 final implementation contract).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
} from './sessionlog.mjs';

/** @typedef {import('./sessionlog.mjs').LogEntry} LogEntry */
/** @typedef {import('./sessionlog.mjs').SessionArchive} SessionArchive */

/** A validation/usage problem — always exit 1. */
class UsageError extends Error {}
/** A disk-state precondition failure (missing log, unresolvable target, ...) — always exit 2. */
class StateError extends Error {}

const FEATURE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const MAX_BODY_LINES = 100;
const MAX_BODY_BYTES = 16 * 1024;
const BODY_WARN_LINES = 10;

const PROMOTION_NOTICE =
  'promotion to LOGBOOK.md is mandatory for this session — canon SESSION-LOG.md §6';

/**
 * @typedef {object} LogFlags
 * @property {'stub'|'append'|'close'|'supersede'} verb
 * @property {string|null} feature stub/append/close positional
 * @property {string|null} target supersede's `{feature}.{n}` positional
 * @property {string} tag
 * @property {string|null} phase
 * @property {string|null} title
 * @property {string|null} approach
 * @property {string|null} blocked
 * @property {string|null} status
 * @property {string|null} nextOwner
 * @property {string|null} next
 * @property {string|null} reason
 * @property {string|null} featureOverride
 * @property {string|null} targetAgent
 * @property {string[]} body
 * @property {boolean} bodyStdin
 * @property {boolean} dryRun
 * @property {boolean} quiet
 * @property {boolean} noContinue
 */

/**
 * @typedef {object} VerbSpec
 * @property {string[]} valued
 * @property {string[]} repeatable
 * @property {string[]} boolean
 */

/** @type {Record<string, VerbSpec>} */
const VERB_SPECS = {
  stub: {
    valued: ['tag', 'phase', 'title', 'approach', 'blocked', 'status', 'next-owner', 'next'],
    repeatable: ['body'],
    boolean: ['dry-run', 'quiet', 'no-continue'],
  },
  append: {
    valued: ['tag'],
    repeatable: ['body'],
    boolean: ['dry-run', 'quiet', 'no-continue'],
  },
  close: {
    valued: ['tag', 'status', 'blocked', 'next-owner', 'next'],
    repeatable: [],
    boolean: ['dry-run', 'quiet', 'no-continue'],
  },
  supersede: {
    valued: ['tag', 'reason', 'status', 'next-owner', 'next', 'title', 'phase', 'feature', 'target-agent'],
    repeatable: ['body'],
    boolean: ['dry-run', 'quiet'],
  },
};

// The verb vocabulary, derived from VERB_SPECS so there is exactly one place
// that enumerates stub/append/close/supersede — every "expected <verbs>"
// error message interpolates this instead of re-typing the list.
const VERBS = Object.keys(VERB_SPECS);

/**
 * @typedef {object} LogIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} err
 * @property {(text: string) => void} [write] optional raw byte sink for
 *   dry-run output — preferred over `out` when present (B5: `out` at the bin
 *   boundary is console.log, which adds a process-level newline that would
 *   break byte-exactness).
 */

/**
 * @typedef {object} LogDeps
 * @property {string} cwd project root
 * @property {LogIo} io
 * @property {number} now epoch ms
 * @property {() => Promise<string>|string} readStdin only invoked for `--body -`
 */

// --- argv parsing -----------------------------------------------------

/**
 * Tokenize the argv slice after the verb: `--flag value`, `--flag=value`,
 * `--` positional terminator, repeatable collection, unknown-option and
 * missing-value detection (including the "value is itself a known flag"
 * case). Pure syntax — no semantic validation.
 * @param {string} verb
 * @param {string[]} rest
 * @param {VerbSpec} spec
 */
function tokenize(verb, rest, spec) {
  const knownValued = new Set(spec.valued.map((f) => `--${f}`));
  const knownRepeatable = new Set(spec.repeatable.map((f) => `--${f}`));
  const knownBoolean = new Set(spec.boolean.map((f) => `--${f}`));
  const allKnown = new Set([...knownValued, ...knownRepeatable, ...knownBoolean]);

  /** @type {Record<string, string>} */
  const valued = {};
  /** @type {Record<string, string[]>} */
  const repeatable = {};
  for (const f of knownRepeatable) repeatable[f] = [];
  /** @type {Record<string, boolean>} */
  const boolean = {};
  for (const f of knownBoolean) boolean[f] = false;
  /** @type {string[]} */
  const positionals = [];

  let i = 0;
  let sawTerminator = false;
  while (i < rest.length) {
    const arg = rest[i];
    if (!sawTerminator && arg === '--') {
      sawTerminator = true;
      i += 1;
      continue;
    }
    if (!sawTerminator && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? null : arg.slice(eq + 1);
      if (knownBoolean.has(name)) {
        if (inline !== null) throw new Error(`${name} does not take a value`);
        boolean[name] = true;
        i += 1;
        continue;
      }
      if (knownValued.has(name) || knownRepeatable.has(name)) {
        let value = inline;
        if (value === null) {
          const next = rest[i + 1];
          if (next === undefined) throw new Error(`${name} requires a value`);
          if (allKnown.has(next)) throw new Error(`${name} requires a value (got '${next}')`);
          value = next;
          i += 2;
        } else {
          i += 1;
        }
        if (knownRepeatable.has(name)) repeatable[name].push(value);
        else valued[name] = value;
        continue;
      }
      throw new Error(
        `unknown option '${arg}' for banana log ${verb} (valid: ${[...allKnown].sort().join(', ')})`
      );
    }
    positionals.push(arg);
    i += 1;
  }
  return { valued, repeatable, boolean, positionals };
}

/**
 * Verb-shape checks (required flags present) plus the public LogFlags shape.
 * @param {string} verb
 * @param {{valued: Record<string,string>, repeatable: Record<string,string[]>, boolean: Record<string,boolean>, positionals: string[]}} p
 * @returns {LogFlags}
 */
function buildFlags(verb, p) {
  if (p.positionals.length > 1) throw new Error(`unexpected argument '${p.positionals[1]}'`);

  const feature = verb === 'supersede' ? null : (p.positionals[0] ?? null);
  const target = verb === 'supersede' ? (p.positionals[0] ?? null) : null;
  if (verb !== 'supersede' && feature === null) throw new Error(`banana log ${verb}: missing <feature>`);
  if (verb === 'supersede' && target === null) {
    throw new Error('banana log supersede: missing <feature>.<n> target');
  }

  const tag = p.valued['--tag'] ?? null;
  if (tag === null) throw new Error(`--tag is required for banana log ${verb}`);

  if (verb === 'stub') {
    for (const f of ['--phase', '--title', '--approach']) {
      if (p.valued[f] === undefined) throw new Error(`${f} is required for banana log stub`);
    }
  }
  if (verb === 'close') {
    if (p.valued['--status'] === undefined) throw new Error('--status is required for banana log close');
    if (p.valued['--next'] === undefined) throw new Error('--next is required for banana log close');
  }
  if (verb === 'supersede') {
    if (p.valued['--reason'] === undefined) throw new Error('--reason is required for banana log supersede');
    if (p.valued['--status'] === undefined) throw new Error('--status is required for banana log supersede');
  }

  const body = p.repeatable['--body'] ?? [];
  const bodyStdin = body.length === 1 && body[0] === '-';
  if (body.includes('-') && !bodyStdin) {
    throw new Error('--body - reads stdin and must be the only --body flag');
  }
  if (verb === 'append' && body.length === 0) {
    throw new Error('banana log append requires --body <line> (repeatable) or --body -');
  }

  return {
    verb: /** @type {LogFlags['verb']} */ (verb),
    feature,
    target,
    tag,
    phase: p.valued['--phase'] ?? null,
    title: p.valued['--title'] ?? null,
    approach: p.valued['--approach'] ?? null,
    blocked: p.valued['--blocked'] ?? null,
    status: p.valued['--status'] ?? null,
    nextOwner: p.valued['--next-owner'] ?? null,
    next: p.valued['--next'] ?? null,
    reason: p.valued['--reason'] ?? null,
    featureOverride: p.valued['--feature'] ?? null,
    targetAgent: p.valued['--target-agent'] ?? null,
    body,
    bodyStdin,
    dryRun: p.boolean['--dry-run'] ?? false,
    quiet: p.boolean['--quiet'] ?? false,
    noContinue: p.boolean['--no-continue'] ?? false,
  };
}

/**
 * Parse the argv slice after `log` (argv[0] is the verb). Throws a plain
 * Error on any usage problem — verb vocabulary, unknown flags, missing
 * required flags, extra positionals.
 * @param {string[]} argv
 * @returns {LogFlags}
 */
export function parseLogArgs(argv) {
  const verb = argv[0];
  if (verb === undefined) {
    throw new Error(
      `banana log: missing verb (expected ${VERBS.join('|')})\n` +
        `Usage: banana log <${VERBS.join('|')}> ...`
    );
  }
  if (!VERBS.includes(verb)) {
    throw new Error(`unknown log verb '${verb}' (expected ${VERBS.join('|')})`);
  }
  const spec = VERB_SPECS[verb];
  const rest = argv.slice(1);
  const tokens = tokenize(verb, rest, spec);
  return buildFlags(verb, tokens);
}

// --- shared field validation -------------------------------------------

/**
 * @param {string|null} tag
 */
function validateTag(tag) {
  if (tag === null || tag === '') throw new UsageError('--tag is required');
  if (/\s/.test(tag)) {
    throw new UsageError(
      "the agent field is a single token — the envelope's {agent} slot is whitespace-delimited"
    );
  }
}

/**
 * @param {string} raw
 * @returns {string}
 */
function validateFeatureSlug(raw) {
  if (FEATURE_SLUG_RE.test(raw)) return raw;
  const dotMatch = raw.match(/^.+\.\d+$/);
  if (dotMatch) {
    throw new UsageError(`feature slugs contain no dots — did you mean \`banana log supersede ${raw}\`?`);
  }
  throw new UsageError(`feature slug must match ^[A-Za-z0-9][A-Za-z0-9_-]*$ (got '${raw}')`);
}

/**
 * @param {LogEntry[]} active
 * @param {SessionArchive[]} archives
 * @returns {Set<string>}
 */
function knownFeatureSlugs(active, archives) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const e of active) set.add(e.feature);
  for (const { entries } of archives) for (const e of entries) set.add(e.feature);
  return set;
}

/**
 * @param {string} feature
 * @param {Set<string>} slugs
 * @returns {string|null}
 */
function caseInsensitiveMatch(feature, slugs) {
  const lower = feature.toLowerCase();
  for (const s of slugs) {
    if (s !== feature && s.toLowerCase() === lower) return s;
  }
  return null;
}

/**
 * @param {string} feature
 * @param {Set<string>} slugs
 * @returns {string}
 */
function nearMissSuffix(feature, slugs) {
  const ci = caseInsensitiveMatch(feature, slugs);
  return ci ? ` (did you mean '${ci}'?)` : '';
}

/**
 * @param {string} raw
 * @param {string} fieldName
 */
function validateSingleLine(raw, fieldName) {
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) {
      throw new UsageError(`--${fieldName} must be a single line (no embedded newline/CR)`);
    }
  }
  return raw;
}

/**
 * Title/approach share character rules: trimmed, no empty, no newline/CR,
 * no tab/C0 controls, no U+FFFD; warn >120 chars, reject >300.
 * @param {string|null} raw
 * @param {string} fieldName
 * @param {(line: string) => void} advise
 * @returns {string}
 */
function validateTitleText(raw, fieldName, advise) {
  if (raw === null) throw new UsageError(`--${fieldName} is required`);
  const trimmed = raw.trim();
  if (trimmed === '') throw new UsageError(`--${fieldName} must not be empty`);
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) {
      throw new UsageError(`--${fieldName} must be a single line (no embedded newline/CR)`);
    }
    if (code === 0xfffd) throw new UsageError(`--${fieldName} contains invalid UTF-8 (U+FFFD)`);
    if (code <= 0x1f) throw new UsageError(`--${fieldName} must not contain tab or control characters`);
  }
  if (trimmed.length > 300) {
    throw new UsageError(`--${fieldName} exceeds 300 characters (${trimmed.length})`);
  }
  if (trimmed.length > 120) {
    advise(`WARN: --${fieldName} is ${trimmed.length} chars (over 120) - consider trimming`);
  }
  return trimmed;
}

/**
 * @param {string|null} raw
 * @returns {string}
 */
function validateReasonText(raw) {
  if (raw === null || raw.trim() === '') throw new UsageError('--reason is required');
  validateSingleLine(raw, 'reason');
  const trimmed = raw.trim();
  if (/^\(.*\)$/.test(trimmed)) {
    throw new UsageError('the tool adds the parentheses — pass the reason text alone');
  }
  return trimmed;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizePhase(raw) {
  const lower = raw.toLowerCase();
  if (!PHASES.includes(lower)) {
    throw new UsageError(`--phase must be one of: ${PHASES.join(', ')} (got '${raw}')`);
  }
  return lower;
}

/**
 * @param {string} value
 * @returns {string}
 */
function firstToken(value) {
  const m = value.match(/^(\S+)/);
  return m ? m[1] : '';
}

/**
 * @param {string} token
 * @returns {string}
 */
function statusVocabError(token) {
  return `STATUS must start with one of: ${STATUSES.join('|')} (got '${token}')`;
}

/**
 * @param {string} owner
 */
function validateOwnerToken(owner) {
  if (owner === '') throw new UsageError('NEXT owner must not be empty');
  if (/\s/.test(owner)) throw new UsageError(`NEXT owner '${owner}' must be a single token (no whitespace)`);
  if (owner.includes('—')) throw new UsageError(`NEXT owner '${owner}' must not contain an em-dash`);
}

/**
 * Action text of a pre-composed `{owner} — {action}` value (no leading
 * `NEXT:`), paired with nextOwner()'s owner extraction on the same string.
 * Local to this module: sessionlog.mjs's nextOwner only needs the owner for
 * read-side ghost/brief scans, but write-time validation also needs to know
 * whether anything follows the separator.
 * @param {string} val
 * @returns {string}
 */
function preComposedAction(val) {
  const m = val.match(/^.+?\s+—(.*)$/);
  return m ? m[1] : '';
}

/**
 * Compose the `NEXT: {owner} — {action}` line from either the canonical
 * `--next-owner` + `--next` pair, or a pre-composed `--next "<owner> — <action>"`
 * value (validated by round-tripping through nextOwner()). Returns null when
 * neither flag was given (legal — callers gate terminal-requires-NEXT
 * separately). Both branches reject an empty/whitespace-only action and trim
 * trailing whitespace off it — a NEXT line never lands on disk with nothing
 * (or only blanks) after the em-dash.
 * @param {LogFlags} flags
 * @returns {string|null}
 */
function composeNext(flags) {
  const { nextOwner: ownerFlag, next: nextFlag } = flags;
  if (nextFlag === null && ownerFlag === null) return null;
  if (nextFlag !== null) validateSingleLine(nextFlag, 'next');
  if (ownerFlag !== null) {
    if (nextFlag === null) {
      throw new UsageError(
        '--next-owner requires --next <action> (the tool composes NEXT: {owner} - {action})'
      );
    }
    validateOwnerToken(ownerFlag);
    if (nextFlag.trim() === '') {
      throw new UsageError('--next action is empty — NEXT must say what happens next');
    }
    return `NEXT: ${ownerFlag} — ${nextFlag.trimEnd()}`;
  }
  const val = /** @type {string} */ (nextFlag);
  for (const bad of [' - ', ' – ', ' ― ', ' -- ']) {
    if (val.includes(bad)) {
      throw new UsageError(
        'the NEXT separator is an em-dash (U+2014) — use --next-owner <owner> --next <action> and the tool writes it for you'
      );
    }
  }
  const owner = nextOwner(`NEXT: ${val}`);
  if (owner === null) {
    throw new UsageError(
      "NEXT must be owned - use --next-owner <owner> --next <action>, or pre-compose '<owner> — <action>'"
    );
  }
  validateOwnerToken(owner);
  if (preComposedAction(val).trim() === '') {
    throw new UsageError('--next action is empty — NEXT must say what happens next');
  }
  return `NEXT: ${val.trimEnd()}`;
}

/**
 * The STATUS gate: a terminal status requires an owned NEXT; in-progress
 * requires and forbids nothing. One rule, applied at every call site that
 * resolves a status+next pair itself (stub, supersede — close/continuation
 * enforce it structurally via required flags).
 * @param {string} statusToken
 * @param {string|null} nextLine
 */
function assertTerminalHasNext(statusToken, nextLine) {
  if (TERMINAL_STATUSES.includes(statusToken) && !nextLine) {
    throw new UsageError(
      `a terminal STATUS (${TERMINAL_STATUSES.join('|')}) requires an owned NEXT - pass --next-owner <owner> --next <action>`
    );
  }
}

// --- body-line pipeline --------------------------------------------------

/**
 * @param {string} raw
 * @returns {string[]}
 */
function normalizeChunk(raw) {
  let text = raw;
  if (text.charCodeAt(0) === 0xfffd && text.charCodeAt(1) === 0xfffd) {
    throw new UsageError(
      'stdin looks UTF-16 — PowerShell > and Out-File default to that; re-encode as UTF-8'
    );
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd) throw new UsageError('input is not valid UTF-8 — re-encode');
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      throw new UsageError(
        `body contains a control character (0x${code.toString(16).padStart(2, '0')}) other than tab`
      );
    }
  }
  return text.split(/\r\n|\r|\n/);
}

/**
 * @param {string} line
 */
function validateBodyLine(line) {
  if (line.startsWith('STATUS:')) {
    throw new UsageError(`body line may not start with 'STATUS:' - that belongs to banana log close: "${line}"`);
  }
  if (line.startsWith('NEXT:')) {
    throw new UsageError(`body line may not start with 'NEXT:' - that belongs to banana log close: "${line}"`);
  }
  if (line.startsWith('SUPERSEDES:')) {
    throw new UsageError(
      `body line may not start with 'SUPERSEDES:' - that belongs to banana log supersede: "${line}"`
    );
  }
  if (isHeadingLine(line)) {
    throw new UsageError(
      `body line looks like a session-log heading and would poison the canon greps: "${line}"`
    );
  }
}

/**
 * Normalize and hard-validate one write's `--body` chunks. The >100-line /
 * >16KB reject stays scoped to THIS invocation's lines on purpose (canon:
 * a single write is capped regardless of how long the entry already is) —
 * unlike the >10-line WARN below, which scopes to the RESULTING entry body
 * and so can't be decided here; see maybeBodyLengthWarn.
 * @param {string[]} chunks
 * @returns {string[]}
 */
function buildBodyLines(chunks) {
  /** @type {string[]} */
  let lines = [];
  for (const raw of chunks) lines.push(...normalizeChunk(raw));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  for (const line of lines) validateBodyLine(line);
  const totalBytes = Buffer.byteLength(lines.join('\n'), 'utf8');
  if (lines.length > MAX_BODY_LINES || totalBytes > MAX_BODY_BYTES) {
    throw new UsageError(
      `body too large: ${lines.length} lines / ${totalBytes} bytes (max ${MAX_BODY_LINES} lines or ${MAX_BODY_BYTES} bytes per write)`
    );
  }
  return lines;
}

/**
 * @param {LogFlags} flags
 * @param {{ readStdin: () => Promise<string> | string, io: { out: (l?: string)=>void, err: (l?: string)=>void } }} deps
 * @returns {Promise<string[]>}
 */
async function resolveBodyLines(flags, deps) {
  const chunks = flags.bodyStdin ? [await deps.readStdin()] : flags.body;
  const lines = buildBodyLines(chunks);
  if (flags.verb === 'append' && lines.length === 0) {
    throw new UsageError('append requires at least one body line after normalization - nothing to append');
  }
  return lines;
}

/**
 * The >10-line body WARN (canon: bodies are pointers, not payloads) —
 * advisory only, never a reject. Scoped to the RESULTING entry body, not
 * this write alone: callers pass the composed new-entry body's line count
 * (stub/supersede/continuation writes) or `target.body.length + new lines`
 * (a plain append/close onto an already-open entry). Fires under --dry-run
 * too — advisories are never dry-run-silenced (B4).
 * @param {number} totalLines
 * @param {(line: string) => void} advise
 */
function maybeBodyLengthWarn(totalLines, advise) {
  if (totalLines > BODY_WARN_LINES) {
    advise(`WARN: entry body is ${totalLines} lines (canon: bodies <=10 lines, pointers not payloads)`);
  }
}

// --- write mechanics -------------------------------------------------

/**
 * @param {string} rawText
 * @returns {string}
 */
function sniffEol(rawText) {
  const lastNl = rawText.lastIndexOf('\n');
  if (lastNl === -1) return '\n';
  if (lastNl > 0 && rawText[lastNl - 1] === '\r') return '\r\n';
  return '\n';
}

/**
 * @param {string} text guaranteed to end with a newline
 * @returns {boolean}
 */
function endsWithBlankLine(text) {
  const normalized = text.replace(/\r/g, '');
  return /\n\n$/.test(normalized);
}

/**
 * @param {string} rawText
 * @param {string} eol
 * @returns {string}
 */
function computeNewHeadingPrefix(rawText, eol) {
  if (rawText.length === 0) return '';
  let prefix = '';
  let virtual = rawText;
  if (!virtual.endsWith('\n')) {
    prefix += eol;
    virtual += eol;
  }
  if (!endsWithBlankLine(virtual)) prefix += eol;
  return prefix;
}

/**
 * @param {string} rawText
 * @param {string} eol
 * @returns {string}
 */
function computePlainAppendPrefix(rawText, eol) {
  if (rawText.length === 0) return '';
  if (!rawText.endsWith('\n')) return eol;
  return '';
}

/**
 * @param {{date:string, agent:string, feature:string, n:number, phase:string, title:string}} fields
 * @returns {string}
 */
function assertEnvelopeRoundTrips(fields) {
  const heading = formatEnvelope(fields);
  const [parsed] = parseSessionLog(`${heading}\n`);
  const ok =
    parsed &&
    parsed.date === fields.date &&
    parsed.agent === fields.agent &&
    parsed.feature === fields.feature &&
    parsed.n === fields.n &&
    parsed.phase === fields.phase &&
    parsed.title === fields.title;
  if (!ok) {
    throw new UsageError(
      `internal error: composed envelope failed round-trip verification, refusing to write: ${heading}`
    );
  }
  return heading;
}

/**
 * @param {string} cwd
 * @param {string} text
 */
function writeOnce(cwd, text) {
  try {
    appendFileSync(sessionLogPath(cwd), Buffer.from(text, 'utf8'));
  } catch (error) {
    throw new StateError(`could not write ${SESSION_LOG_REF}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * @param {{cwd:string, rawText:string, eol:string, fields:{date:string,agent:string,feature:string,n:number,phase:string,title:string}, bodyLines:string[], dryRun:boolean}} args
 * @returns {{text: string}}
 */
function composeAndWriteNewEntry({ cwd, rawText, eol, fields, bodyLines, dryRun }) {
  const heading = assertEnvelopeRoundTrips(fields);
  const entryText = [heading, ...bodyLines].join(eol) + eol;
  const fullText = computeNewHeadingPrefix(rawText, eol) + entryText;
  if (!dryRun) writeOnce(cwd, fullText);
  return { text: fullText };
}

/**
 * @param {{cwd:string, rawText:string, eol:string, lines:string[], dryRun:boolean}} args
 * @returns {{text: string}}
 */
function writePlainAppend({ cwd, rawText, eol, lines, dryRun }) {
  const bodyText = lines.join(eol) + eol;
  const fullText = computePlainAppendPrefix(rawText, eol) + bodyText;
  if (!dryRun) writeOnce(cwd, fullText);
  return { text: fullText };
}

// The concurrency-guard continuation's SUPERSEDES reason (canon §3) — the
// single site that owns this literal, shared by doAppend and doClose.
const CONTINUATION_REASON = 'continuation — closes the entry left open above';

/**
 * Compose + write a concurrency-guard continuation entry (canon §3): a
 * fresh heading under the resolved target's feature/phase/title, carrying a
 * SUPERSEDES line back to the entry it closes. Shared by doAppend and
 * doClose — the two verbs that can land on a non-adjacent target.
 * @param {{cwd:string, rawText:string, eol:string, target:LogEntry, tag:string, date:string, newN:number, restLines:string[], dryRun:boolean}} args
 * @returns {{text: string, entryBody: string[]}}
 */
function writeContinuationEntry({ cwd, rawText, eol, target, tag, date, newN, restLines, dryRun }) {
  const fields = { date, agent: tag, feature: target.feature, n: newN, phase: target.phase, title: target.title };
  const supersedesLine = `SUPERSEDES: ${target.feature}.${target.n} (${CONTINUATION_REASON})`;
  const entryBody = [supersedesLine, ...restLines];
  const { text } = composeAndWriteNewEntry({ cwd, rawText, eol, fields, bodyLines: entryBody, dryRun });
  return { text, entryBody };
}

/**
 * @param {string} rawTextBefore
 * @param {string} appended
 * @param {(line: string) => void} advise
 */
function maybeOversizeWarn(rawTextBefore, appended, advise) {
  const lineCount = countLines(rawTextBefore + appended);
  if (lineCount > ROTATION_LINES) {
    advise(
      `WARN: ${SESSION_LOG_REF} is ${lineCount} lines (over ${ROTATION_LINES}) — canon SESSION-LOG.md section 8: archive to ${SESSION_ARCHIVE_DIR_REF}/{YYYY}-{Qn}.log`
    );
  }
}

/**
 * @param {LogEntry[]} active
 * @param {string} date
 * @param {(line: string) => void} advise
 */
function checkClockSkew(active, date, advise) {
  if (active.length === 0) return;
  const last = active[active.length - 1];
  if (date < last.date) advise(`clock skew: last entry dated ${last.date}, writing ${date}`);
}

/**
 * @param {LogEntry} entry
 * @returns {string}
 */
function ghostWarn(entry) {
  return `WARN: ${entry.feature}.${entry.n} has been open since ${entry.date}, over ${GHOST_THRESHOLD_HOURS}h (ghost) — proceeding under your own tag`;
}

/**
 * @param {number} lineNumber
 * @returns {string}
 */
function corruptWarn(lineNumber) {
  return `WARN: corrupt heading at line ${lineNumber} — invisible to brief/doctor`;
}

/**
 * Canon §6 promotion trigger — implements the two MECHANICAL clauses only
 * (a DECISION line present, or a PROBLEM with no matching FIX); the third
 * clause is a judgment call and is out of this tool's scope.
 * @param {string[]} bodyLines
 * @returns {boolean}
 */
function needsPromotion(bodyLines) {
  let decision = false;
  let problem = false;
  let fix = false;
  for (const line of bodyLines) {
    if (line.startsWith('DECISION:')) decision = true;
    if (line.startsWith('PROBLEM:')) problem = true;
    if (line.startsWith('FIX:')) fix = true;
  }
  return decision || (problem && !fix);
}

/**
 * Legacy pre-v2 log location (canon: honored read-only for history, never
 * written to or scanned for entries). Existence-only signal for the
 * missing-active-log error message — never read, never created.
 * @param {string} cwd
 * @returns {boolean}
 */
function hasLegacyLog(cwd) {
  return existsSync(join(cwd, '.claude', 'session.log'));
}

/**
 * @param {string} cwd
 * @returns {{active: LogEntry[], archives: SessionArchive[], rawText: string, eol: string}}
 */
function loadLogState(cwd) {
  let history;
  try {
    history = loadSessionHistory(cwd);
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (hasLegacyLog(cwd)) {
      message +=
        ' (a legacy .claude/session.log exists — honored read-only for history; write new entries to .agents/session.log)';
    }
    throw new StateError(message);
  }
  // A leading UTF-8 BOM (U+FEFF) glued to the file's first character would
  // otherwise glue itself to a heading-first log's `## [` too, so the raw
  // adjacency scan below (checkAdjacency, which works on THIS text, not the
  // BOM-stripping parseSessionLog) would see zero grep units and manufacture
  // a spurious continuation with no corrupt-heading warning. Strip it here,
  // once, for every consumer of rawText in this module.
  let rawText = readFileSync(sessionLogPath(cwd), 'utf8');
  if (rawText.charCodeAt(0) === 0xfeff) rawText = rawText.slice(1);
  return { active: history.active, archives: history.archives, rawText, eol: sniffEol(rawText) };
}

/**
 * The grep-unit adjacency check (canon §3 concurrency guard): is the target
 * entry's heading still the file's last `## [` line? Broader than the
 * parser on purpose — a mangled last heading counts as an intruder too.
 * @param {string} rawText
 * @param {LogEntry[]} active
 * @param {string} targetHeading
 */
function checkAdjacency(rawText, active, targetHeading) {
  const rawLines = rawText.split(/\r\n|\r|\n/);
  let lastIdx = -1;
  for (let i = 0; i < rawLines.length; i++) if (isHeadingLine(rawLines[i])) lastIdx = i;
  const lastHeadingText = lastIdx === -1 ? null : rawLines[lastIdx];
  const parsedHeadings = new Set(active.map((e) => e.heading));
  const corrupt = lastHeadingText !== null && !parsedHeadings.has(lastHeadingText);
  return {
    adjacent: lastHeadingText === targetHeading,
    lastHeadingText,
    lastLineNumber: lastIdx + 1,
    corrupt,
  };
}

/**
 * @param {LogEntry} target
 * @param {{lastHeadingText: string|null}} adjacency
 * @param {string} cwd
 * @returns {string}
 */
function noContinueRefusalMessage(target, adjacency, cwd) {
  const newN = nextN(cwd, target.feature);
  return (
    `${target.feature}.${target.n} is no longer the last heading (intruder: "${adjacency.lastHeadingText}") - ` +
    `a continuation ${target.feature}.${newN} would be written; rerun without --no-continue to write it`
  );
}

/**
 * Target resolution for append/close (canon §3): the LAST live (not
 * superseded), open entry under --tag, for feature, in file order.
 * @param {{active: LogEntry[], feature: string, tag: string, io: {err:(l?:string)=>void}}} args
 * @returns {LogEntry}
 */
function resolveTarget({ active, feature, tag, io }) {
  const rawFeatureEntries = entriesForFeature(active, feature);
  if (rawFeatureEntries.length === 0) {
    const hint = nearMissSuffix(feature, knownFeatureSlugs(active, []));
    throw new StateError(`no entries for '${feature}' yet — open one with \`banana log stub\`${hint}`);
  }
  const ids = supersededIds(active);
  const live = rawFeatureEntries.filter((e) => !ids.has(`${e.feature}.${e.n}`));
  const eligible = live.filter((e) => isOpen(e));
  const ownEligible = eligible.filter((e) => e.agent === tag);
  if (ownEligible.length > 0) {
    const target = ownEligible[ownEligible.length - 1];
    if (ownEligible.length > 1) {
      const earlier = ownEligible
        .slice(0, -1)
        .map((e) => `${e.feature}.${e.n}`)
        .join(', ');
      io.err(
        `WARN: multiple open entries for '${feature}' under '${tag}' — targeting ${target.feature}.${target.n}; also open: ${earlier}`
      );
    }
    return target;
  }
  const ownAny = live.filter((e) => e.agent === tag);
  if (ownAny.length > 0) {
    const latest = ownAny[ownAny.length - 1];
    throw new StateError(
      `${latest.feature}.${latest.n} is closed (${latest.status}) — closed entries are immutable; ` +
        `corrections go through \`banana log supersede ${latest.feature}.${latest.n}\``
    );
  }
  if (eligible.length > 0) {
    const other = eligible[eligible.length - 1];
    throw new StateError(
      `no open entry for '${feature}' tagged '${tag}' — ${other.feature}.${other.n} is open under ` +
        `'${other.agent}'; open your own with \`banana log stub\``
    );
  }
  throw new StateError(
    `no open entry for '${feature}' — remaining entries are closed or superseded; open one with \`banana log stub\``
  );
}

// --- supersede target resolution -----------------------------------

/**
 * @param {string} raw
 * @returns {{feature: string, n: number}}
 */
function parseSupersedeTargetShape(raw) {
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0) throw new UsageError(`supersede target must look like {feature}.{n} (got '${raw}')`);
  const feature = raw.slice(0, lastDot);
  const tail = raw.slice(lastDot + 1);
  if (!/^\d+$/.test(tail)) {
    throw new UsageError(`supersede target must look like {feature}.{n} (got '${raw}')`);
  }
  return { feature, n: Number(tail) };
}

/**
 * @param {LogEntry[]} active
 * @param {SessionArchive[]} archives
 * @param {string} feature
 * @returns {string[]}
 */
function knownIdsFor(active, archives, feature) {
  /** @type {Set<number>} */
  const ns = new Set();
  for (const e of active) if (e.feature === feature) ns.add(e.n);
  for (const { entries } of archives) for (const e of entries) if (e.feature === feature) ns.add(e.n);
  return [...ns].sort((a, b) => a - b).map((n) => `${feature}.${n}`);
}

/**
 * @param {{active: LogEntry[], archives: SessionArchive[], feature: string, n: number, targetAgent: string|null}} args
 * @returns {{entry: LogEntry, archiveFile: string|null}}
 */
function findSupersedeTarget({ active, archives, feature, n, targetAgent }) {
  /** @type {{entry: LogEntry, archiveFile: string|null}[]} */
  const candidates = [];
  for (const e of active) if (e.feature === feature && e.n === n) candidates.push({ entry: e, archiveFile: null });
  for (const { file, entries } of archives) {
    for (const e of entries) if (e.feature === feature && e.n === n) candidates.push({ entry: e, archiveFile: file });
  }

  if (candidates.length === 0) {
    const slugs = knownFeatureSlugs(active, archives);
    if (!slugs.has(feature)) {
      throw new StateError(`no feature '${feature}' known${nearMissSuffix(feature, slugs)}`);
    }
    const known = knownIdsFor(active, archives, feature);
    throw new StateError(`${feature}.${n} not found - known: ${known.join(', ')}`);
  }

  let pool = candidates;
  if (targetAgent !== null) {
    pool = candidates.filter((c) => c.entry.agent === targetAgent);
    if (pool.length === 0) throw new StateError(`no ${feature}.${n} entry authored by '${targetAgent}'`);
  }
  if (pool.length > 1) {
    const headings = pool.map((c) => c.entry.heading).join(' | ');
    throw new StateError(
      `${feature}.${n} is ambiguous (${pool.length} entries) - pass --target-agent <tag> to disambiguate: ${headings}`
    );
  }
  return pool[0];
}

// --- verb handlers -----------------------------------------------------

/**
 * @param {LogFlags} flags
 * @param {LogDeps} deps
 */
async function doStub(flags, deps) {
  const { cwd, io, now } = deps;

  validateTag(flags.tag);
  const feature = validateFeatureSlug(/** @type {string} */ (flags.feature));
  const { active, archives, rawText, eol } = loadLogState(cwd);

  const slugs = knownFeatureSlugs(active, archives);
  if (!slugs.has(feature)) {
    const ci = caseInsensitiveMatch(feature, slugs);
    if (ci !== null) {
      throw new UsageError(
        `feature '${feature}' looks like a case-variant of existing feature '${ci}' — a case-split stream ` +
          `would be unfixable in an append-only log; use '${ci}'`
      );
    }
  }

  const phase = normalizePhase(/** @type {string} */ (flags.phase));
  const title = validateTitleText(flags.title, 'title', io.err);
  const approach = validateTitleText(flags.approach, 'approach', io.err);
  const bodyLines = await resolveBodyLines(flags, deps);

  let blockedLine = null;
  if (flags.blocked !== null) blockedLine = `BLOCKED: ${validateSingleLine(flags.blocked, 'blocked')}`;

  const rawStatus = flags.status === null ? 'in-progress' : flags.status;
  const statusToken = firstToken(rawStatus);
  if (!STATUSES.includes(statusToken)) throw new UsageError(statusVocabError(statusToken));

  const nextLine = composeNext(flags);
  assertTerminalHasNext(statusToken, nextLine);

  if (rawText.length === 0) io.err('log has no seed header — run `banana project` to restore it');

  const n = nextN(cwd, feature);
  const date = formatLocalDate(now);
  checkClockSkew(active, date, io.err);

  const fields = { date, agent: flags.tag, feature, n, phase, title };
  const entryBody = [`APPROACH: ${approach}`, ...bodyLines];
  if (blockedLine) entryBody.push(blockedLine);
  entryBody.push(`STATUS: ${rawStatus}`);
  if (nextLine) entryBody.push(nextLine);

  const promote = TERMINAL_STATUSES.includes(statusToken) && needsPromotion(bodyLines);

  const { text } = composeAndWriteNewEntry({ cwd, rawText, eol, fields, bodyLines: entryBody, dryRun: flags.dryRun });
  if (promote) io.err(PROMOTION_NOTICE);
  maybeBodyLengthWarn(entryBody.length, io.err);
  maybeOversizeWarn(rawText, text, io.err);
  if (flags.dryRun) {
    (io.write ?? io.out)(text);
    return { code: 0 };
  }
  if (!flags.quiet) io.out(`${feature}.${n}`);
  return { code: 0 };
}

/**
 * @param {LogFlags} flags
 * @param {LogDeps} deps
 */
async function doAppend(flags, deps) {
  const { cwd, io, now } = deps;

  validateTag(flags.tag);
  const feature = validateFeatureSlug(/** @type {string} */ (flags.feature));
  const { active, rawText, eol } = loadLogState(cwd);
  const target = resolveTarget({ active, feature, tag: flags.tag, io });
  if (isGhost(target, now)) io.err(ghostWarn(target));

  const bodyLines = await resolveBodyLines(flags, deps);
  const adjacency = checkAdjacency(rawText, active, target.heading);
  if (adjacency.corrupt) io.err(corruptWarn(adjacency.lastLineNumber));

  if (adjacency.adjacent) {
    const { text } = writePlainAppend({ cwd, rawText, eol, lines: bodyLines, dryRun: flags.dryRun });
    maybeBodyLengthWarn(target.body.length + bodyLines.length, io.err);
    maybeOversizeWarn(rawText, text, io.err);
    if (flags.dryRun) {
      (io.write ?? io.out)(text);
      return { code: 0 };
    }
    if (!flags.quiet) io.out(`${target.feature}.${target.n}`);
    return { code: 0 };
  }

  if (flags.noContinue) throw new StateError(noContinueRefusalMessage(target, adjacency, cwd));

  const newN = nextN(cwd, target.feature);
  const date = formatLocalDate(now);
  checkClockSkew(active, date, io.err);

  const { text, entryBody } = writeContinuationEntry({
    cwd,
    rawText,
    eol,
    target,
    tag: flags.tag,
    date,
    newN,
    restLines: ['STATUS: in-progress', ...bodyLines],
    dryRun: flags.dryRun,
  });
  io.err(
    `note: ${target.feature}.${target.n} was no longer the last heading — wrote continuation ${target.feature}.${newN}`
  );
  maybeBodyLengthWarn(entryBody.length, io.err);
  maybeOversizeWarn(rawText, text, io.err);
  if (flags.dryRun) {
    (io.write ?? io.out)(text);
    return { code: 0 };
  }
  if (!flags.quiet) io.out(`${target.feature}.${newN}`);
  return { code: 0 };
}

/**
 * @param {LogFlags} flags
 * @param {LogDeps} deps
 */
async function doClose(flags, deps) {
  const { cwd, io, now } = deps;

  validateTag(flags.tag);
  const feature = validateFeatureSlug(/** @type {string} */ (flags.feature));
  const { active, rawText, eol } = loadLogState(cwd);
  const target = resolveTarget({ active, feature, tag: flags.tag, io });
  if (isGhost(target, now)) io.err(ghostWarn(target));

  const rawStatus = /** @type {string} */ (flags.status);
  const statusToken = firstToken(rawStatus);
  if (!STATUSES.includes(statusToken)) throw new UsageError(statusVocabError(statusToken));
  if (statusToken === 'in-progress') {
    throw new UsageError(
      'a close writes a terminal status (complete|blocked|abandoned) — use banana log append for checkpoints'
    );
  }

  const nextLine = composeNext(flags);
  if (!nextLine) throw new UsageError('close requires --next (owned) - pass --next-owner <owner> --next <action>');

  let blockedLine = null;
  if (flags.blocked !== null) blockedLine = `BLOCKED: ${validateSingleLine(flags.blocked, 'blocked')}`;

  const closeLines = [];
  if (blockedLine) closeLines.push(blockedLine);
  closeLines.push(`STATUS: ${rawStatus}`);
  closeLines.push(nextLine);

  const adjacency = checkAdjacency(rawText, active, target.heading);
  if (adjacency.corrupt) io.err(corruptWarn(adjacency.lastLineNumber));
  const promote = needsPromotion(target.body);

  if (adjacency.adjacent) {
    const { text } = writePlainAppend({ cwd, rawText, eol, lines: closeLines, dryRun: flags.dryRun });
    if (promote) io.err(PROMOTION_NOTICE);
    maybeBodyLengthWarn(target.body.length + closeLines.length, io.err);
    maybeOversizeWarn(rawText, text, io.err);
    if (flags.dryRun) {
      (io.write ?? io.out)(text);
      return { code: 0 };
    }
    if (!flags.quiet) io.out(`${target.feature}.${target.n}`);
    return { code: 0 };
  }

  if (flags.noContinue) throw new StateError(noContinueRefusalMessage(target, adjacency, cwd));

  const newN = nextN(cwd, target.feature);
  const date = formatLocalDate(now);
  checkClockSkew(active, date, io.err);

  const { text, entryBody } = writeContinuationEntry({
    cwd,
    rawText,
    eol,
    target,
    tag: flags.tag,
    date,
    newN,
    restLines: closeLines,
    dryRun: flags.dryRun,
  });
  io.err(
    `note: ${target.feature}.${target.n} was no longer the last heading — wrote continuation ${target.feature}.${newN}`
  );
  if (promote) io.err(PROMOTION_NOTICE);
  maybeBodyLengthWarn(entryBody.length, io.err);
  maybeOversizeWarn(rawText, text, io.err);
  if (flags.dryRun) {
    (io.write ?? io.out)(text);
    return { code: 0 };
  }
  if (!flags.quiet) io.out(`${target.feature}.${newN}`);
  return { code: 0 };
}

/**
 * @param {LogFlags} flags
 * @param {LogDeps} deps
 */
async function doSupersede(flags, deps) {
  const { cwd, io, now } = deps;

  validateTag(flags.tag);
  const { feature: targetFeature, n: targetN } = parseSupersedeTargetShape(/** @type {string} */ (flags.target));
  const { active, archives, rawText, eol } = loadLogState(cwd);

  const found = findSupersedeTarget({ active, archives, feature: targetFeature, n: targetN, targetAgent: flags.targetAgent });
  const target = found.entry;
  if (found.archiveFile) io.err(`note: ${targetFeature}.${targetN} resolved from archive ${found.archiveFile}`);
  if (target.agent !== flags.tag) io.err(`note: ${targetFeature}.${targetN} was authored by '${target.agent}', not '${flags.tag}'`);

  const reason = validateReasonText(flags.reason);

  const newFeature = flags.featureOverride !== null ? validateFeatureSlug(flags.featureOverride) : target.feature;
  const title = flags.title !== null ? validateTitleText(flags.title, 'title', io.err) : target.title;
  const phase = flags.phase !== null ? normalizePhase(flags.phase) : target.phase;

  // No --blocked here by design: the supersede surface doesn't take one
  // (VERB_SPECS.supersede has no 'blocked' entry — adding it is a tracker
  // item, not this fix).
  const bodyLines = await resolveBodyLines(flags, deps);

  const rawStatus = /** @type {string} */ (flags.status);
  const statusToken = firstToken(rawStatus);
  if (!STATUSES.includes(statusToken)) throw new UsageError(statusVocabError(statusToken));

  const nextLine = composeNext(flags);
  assertTerminalHasNext(statusToken, nextLine);

  const n = nextN(cwd, newFeature);
  const date = formatLocalDate(now);
  checkClockSkew(active, date, io.err);

  const fields = { date, agent: flags.tag, feature: newFeature, n, phase, title };
  const supersedesLine = `SUPERSEDES: ${targetFeature}.${targetN} (${reason})`;
  const entryBody = [supersedesLine, ...bodyLines];
  entryBody.push(`STATUS: ${rawStatus}`);
  if (nextLine) entryBody.push(nextLine);

  const promote = TERMINAL_STATUSES.includes(statusToken) && needsPromotion(bodyLines);

  const { text } = composeAndWriteNewEntry({ cwd, rawText, eol, fields, bodyLines: entryBody, dryRun: flags.dryRun });
  if (promote) io.err(PROMOTION_NOTICE);
  maybeBodyLengthWarn(entryBody.length, io.err);
  maybeOversizeWarn(rawText, text, io.err);
  if (flags.dryRun) {
    (io.write ?? io.out)(text);
    return { code: 0 };
  }
  if (!flags.quiet) io.out(`${newFeature}.${n}`);
  return { code: 0 };
}

/**
 * @typedef {object} LogResult
 * @property {number} code
 */

/**
 * Run a parsed `banana log` invocation. Exit codes: 0 ok, 1 usage/validation,
 * 2 disk-state precondition (missing log, unresolvable target, --no-continue
 * refusal, unwritable file).
 * @param {LogFlags} flags
 * @param {LogDeps} deps
 * @returns {Promise<LogResult>}
 */
export async function runLog(flags, deps) {
  const err = deps.io.err ?? deps.io.out;
  try {
    switch (flags.verb) {
      case 'stub':
        return await doStub(flags, deps);
      case 'append':
        return await doAppend(flags, deps);
      case 'close':
        return await doClose(flags, deps);
      case 'supersede':
        return await doSupersede(flags, deps);
      default:
        throw new UsageError(`unknown log verb '${flags.verb}' (expected ${VERBS.join('|')})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(`banana log: ${message}`);
    return { code: error instanceof StateError ? 2 : 1 };
  }
}
