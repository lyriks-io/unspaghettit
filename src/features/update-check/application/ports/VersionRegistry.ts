/**
 * Source of the newest published version for a package. The one adapter today
 * reads the npm registry, but the port keeps the use-case testable (a fake
 * returns a fixed version) and swappable (a private registry, a mirror).
 *
 * Total and fail-silent by contract: `fetchLatest` resolves to `null` on any
 * failure (offline, timeout, non-200, malformed body) rather than rejecting, so
 * the update check never turns a network hiccup into a crash or a stack trace
 * in the user's terminal.
 */
export interface VersionRegistry {
  fetchLatest(packageName: string): Promise<string | null>;
}
