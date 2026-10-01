// sync command: propagates upstream kit updates to an already-wired machine.
// Three moves: (0) best-effort kit-update step (#6, ADR 0002) — `npm install
// -g` ahead of everything else, via an injected exec, so canon/template
// content is read fresh from disk afterward; a failed or absent update
// degrades to a warning and never blocks the rest of the run. (1) refresh
// the kit-owned <home>/.agents/canon/ dir to the bundled canon byte-for-byte;
// (2) re-apply the fenced wiring block to every already-wired harness file
// whose block version is older than the current template, preserving the
// owner/tag the block was rendered with. User-owned surfaces (STATE.md,
// logs, logbooks, anything outside a fence) are never touched, and unwired
// files are never created.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { extractIdentity, findFence } from './fence.mjs';
import { CANON_FILES, FILE_ADAPTERS } from './init.mjs';
import { KIT_ROOT, compareVersions, readKitVersion } from './version.mjs';
import { wiringTemplateVersion } from './wiring.mjs';

// extractIdentity now lives in lib/fence.mjs (single-sourced per #16 — every
// fence-writing path shares one "read identity from an existing fence" step)
// and is re-exported here for backward compatibility with existing imports.
export { extractIdentity };

/** @typedef {object} SyncFlags */

/**
 * @typedef {object} SyncIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} [err]
 */

/**
 * Parse the argv slice after the `sync` subcommand.
 * @param {string[]} argv
 * @returns {SyncFlags}
 * @throws on any argument — sync takes none
 */
export function parseSyncArgs(argv) {
  for (const arg of argv) throw new Error(`unknown sync option '${arg}'`);
  return {};
}

/**
 * @typedef {object} SyncResult
 * @property {number} code process exit code: 0 on success (skips included), 1 on failure
 */

/**
 * The first non-empty line of a stderr blob, trimmed — or null when every
 * line is blank/whitespace, or there's no text at all (review N13: an
 * injected exec resolving `stderr: undefined` must not throw here).
 * @param {string | undefined} stderr
 * @returns {string | null}
 */
function firstNonEmptyLine(stderr) {
  for (const line of (stderr ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * The `name` field of `<kitRoot>/package.json` — used below to find where a
 * global `npm install -g` actually lands (`<npm root -g>/<name>`), which is
 * NOT necessarily kitRoot itself (never true on the npx cold-bootstrap
 * path, where kitRoot is npx's own cache copy, not the global prefix).
 * Never hard-code the kit's package name (review S1) — read it, so a
 * rename or a fork under a different name still resolves correctly.
 * @param {string} kitRoot
 * @returns {string | null}
 */
function readKitName(kitRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));
    return typeof pkg?.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * `v<version>`, or `unknown` when version is null (review N12: a null
 * version must never render as the literal "vnull").
 * @param {string | null} version
 * @returns {string}
 */
function versionLabel(version) {
  return version === null ? 'unknown' : `v${version}`;
}

/**
 * Whether two paths name the same location on disk, identity normalized
 * (review F1/F7): both resolved via `path.resolve()`, then compared
 * case-insensitively on win32 — a case-insensitive filesystem, where a
 * drive letter or path segment spelled differently is still the same
 * install target.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  const ra = resolve(a);
  const rb = resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Whether `root` looks like a real banana kit tree, not merely a directory
 * that happens to exist at the resolved install path (review F4): a
 * readable `package.json`, the first bundled canon file, and the wiring
 * templates dir must all be present. A non-kit-shaped tree is never
 * adopted — refresh falls back to the launched tree instead of reading
 * garbage, or crashing on a missing file.
 * @param {string} root
 * @returns {boolean}
 */
function isKitShaped(root) {
  try {
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
  return (
    existsSync(join(root, 'canon', CANON_FILES[0])) && existsSync(join(root, 'templates', 'wiring'))
  );
}

/**
 * Run the sync command: best-effort kit-update, then refresh the canon dir,
 * upgrade stale wiring fences, report each change.
 * @param {SyncFlags} flags
 * @param {{ home: string, io: SyncIo,
 *           exec?: (command: string, args?: string[]) => Promise<import('./proc.mjs').ExecResult>,
 *           kitRoot?: string }} deps
 * @returns {Promise<SyncResult>}
 */
export async function runSync(flags, deps) {
  const { home, io } = deps;
  const out = io.out;
  const err = io.err ?? io.out;
  // Mutable: a successful update may move this to the resolved GLOBAL
  // install tree (review S1) — see below.
  let kitRoot = deps.kitRoot ?? KIT_ROOT;

  try {
    let changes = 0;

    // Kit-update step (#6, ADR 0002): best-effort `npm install -g` ahead of
    // everything below, so a single sync run propagates freshly fetched
    // content. Skipped silently when no exec is injected (today's library
    // callers/tests keep today's behavior). A failure here never blocks the
    // canon/fence refresh that follows (except one case below), and never
    // affects the exit code.
    if (deps.exec) {
      // Resolve where `npm install -g` actually lands: the npm global
      // prefix, not necessarily kitRoot — never true on the npx
      // cold-bootstrap path, where kitRoot is npx's own cache copy of the
      // kit, never the global prefix `npm install -g` writes to (review
      // S1). `npm root -g` is a stable, local-only, read-only query, safe
      // to resolve up front. Only a non-empty, ABSOLUTE result is ever
      // trusted (review F2): empty stdout joined with `own` is a RELATIVE
      // path, resolved against cwd by every fs read below it — a
      // kit-shaped directory that happens to sit in the working directory
      // must never be picked up as the install root.
      const launchedRoot = kitRoot;
      const own = readKitName(launchedRoot);
      let installRoot = null;
      if (own !== null) {
        const rootResult = await deps.exec('npm', ['root', '-g']);
        if (rootResult.code === 0) {
          const rootOut = (rootResult.stdout ?? '').trim();
          if (rootOut !== '' && isAbsolute(rootOut)) installRoot = join(rootOut, own);
        }
      }
      // The tree whose before/after version drives the installed/updated/
      // current wording below: the resolved install root when there is
      // one, else the launched tree itself — the root lookup failed, or
      // `own` couldn't be read, so the launched tree is the only tree in
      // play, and before/after are read from — and compared against —
      // itself.
      const updateTarget = installRoot ?? launchedRoot;
      const before = readKitVersion(updateTarget);

      const result = await deps.exec('npm', ['install', '-g', 'github:Q9-Ahimsa/banana']);

      if (result.code === 0) {
        const after = readKitVersion(updateTarget);
        const versionLine = () =>
          before === null && after !== null
            ? `kit installed: ${versionLabel(after)}`
            : before !== after
              ? `kit updated: ${versionLabel(before)} -> ${versionLabel(after)}`
              : `kit current: ${versionLabel(after)}`;

        if (installRoot === null) {
          // No separate install tree candidate — the launched tree already
          // IS updateTarget, so there is nothing left to select between.
          out(versionLine());
        } else if (!isKitShaped(installRoot)) {
          // Tree selection (review F4, orchestrator ruling): the install
          // tree is adopted only if it is kit-shaped. A stray or
          // half-formed directory at the resolved path falls back to the
          // launched tree — never an exit-1 ENOENT.
          err(
            `kit update: the installed copy at ${installRoot} is not kit-shaped — refreshing from the launched copy`,
          );
        } else {
          // Between a kit-shaped install tree and the launched tree, the
          // NEWER version wins (review F4, orchestrator ruling); a tie
          // favors the install tree (the global path is then left
          // unchanged); an unparseable version on either side favors the
          // launched tree.
          const launchedVersion = readKitVersion(launchedRoot);
          const cmp =
            after !== null && launchedVersion !== null ? compareVersions(after, launchedVersion) : null;
          if (cmp === -1) {
            out(
              `kit: the installed copy is ${versionLabel(after)}, older than this run's ` +
                `${versionLabel(launchedVersion)} — refreshing from ${versionLabel(launchedVersion)}`,
            );
          } else {
            out(versionLine());
            // A tie (cmp === 0) or a genuine newer install (cmp === 1)
            // both adopt the install tree; an unparseable version on
            // either side (cmp === null) stays conservative and keeps the
            // launched tree instead.
            if (cmp !== null) kitRoot = installRoot;
          }
        }
        // Below, moves 1-2 read canon/templates from `kitRoot` — the
        // launched tree, or the newly adopted install tree above — so this
        // run propagates whatever the update just landed without a
        // process restart.
      } else {
        const isTimeout = typeof result.error === 'string' && result.error.startsWith('timed out');
        // The tree we're about to refresh FROM is the same tree the
        // (interrupted) update was writing INTO: it may be half-written,
        // so skip the refresh entirely rather than risk reading corrupt
        // canon/template content. `installRoot === null` (the lookup
        // itself failed, or never ran) stays conservative and skips too —
        // with no resolved install target, the launched tree is the only
        // candidate, and it may be exactly what a half-finished global
        // install just wrote into. Any OTHER failure (offline, npm
        // missing, a plain non-zero exit) never touched this read path, so
        // it's always safe to refresh past — the ticket's own requirement.
        const refreshingInstallTarget = installRoot === null || samePath(installRoot, kitRoot);
        if (isTimeout && refreshingInstallTarget) {
          err('kit update timed out — the kit may be half-installed; re-run banana sync');
          return { code: 0 };
        }
        const reason = result.error ?? firstNonEmptyLine(result.stderr) ?? `exit ${result.code}`;
        err(`kit update skipped (${reason}) — refreshing from the launched copy`);
      }
    }

    const wiringDir = join(kitRoot, 'templates', 'wiring');

    // Canon: kit-owned, created or refreshed to the bundled files. Read
    // fresh from kitRoot on every call, after the update step above, so a
    // single sync run picks up whatever npm install just dropped on disk.
    const canonDir = join(home, '.agents', 'canon');
    mkdirSync(canonDir, { recursive: true });
    for (const name of CANON_FILES) {
      const target = join(canonDir, name);
      const bundled = readFileSync(join(kitRoot, 'canon', name), 'utf8');
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
      if (existing === bundled) continue;
      writeFileSync(target, bundled);
      out(`${existing === null ? 'installed' : 'refreshed'} ${target}`);
      changes += 1;
    }

    // Fences: only files that already carry a banana block are eligible, and
    // only when their block is older than the current template. Owner/tag come
    // from the existing block — sync never invents identity; a block it cannot
    // read is skipped (init is the remediation), never overwritten. The
    // current version and the re-fence's rendered content both come from
    // wiringDir (kitRoot's templates/wiring), fresh on every call — same
    // rationale as the canon reads above.
    for (const adapter of FILE_ADAPTERS) {
      const spec = adapter.describe();
      const target = join(home, spec.target);
      if (!existsSync(target)) continue;
      const text = readFileSync(target, 'utf8');
      /** @type {ReturnType<typeof findFence>} */
      let fence;
      try {
        fence = findFence(text);
      } catch (error) {
        err(`skipped ${target}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      if (fence === null) continue;
      const current = wiringTemplateVersion(spec.template, wiringDir);
      if (fence.version >= current) continue;
      const { owner, tag } = extractIdentity(text.slice(fence.start, fence.end));
      if (owner === null || tag === null) {
        err(
          `skipped ${target}: cannot recover owner/tag from the v${fence.version} block — re-run init`,
        );
        continue;
      }
      adapter.wire(home, { owner, tag }, wiringDir);
      out(`re-fenced ${target}: v${fence.version} -> v${current}`);
      changes += 1;
    }

    out(changes === 0 ? 'sync: no changes — canon and fences current' : `sync: ${changes} change(s)`);
    return { code: 0 };
  } catch (error) {
    err(`banana sync: ${error instanceof Error ? error.message : error}`);
    return { code: 1 };
  }
}
