// Harness detection for `init` and `doctor`. Everything takes an injectable
// home root and env — nothing in here reads the real HOME or process state,
// so tests run against fixture fake-home trees exclusively.
import { existsSync, statSync } from 'node:fs';
import { join, delimiter } from 'node:path';

/**
 * @typedef {object} HarnessSpec
 * @property {string} id stable identifier used by adapters and reports
 * @property {string} name human-readable name
 * @property {string} dir dot-dir under the home root whose presence means installed
 * @property {string | null} bin binary name to look up on PATH as a fallback, if any
 */

/**
 * @typedef {object} HarnessReport
 * @property {string} id
 * @property {string} name
 * @property {boolean} detected
 * @property {'home-dir' | 'path' | null} via how it was found
 * @property {string | null} location the dir or binary path that matched
 */

/** @type {HarnessSpec[]} */
export const HARNESSES = [
  { id: 'claude-code', name: 'Claude Code', dir: '.claude', bin: 'claude' },
  { id: 'pi', name: 'Pi', dir: '.pi', bin: null },
  { id: 'codex', name: 'Codex', dir: '.codex', bin: null },
  { id: 'hermes', name: 'Hermes', dir: '.hermes', bin: 'hermes' },
];

/**
 * Look up a binary on the given env's PATH. Checks the bare name plus
 * PATHEXT suffixes (Windows launchers like claude.cmd).
 * @param {string} bin
 * @param {{ PATH?: string, PATHEXT?: string }} env
 * @returns {string | null} full path of the first match, or null
 */
export function findOnPath(bin, env) {
  const pathVar = env.PATH ?? '';
  if (pathVar === '') return null;
  const exts = ['', ...(env.PATHEXT ?? '').split(';').filter(Boolean)];
  for (const dir of pathVar.split(delimiter)) {
    if (dir === '') continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Detect a single harness under the given home root.
 * @param {HarnessSpec} spec
 * @param {string} home
 * @param {{ PATH?: string, PATHEXT?: string }} env
 * @returns {HarnessReport}
 */
function detectOne(spec, home, env) {
  const homeDir = join(home, spec.dir);
  if (isDir(homeDir)) {
    return { id: spec.id, name: spec.name, detected: true, via: 'home-dir', location: homeDir };
  }
  if (spec.bin !== null) {
    const binPath = findOnPath(spec.bin, env);
    if (binPath !== null) {
      return { id: spec.id, name: spec.name, detected: true, via: 'path', location: binPath };
    }
  }
  return { id: spec.id, name: spec.name, detected: false, via: null, location: null };
}

/**
 * Detect all known harnesses under a home root.
 * @param {string} home root to scan (the real HOME in production, a sandbox in tests)
 * @param {{ env?: { PATH?: string, PATHEXT?: string } }} [opts]
 * @returns {{ home: string, harnesses: HarnessReport[] }}
 */
export function detect(home, opts = {}) {
  const env = opts.env ?? { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT };
  return { home, harnesses: HARNESSES.map((spec) => detectOne(spec, home, env)) };
}
