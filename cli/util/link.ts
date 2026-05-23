import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from './json';

/**
 * On-disk shape of `.unspa.json`. Binds a repo (or any sub-tree containing
 * it) to a single project by id. Committed to source control so the whole
 * team's `unspa` runs scope it the same way.
 *
 * Bound at project granularity, not feature: a repo is one codebase, which
 * holds one or more features. The LLM picks which feature to operate on
 * from the project's member list based on context (file paths, action name,
 * the user prompt).
 */
export type RepoLink = {
  /** Stable project id from the unspa/ folder. */
  readonly projectId: string;
  /** Human-readable name copied at link time. For grep-ability only; the id wins. */
  readonly projectName?: string;
};

const LINK_FILENAME = '.unspa.json';

export const linkPath = (cwd: string): string => join(cwd, LINK_FILENAME);

export const readRepoLink = (cwd: string): RepoLink | null => {
  return readJson<RepoLink>(linkPath(cwd));
};

export const writeRepoLink = async (cwd: string, link: RepoLink): Promise<void> => {
  await writeJson(linkPath(cwd), link);
};

export const removeRepoLink = (cwd: string): { changed: boolean } => {
  const path = linkPath(cwd);
  if (!existsSync(path)) return { changed: false };
  unlinkSync(path);
  return { changed: true };
};
