import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';

export type SnapshotDirectorySource = 'override' | 'walk' | 'cwd-fallback';

export type SnapshotDirectory = {
  readonly directory: string;
  readonly source: SnapshotDirectorySource;
};

export type DiscoverOptions = {
  readonly override?: string;
  readonly cwd?: string;
};

const SNAPSHOT_SUFFIXES = ['.feature.json', '.project.json'];
const FOLDER_NAME = 'unspa';

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

  return { directory: resolve(cwd, FOLDER_NAME), source: 'cwd-fallback' };
};
