import { isNewerVersion } from '../domain/compareVersions';
import type { VersionStatus } from '../domain/VersionStatus';
import type { VersionCache } from './ports/VersionCache';
import type { VersionRegistry } from './ports/VersionRegistry';

/** Default: check the registry at most once per 24h. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type UpdateCheckDeps = {
  readonly registry: VersionRegistry;
  readonly cache: VersionCache;
  /** Epoch-ms clock, injected so tests control TTL expiry. */
  readonly now: () => number;
  readonly ttlMs?: number;
  /** When true, skip the registry and the cache entirely (opt-out). */
  readonly disabled?: boolean;
};

export type CheckForUpdateInput = {
  readonly current: string;
  readonly packageName: string;
  /** Ignore cache freshness and hit the registry now (the explicit command). */
  readonly forceRefresh?: boolean;
};

const statusFrom = (current: string, latest: string | null): VersionStatus => ({
  current,
  latest,
  updateAvailable: latest !== null && isNewerVersion(latest, current)
});

/**
 * Resolve the update status, refreshing from the registry when the cache is
 * stale (or forced). Total and fail-silent: an opted-out check, an offline
 * fetch, or a corrupt cache all yield a `latest: null` "unknown" status rather
 * than throwing. On a failed refresh it falls back to the last cached `latest`
 * so a transient outage doesn't erase a known-available update.
 */
export const checkForUpdateUseCase =
  (deps: UpdateCheckDeps) =>
  async (input: CheckForUpdateInput): Promise<VersionStatus> => {
    if (deps.disabled) return statusFrom(input.current, null);
    const ttl = deps.ttlMs ?? DEFAULT_TTL_MS;
    const cached = deps.cache.read();
    const fresh = cached !== null && deps.now() - cached.checkedAt < ttl;

    if (!input.forceRefresh && fresh) {
      return statusFrom(input.current, cached.latest);
    }

    const fetched = await deps.registry.fetchLatest(input.packageName);
    if (fetched !== null) {
      deps.cache.write({ latest: fetched, checkedAt: deps.now() });
      return statusFrom(input.current, fetched);
    }
    // Refresh failed: fall back to the last known latest (may be null).
    return statusFrom(input.current, cached?.latest ?? null);
  };

/**
 * A synchronous, cache-only read for the hot path (a CLI that exits fast).
 * Never touches the network, so it can decide whether to print a notice with
 * zero added latency; a background `checkForUpdate` keeps the cache warm for
 * next time. Returns an "unknown" status when opted out or the cache is empty.
 */
export const cachedUpdateStatus = (
  deps: { readonly cache: VersionCache; readonly disabled?: boolean },
  input: { readonly current: string }
): VersionStatus => {
  if (deps.disabled) return statusFrom(input.current, null);
  const cached = deps.cache.read();
  return statusFrom(input.current, cached?.latest ?? null);
};
