import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { isOptionalViewId, optionalViews } from '../../src/lib/views/registry';
import { readEnabledViews, writeEnabledViews } from '../util/views';
import { log } from '../util/log';

export type ViewCommandOptions = {
  readonly action: 'list' | 'add' | 'remove';
  readonly id?: string;
  readonly cwd?: string;
  readonly snapshots?: string;
};

const known = (): string => optionalViews().map((v) => v.id).join(', ') || '(none)';

/**
 * Manage which opt-in dashboard views are enabled. Expert is the always-on
 * default and never listed here. Enablement persists in `<snapshots>/views.json`
 * so it survives across `unspa dashboard` runs.
 */
export const runViewCommand = async (options: ViewCommandOptions): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const { directory, source } = discoverSnapshotDirectory({ cwd, override: options.snapshots });
  const enabled = readEnabledViews(directory);

  if (options.action === 'list') {
    log.step(`Views for ${pc.cyan(directory)} (${source})`);
    log.dim('Expert is always on (the default view).');
    const optional = optionalViews();
    if (optional.length === 0) {
      log.dim('No opt-in views are available in this build.');
      return 0;
    }
    for (const view of optional) {
      const on = enabled.includes(view.id);
      const marker = on ? pc.green('● on ') : pc.dim('○ off');
      process.stdout.write(`${marker}  ${pc.cyan(view.label)} ${pc.dim(`(${view.id})`)}\n`);
    }
    log.blank();
    log.dim('Enable with `unspa view add <id>`, disable with `unspa view remove <id>`.');
    return 0;
  }

  const id = (options.id ?? '').trim().toLowerCase();
  if (!id) {
    log.err(`Missing view id. Known views: ${known()}.`);
    return 1;
  }
  if (!isOptionalViewId(id)) {
    log.err(`Unknown view "${id}". Known opt-in views: ${known()}. (Expert is always on.)`);
    return 1;
  }

  if (options.action === 'add') {
    if (enabled.includes(id)) {
      log.dim(`${id} is already enabled.`);
      return 0;
    }
    writeEnabledViews(directory, [...enabled, id]);
    log.ok(`Enabled ${pc.cyan(id)}. It'll show in the dashboard's view switcher.`);
    log.dim('Restart `unspa dashboard` to pick it up.');
    return 0;
  }

  // remove
  if (!enabled.includes(id)) {
    log.dim(`${id} is not enabled.`);
    return 0;
  }
  writeEnabledViews(
    directory,
    enabled.filter((v) => v !== id)
  );
  log.ok(`Removed ${pc.cyan(id)}.`);
  log.dim('Restart `unspa dashboard` to apply.');
  return 0;
};
