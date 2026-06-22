import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { buildSearchDocs } from '$features/global-search/domain/buildSearchDocs';
import type {
  SearchDoc,
  SearchDomainInput,
  SearchProjectInput
} from '$features/global-search/domain/SearchDoc';
import { JsonFolderFeatureRepository } from '$features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { JsonFolderProjectRepository } from '$features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { JsonFolderDomainRepository } from '$features/domains/infrastructure/persistence/JsonFolderDomainRepository';
import {
  DOMAIN_SUFFIX,
  FEATURE_SUFFIX,
  PROJECT_SUFFIX,
  walkBySuffix
} from '$shared/infrastructure/persistence/snapshotLayout';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

/**
 * The header global search used to build its index in the BROWSER on every
 * open: a `list()` plus a `get()` per feature and per project, each an HTTP
 * round-trip, and each `get()` re-parsing the whole snapshot folder on the
 * server (O(N²)). On a large hub that made the panel "way too long to index".
 *
 * This module moves the build server-side and serves it as one precomputed
 * file. The index is kept fresh automatically by a cheap content STAMP rather
 * than any write-path hook: every read compares the current stamp (file count +
 * newest mtime, stat-only, no parse) against the cached/persisted one and only
 * rebuilds when something on disk actually changed. The pure
 * {@link buildSearchDocs} walker stays the single source of truth for "what is
 * searchable" and is reused verbatim.
 */

/** Dot-file so `walkBySuffix` (which only descends real subfolders) never
 *  mistakes it for a snapshot, and `unspa/*` gitignore already covers it. */
const INDEX_FILENAME = '.search-index.json';

type IndexFile = {
  readonly version: string;
  readonly generatedAt: string;
  readonly docs: readonly SearchDoc[];
};

// Process-local memo so repeated opens within a session skip even the file
// read. Keyed by root so a test pointing at a temp dir can't read the app's.
let memo: { root: string; stamp: string; docs: readonly SearchDoc[] } | null = null;

/**
 * Cheap freshness key over the whole model: how many snapshot files there are
 * plus the newest mtime among them. Stat-only — never parses JSON — so it costs
 * a fraction of a full rebuild. Any save/delete/MCP write bumps a count or an
 * mtime, which is exactly when the index must rebuild.
 */
const computeModelStamp = (root: string): string => {
  let count = 0;
  let newest = 0;
  const account = (path: string): void => {
    try {
      const st = statSync(path);
      count += 1;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      // File vanished between listing and stat — ignore; next read self-heals.
    }
  };
  for (const { path } of walkBySuffix(root, FEATURE_SUFFIX)) account(path);
  for (const { path } of walkBySuffix(root, PROJECT_SUFFIX)) account(path);
  // Domains stay flat at the root (they cross-cut projects).
  if (existsSync(root)) {
    for (const file of readdirSync(root)) {
      if (file.endsWith(DOMAIN_SUFFIX)) account(join(root, file));
    }
  }
  return `${count}:${newest}`;
};

/** Read every entity once (no O(N²)) and flatten via the shared walker. */
const buildIndexAt = async (root: string): Promise<readonly SearchDoc[]> => {
  const featureRepo = new JsonFolderFeatureRepository(root);
  const projectRepo = new JsonFolderProjectRepository(root);
  const domainRepo = new JsonFolderDomainRepository(root);

  const [features, projects, domains] = await Promise.all([
    featureRepo.listFull(),
    projectRepo.listFull(),
    domainRepo.listFull()
  ]);

  const projectInputs: SearchProjectInput[] = projects.map((project) => ({
    id: String(project.id),
    name: project.name,
    description: project.description,
    tags: project.tags,
    featureIds: project.featureIds.map(String)
  }));

  const domainInputs: SearchDomainInput[] = domains.map((domain) => ({
    id: String(domain.id),
    name: domain.name,
    description: domain.description
  }));

  return buildSearchDocs({ projects: projectInputs, features, domains: domainInputs });
};

const readPersisted = (filePath: string): IndexFile | null => {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<IndexFile>;
    if (typeof parsed?.version === 'string' && Array.isArray(parsed.docs)) {
      return parsed as IndexFile;
    }
    return null;
  } catch {
    // Corrupt/partial file — treat as absent; the rebuild overwrites it.
    return null;
  }
};

const persist = async (
  filePath: string,
  version: string,
  docs: readonly SearchDoc[]
): Promise<void> => {
  const payload: IndexFile = { version, generatedAt: new Date().toISOString(), docs };
  try {
    await writeFileAtomic(filePath, JSON.stringify(payload), 'utf8');
  } catch {
    // Persisting is an optimization (warm start across restarts). A read-only
    // snapshot dir just means we rebuild in-memory each cold start — fine.
  }
};

/**
 * Resolve the search index for a specific snapshot directory. Returns the
 * cached/persisted docs when the stamp is unchanged, otherwise rebuilds,
 * persists, and memoizes. Exported for tests; the app uses {@link getSearchIndex}.
 */
export const getSearchIndexFor = async (root: string): Promise<readonly SearchDoc[]> => {
  const stamp = computeModelStamp(root);

  if (memo && memo.root === root && memo.stamp === stamp) return memo.docs;

  const filePath = join(root, INDEX_FILENAME);
  const persisted = readPersisted(filePath);
  if (persisted && persisted.version === stamp) {
    memo = { root, stamp, docs: persisted.docs };
    return persisted.docs;
  }

  const docs = await buildIndexAt(root);
  memo = { root, stamp, docs };
  await persist(filePath, stamp, docs);
  return docs;
};

/** The whole-model search index for the dashboard's resolved snapshot folder. */
export const getSearchIndex = (): Promise<readonly SearchDoc[]> =>
  getSearchIndexFor(getSnapshotRepository().directory);
