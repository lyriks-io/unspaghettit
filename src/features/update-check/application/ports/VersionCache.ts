/**
 * A single-slot cache of the last registry lookup, so the check runs at most
 * once per TTL instead of hitting the network on every command. `checkedAt` is
 * epoch milliseconds; the use-case compares it against the injected clock.
 *
 * Both methods are best-effort and synchronous: `read` returns null on a
 * missing/corrupt cache, `write` swallows IO errors (a read-only home directory
 * must never break the command the user actually ran). Synchronous so the CLI
 * can consult it on the hot path without awaiting.
 */
export type CachedVersionCheck = {
  readonly latest: string;
  readonly checkedAt: number;
};

export interface VersionCache {
  read(): CachedVersionCheck | null;
  write(entry: CachedVersionCheck): void;
}
