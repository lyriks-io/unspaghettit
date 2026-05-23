import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import pc from 'picocolors';
import { JsonFolderProjectRepository } from '../../src/features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { ask } from '../util/ask';
import { log } from '../util/log';
import { linkPath, readRepoLink, removeRepoLink, writeRepoLink, type RepoLink } from '../util/link';

export type LinkOptions = {
  readonly cwd?: string;
  /** Direct id to link, skipping the picker. */
  readonly projectId?: string;
  /** When set, drop the existing link instead of writing a new one. */
  readonly unlink?: boolean;
  /** Non-interactive. Fail rather than prompt when ambiguous. */
  readonly yes?: boolean;
};

export const runLinkCommand = async (options: LinkOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();

  if (options.unlink) {
    const { changed } = removeRepoLink(cwd);
    if (changed) log.ok(`Removed ${relative(cwd, linkPath(cwd))}`);
    else log.dim('No repo link to remove.');
    return 0;
  }

  const { directory } = discoverSnapshotDirectory({ cwd });
  if (!existsSync(directory)) {
    log.err(`No unspa/ folder found at or above ${cwd}.`);
    log.dim('Run `unspa init` first.');
    return 1;
  }

  const repo = new JsonFolderProjectRepository(directory);
  const summaries = await repo.list();
  if (summaries.length === 0) {
    log.warn(`No projects exist in ${directory}.`);
    log.dim('Create one through your AI client first, then re-run `unspa link`.');
    return 1;
  }

  let chosen = summaries.find((s) => String(s.id) === options.projectId) ?? null;

  if (!chosen) {
    // Non-interactive shells (CI, scripts, piped stdin) must not block on a
    // `prompts` select. Treat them the same as --yes so the command either
    // auto-picks the single project or fails fast with a clear message
    // instead of hanging the runner.
    const nonInteractive = options.yes || !process.stdin.isTTY;
    if (nonInteractive) {
      if (summaries.length === 1) chosen = summaries[0]!;
      else {
        log.err(
          `Multiple projects exist (${summaries.length}); pass --project-id <id> in non-interactive mode.`
        );
        return 1;
      }
    } else {
      const current = readRepoLink(cwd);
      const SKIP = '__skip__';
      // One single prompt with a "skip" sentinel at the top. Avoids the
      // chained-prompt stdin-bleed where an Enter from a previous confirm
      // would auto-select the highlighted item.
      const choices = [
        { title: pc.dim('- Skip / cancel -'), value: SKIP, description: 'Leave the link unchanged' },
        ...summaries.map((s) => ({
          title: s.name,
          value: String(s.id),
          description: `${s.featureCount} feature${s.featureCount === 1 ? '' : 's'}`
        }))
      ];
      // Default to the SKIP row (index 0) when there's no existing link, so
      // an Enter accidentally bled in from a previous prompt becomes a no-op
      // instead of silently linking to the first project. When there's
      // an existing link, default to it so re-running `unspa link` and
      // hitting Enter is idempotent.
      const initialIdx = current
        ? Math.max(
            0,
            summaries.findIndex((s) => String(s.id) === current.projectId) + 1
          )
        : 0;
      const answer = await ask({
        type: 'select',
        name: 'id',
        message: 'Link this repo to which project?',
        hint: current
          ? `currently linked to ${current.projectName ?? '(unknown name)'}. ↑/↓ then Enter`
          : '↑/↓ to pick, Enter to confirm',
        choices,
        initial: initialIdx
      });
      if (!answer.id || answer.id === SKIP) {
        log.dim('Skipped. Link unchanged.');
        return 0;
      }
      chosen = summaries.find((s) => String(s.id) === answer.id) ?? null;
    }
  }

  if (!chosen) {
    log.err('No project selected.');
    return 1;
  }

  const link: RepoLink = {
    projectId: String(chosen.id),
    projectName: chosen.name
  };
  await writeRepoLink(cwd, link);
  log.ok(`Linked this repo to ${pc.cyan(chosen.name)}`);
  log.dim(`Wrote ${relative(cwd, linkPath(cwd))}`);
  return 0;
};
