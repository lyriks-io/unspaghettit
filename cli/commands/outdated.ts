import { createRequire } from 'node:module';
import {
  formatUpdateNotice,
  PACKAGE_NAME,
  resolveUpdateStatus
} from '../../src/features/update-check/infrastructure/updateCheck';
import { log } from '../util/log';

// Same single source of truth for the running version as the CLI entry.
const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

/**
 * Explicit "is a newer version out?" check. Hits the registry live
 * (forceRefresh) and, being a direct request, ignores the passive opt-out so it
 * always answers. `--json` prints the raw status for scripts. Never fails the
 * process on a network error: an unreachable registry is reported, not thrown.
 */
export const runOutdatedCommand = async (
  args: { readonly json?: boolean } = {}
): Promise<number> => {
  const status = await resolveUpdateStatus({
    current: pkg.version,
    forceRefresh: true,
    ignoreDisabled: true
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return 0;
  }

  if (status.latest === null) {
    log.warn(
      `Could not reach the npm registry to check for updates. Installed ${PACKAGE_NAME} ${status.current}.`
    );
    return 0;
  }
  if (status.updateAvailable) {
    log.warn(formatUpdateNotice(status) ?? '');
    return 0;
  }
  log.ok(`${PACKAGE_NAME} is up to date (${status.current}).`);
  return 0;
};
