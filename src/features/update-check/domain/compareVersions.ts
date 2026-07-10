/**
 * Minimal semver comparison, enough to answer "is a newer release out?".
 *
 * Parses the `major.minor.patch` core of a version, ignoring a leading `v` and
 * any `-prerelease` / `+build` suffix. The registry's `latest` dist-tag is
 * always a stable release, so dropping prerelease identifiers is intentional:
 * we never nag someone on a stable build to move to a prerelease. Anything that
 * doesn't parse to finite numbers yields `false` (no notice) rather than a
 * spurious "update available" — being wrong-silent beats being wrong-loud.
 *
 * Kept tiny and dependency-free on purpose: pulling in the full `semver`
 * package for one comparison isn't worth the install weight in a local-first
 * CLI, and the version shapes we ship are plain `x.y.z`.
 */

const parseCore = (version: string): readonly number[] => {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/, 1)[0] ?? '';
  return core.split('.').map((part) => Number.parseInt(part, 10));
};

/** True when `latest` is a strictly newer release than `current`. */
export const isNewerVersion = (latest: string, current: string): boolean => {
  const a = parseCore(latest);
  const b = parseCore(current);
  if (a.length === 0 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
};
