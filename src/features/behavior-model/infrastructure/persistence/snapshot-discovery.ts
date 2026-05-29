import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';

export type SnapshotDirectorySource = 'override' | 'walk' | 'hub-default';

export type SnapshotDirectory = {
  readonly directory: string;
  readonly source: SnapshotDirectorySource;
};

export type DiscoverOptions = {
  readonly override?: string;
  readonly cwd?: string;
  /** Home directory used to resolve the shared hub. Defaults to os.homedir(). */
  readonly home?: string;
};

const SNAPSHOT_SUFFIXES = ['.feature.json', '.project.json'];
const FOLDER_NAME = 'unspa';

/**
 * Shared snapshot hub layout: `<home>/.unspa-hub/unspa`. The `.unspa-hub`
 * parent is the well-known launch point for `unspa dashboard`; the `unspa`
 * subfolder is the snapshot directory itself. This is the default home for
 * every project's behavior model — `unspa init` no longer scaffolds a per-repo
 * `unspa/` folder, so when neither an explicit override nor a walk-up hit is
 * found, both the dashboard and the MCP server land here on the first run. The
 * folder is created lazily on first write (`ensureProjectDir` does `mkdir -p`).
 *
 * `homedir()` + `path.join` keep this correct on Windows, macOS, and Linux.
 */
export const HUB_ROOT_SEGMENT = '.unspa-hub';
export const HUB_SNAPSHOTS_SEGMENT = FOLDER_NAME;

export const defaultHubDirectory = (home: string = homedir()): string =>
  join(home, HUB_ROOT_SEGMENT, HUB_SNAPSHOTS_SEGMENT);

const containsSnapshot = (dir: string): boolean => {
  if (!existsSync(dir)) return false;
  if (!statSync(dir).isDirectory()) return false;
  return readdirSync(dir).some((entry) =>
    SNAPSHOT_SUFFIXES.some((suffix) => entry.endsWith(suffix))
  );
};

export const discoverSnapshotDirectory = (
  opts: DiscoverOptions = {}
): SnapshotDirectory => {
  const cwd = opts.cwd ?? process.cwd();

  if (opts.override !== undefined) {
    const directory = isAbsolute(opts.override) ? opts.override : resolve(cwd, opts.override);
    return { directory, source: 'override' };
  }

  let current = resolve(cwd);
  const { root } = parse(current);
  while (true) {
    const candidate = resolve(current, FOLDER_NAME);
    if (containsSnapshot(candidate)) {
      return { directory: candidate, source: 'walk' };
    }
    if (current === root) break;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  // Nothing checked into this tree: fall back to the shared hub rather than an
  // empty `<cwd>/unspa`. This is what makes hub mode the zero-config default —
  // the MCP entry needs no UNSPA_SNAPSHOTS and `unspa dashboard` finds the same
  // folder no matter where it's launched from. A per-repo `unspa/` (custom
  // install) still wins above via the walk-up.
  return { directory: defaultHubDirectory(opts.home), source: 'hub-default' };
};
