import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  cachedUpdateStatus,
  checkForUpdateUseCase
} from '../application/CheckForUpdate';
import type { VersionStatus } from '../domain/VersionStatus';
import { fileVersionCache } from './FileVersionCache';
import { npmRegistryVersionSource } from './NpmRegistryVersionSource';

/**
 * Composition root for the update check. Wires the npm-registry source and the
 * file cache with sane defaults so the three surfaces (CLI, dashboard, MCP)
 * each call one function instead of assembling ports themselves. Keeps the
 * "where does the cache live / when is it off / how do we phrase it" policy in
 * one place.
 */

/** The published package this repo ships as. */
export const PACKAGE_NAME = 'unspaghettit';

// The shared-hub root segment (`~/.unspa-hub`). Kept as a local literal rather
// than imported from the behavior-model snapshot layer so the update check has
// no cross-feature dependency; the value is a stable well-known path.
const HUB_ROOT_SEGMENT = '.unspa-hub';

/**
 * The cache lives next to the shared hub (`~/.unspa-hub/.update-check.json`),
 * per user rather than per project — a newer release is the same fact wherever
 * you run from, so one global cache avoids re-checking once per repo.
 */
export const updateCacheFilePath = (home: string = homedir()): string =>
  join(home, HUB_ROOT_SEGMENT, '.update-check.json');

const isTruthy = (value: string | undefined): boolean =>
  value !== undefined &&
  value !== '' &&
  value !== '0' &&
  value.toLowerCase() !== 'false';

/**
 * The update check is off when the user opted out (`UNSPA_NO_UPDATE_CHECK`, or
 * the community-standard `NO_UPDATE_NOTIFIER`) or when running under CI, where a
 * "new version" notice is just noise in the logs.
 */
export const isUpdateCheckDisabled = (
  env: NodeJS.ProcessEnv = process.env
): boolean =>
  isTruthy(env.UNSPA_NO_UPDATE_CHECK) ||
  isTruthy(env.NO_UPDATE_NOTIFIER) ||
  isTruthy(env.CI);

type ResolveOpts = {
  readonly current: string;
  readonly forceRefresh?: boolean;
  /**
   * Run even when the env opt-out is set. The opt-out silences the PASSIVE
   * surfaces; an explicit `unspa outdated` is a direct request and should still
   * answer, so it passes this.
   */
  readonly ignoreDisabled?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly timeoutMs?: number;
};

/**
 * Resolve the status, refreshing from the registry when the cache is stale.
 * Async; use for the explicit `unspa outdated` command and the long-lived
 * surfaces (dashboard load, MCP get_repo_context) that can afford one network
 * round-trip and benefit from keeping the cache warm.
 */
export const resolveUpdateStatus = (opts: ResolveOpts): Promise<VersionStatus> => {
  const env = opts.env ?? process.env;
  const check = checkForUpdateUseCase({
    registry: npmRegistryVersionSource({ timeoutMs: opts.timeoutMs }),
    cache: fileVersionCache(updateCacheFilePath(opts.home)),
    now: () => Date.now(),
    disabled: opts.ignoreDisabled ? false : isUpdateCheckDisabled(env)
  });
  return check({ current: opts.current, packageName: PACKAGE_NAME, forceRefresh: opts.forceRefresh });
};

/**
 * Synchronous, cache-only status for a fast-exiting CLI: reads what a prior
 * refresh left behind with zero network latency. Pair with a fire-and-forget
 * `resolveUpdateStatus` to warm the cache for next time.
 */
export const readCachedUpdateStatus = (opts: {
  readonly current: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
}): VersionStatus => {
  const env = opts.env ?? process.env;
  return cachedUpdateStatus(
    {
      cache: fileVersionCache(updateCacheFilePath(opts.home)),
      disabled: isUpdateCheckDisabled(env)
    },
    { current: opts.current }
  );
};

/**
 * One-line human notice for a CLI, or null when there's nothing to say (up to
 * date, or status unknown). Kept here so the CLI and any other text surface
 * phrase it identically.
 */
export const formatUpdateNotice = (status: VersionStatus): string | null => {
  if (!status.updateAvailable || status.latest === null) return null;
  return (
    `Update available: ${status.current} → ${status.latest}. ` +
    `Run \`npm i -g ${PACKAGE_NAME}@latest\` to upgrade.`
  );
};
