import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { ALL_THEMES, isThemeId, parseThemeId } from '../../src/lib/theme/registry';
import { readSelectedTheme, writeSelectedTheme } from '../util/theme';
import { log } from '../util/log';

export type ThemeCommandOptions = {
  readonly action: 'list' | 'set' | 'reset';
  readonly id?: string;
  readonly cwd?: string;
  readonly snapshots?: string;
};

const known = (): string => ALL_THEMES.map((t) => t.id).join(', ');

/**
 * Pick the dashboard's colour theme. Purely cosmetic: it only changes which
 * skin the design system renders with, never a feature. The selection persists
 * in `<snapshots>/theme.json` so `unspa dashboard` boots with it; the in-app
 * header switcher can flip it live in the browser without touching this file.
 */
export const runThemeCommand = async (options: ThemeCommandOptions): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const { directory, source } = discoverSnapshotDirectory({ cwd, override: options.snapshots });
  const active = parseThemeId(readSelectedTheme(directory));

  if (options.action === 'list') {
    log.step(`Themes for ${pc.cyan(directory)} (${source})`);
    log.dim(`Active default: ${pc.cyan(active)}`);
    for (const theme of ALL_THEMES) {
      const on = active === theme.id;
      const marker = on ? pc.green('● active') : pc.dim('○      ');
      process.stdout.write(`${marker}  ${pc.cyan(theme.label)} ${pc.dim(`(${theme.id})`)} — ${theme.description}\n`);
    }
    log.blank();
    log.dim('Set with `unspa theme set <id>`, revert with `unspa theme reset`.');
    log.dim('Or flip it live from the dashboard header (the palette button).');
    return 0;
  }

  if (options.action === 'reset') {
    writeSelectedTheme(directory, 'default');
    log.ok('Theme reset to default.');
    log.dim('Restart `unspa dashboard` to apply (or use the in-app switcher).');
    return 0;
  }

  // set
  const id = (options.id ?? '').trim().toLowerCase();
  if (!id) {
    log.err(`Missing theme id. Known themes: ${known()}.`);
    return 1;
  }
  if (!isThemeId(id)) {
    log.err(`Unknown theme "${id}". Known themes: ${known()}.`);
    return 1;
  }
  const next = writeSelectedTheme(directory, id);
  log.ok(`Theme set to ${pc.cyan(next)}.`);
  log.dim('Restart `unspa dashboard` to apply, or switch live via the dashboard header.');
  return 0;
};
