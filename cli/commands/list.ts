import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { JsonFolderProjectRepository } from '../../src/features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { ask } from '../util/ask';
import { readRepoLink, writeRepoLink, type RepoLink } from '../util/link';
import { log } from '../util/log';

export type ListOptions = {
  readonly cwd?: string;
  /** Print as JSON instead of the human table. Useful for scripting. */
  readonly json?: boolean;
  /** When set, just print and exit. No interactive picker. Implied by --json. */
  readonly noInteractive?: boolean;
};

const relTime = (iso: string): string => {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
};

export const runListCommand = async (options: ListOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const { directory, source } = discoverSnapshotDirectory({ cwd });

  if (!existsSync(directory)) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ directory, projects: [] }, null, 2)}\n`);
      return 0;
    }
    log.warn(`No unspa/ folder found at or above ${cwd}.`);
    log.dim('Run `unspa init` first.');
    return 1;
  }

  const repo = new JsonFolderProjectRepository(directory);
  const summaries = await repo.list();
  const link = readRepoLink(cwd);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          directory,
          source,
          linkedProjectId: link?.projectId ?? null,
          projects: summaries.map((s) => ({
            id: String(s.id),
            name: s.name,
            description: s.description,
            featureCount: s.featureCount,
            updatedAt: s.updatedAt,
            linked: link?.projectId === String(s.id)
          }))
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  log.step(`Projects in ${pc.cyan(directory)} (${source})`);
  if (summaries.length === 0) {
    log.dim('No projects yet. Create one through your AI client (MCP) or the dashboard.');
    return 0;
  }

  // Pad columns so the eye scans cleanly. Ids are intentionally hidden from
  // the human view (UUIDs aren't legible). `--json` and `unspa link`'s
  // picker are how callers get to ids.
  const nameWidth = Math.min(40, Math.max(...summaries.map((s) => s.name.length)));

  for (const s of summaries) {
    const isLinked = link?.projectId === String(s.id);
    const marker = isLinked ? pc.green('★') : ' ';
    const name = s.name.length > nameWidth ? `${s.name.slice(0, nameWidth - 1)}…` : s.name.padEnd(nameWidth);
    const counts = pc.dim(`${s.featureCount} feature${s.featureCount === 1 ? '' : 's'}`);
    const updated = pc.dim(relTime(s.updatedAt).padStart(8));
    process.stdout.write(`${marker} ${pc.cyan(name)}  ${counts.padEnd(20)}  ${updated}\n`);
  }

  if (link) {
    log.blank();
    log.dim(`★ this repo is linked to ${link.projectName ?? '(unknown name)'}`);
  }

  // Interactive picker. Bind this repo to one of the listed projects.
  // Skipped in --json mode, when --no-interactive is set, or when stdin
  // isn't a TTY (CI / piped invocations). The first row is "Skip" so an
  // accidental Enter is a no-op rather than a silent re-link.
  if (options.noInteractive || !process.stdin.isTTY) return 0;

  log.blank();
  const SKIP = '__skip__';
  const choices = [
    { title: pc.dim('- Skip -'), value: SKIP, description: 'Just view; leave the link unchanged' },
    ...summaries.map((s) => ({
      title: s.name,
      value: String(s.id),
      description: `${s.featureCount} feature${s.featureCount === 1 ? '' : 's'}`
    }))
  ];
  const initialIdx = link
    ? Math.max(
        0,
        summaries.findIndex((s) => String(s.id) === link.projectId) + 1
      )
    : 0;
  const answer = await ask({
    type: 'select',
    name: 'id',
    message: 'Link this repo to one of these?',
    hint: '↑/↓ to pick, Enter to confirm',
    choices,
    initial: initialIdx
  });
  if (!answer.id || answer.id === SKIP) return 0;

  const chosen = summaries.find((s) => String(s.id) === answer.id);
  if (!chosen) return 0;
  const next: RepoLink = { projectId: String(chosen.id), projectName: chosen.name };
  await writeRepoLink(cwd, next);
  log.ok(`Linked this repo to ${pc.cyan(chosen.name)}`);
  return 0;
};
