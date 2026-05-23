import { JsonFolderFeatureRepository } from '$features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { discoverSnapshotDirectory } from '$features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/JsonFolderImplementationStatusRepository';
import { JsonFolderProjectRepository } from '$features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { JsonFolderDomainRepository } from '$features/domains/infrastructure/persistence/JsonFolderDomainRepository';
import { migrateFlatLayoutAndLog } from '$shared/infrastructure/persistence/snapshotLayout';

let cached: {
  repo: JsonFolderFeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  directory: string;
} | null = null;

export const getSnapshotRepository = (): {
  repo: JsonFolderFeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  directory: string;
} => {
  if (cached) return cached;
  const override = process.env.UNSPA_SNAPSHOTS;
  const { directory } = discoverSnapshotDirectory({ override });
  migrateFlatLayoutAndLog(directory, 'unspa-sveltekit');
  const repo = new JsonFolderFeatureRepository(directory);
  const statusRepo = new JsonFolderImplementationStatusRepository(directory);
  const projectRepo = new JsonFolderProjectRepository(directory);
  const domainRepo = new JsonFolderDomainRepository(directory);
  cached = { repo, statusRepo, projectRepo, domainRepo, directory };
  return cached;
};
