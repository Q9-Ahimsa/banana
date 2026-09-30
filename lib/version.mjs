// Shared kit-version helpers, single-sourced so #6 (doctor's local-vs-origin
// check) and #8 (the brief prints the kit version) don't each grow their own
// copy. Both operations read straight from disk on every call — never cached
// at module load — because doctor needs to see a version bump after sync
// refreshes the kit without a process restart.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The kit's root directory, resolved from this module's own location. */
export const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Read the `version` field out of `<kitRoot>/package.json`.
 * @param {string} [kitRoot] defaults to the bundled kit's own root
 * @returns {string | null} the version string, or null if the file is
 *   missing, unreadable, the JSON is malformed, or `version` isn't a
 *   non-empty string
 */
export function readKitVersion(kitRoot = KIT_ROOT) {
  const pkgPath = join(kitRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  return typeof pkg?.version === 'string' && pkg.version.length > 0 ? pkg.version : null;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * Compare two plain MAJOR.MINOR.PATCH versions numerically, part by part.
 * One leading `v` is allowed on either side.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1 | null} null if either side isn't exactly three
 *   dot-separated non-negative integers (prerelease/build suffixes included)
 */
export function compareVersions(a, b) {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (pa === null || pb === null) return null;
  for (let i = 1; i <= 3; i += 1) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}
