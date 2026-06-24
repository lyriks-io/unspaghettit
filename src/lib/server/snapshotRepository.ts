import { JsonFolderFeatureRepository } from '$features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { discoverSnapshotDirectory } from '$features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/JsonFolderImplementationStatusRepository';
import { JsonFolderProvenanceRepository } from '$features/source-provenance/infrastructure/persistence/JsonFolderProvenanceRepository';
import { JsonFolderProjectRepository } from '$features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { JsonFolderDomainRepository } from '$features/domains/infrastructure/persistence/JsonFolderDomainRepository';
import { JsonFileTagPaletteRepository } from '$features/tag-palette/infrastructure/persistence/JsonFileTagPaletteRepository';
import { migrateFlatLayoutAndLog } from '$shared/infrastructure/persistence/snapshotLayout';

let cached: {
  repo: JsonFolderFeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  provenanceRepo: JsonFolderProvenanceRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  tagPaletteRepo: JsonFileTagPaletteRepository;
  directory: string;
} | null = null;

export const getSnapshotRepository = (): {
  repo: JsonFolderFeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  provenanceRepo: JsonFolderProvenanceRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  tagPaletteRepo: JsonFileTagPaletteRepository;
  directory: string;
} => {
  if (cached) return cached;
  const override = process.env.UNSPA_SNAPSHOTS;
  const { directory } = discoverSnapshotDirectory({ override });
  migrateFlatLayoutAndLog(directory, 'unspa-sveltekit');
  const repo = new JsonFolderFeatureRepository(directory);
  const statusRepo = new JsonFolderImplementationStatusRepository(directory);
  const provenanceRepo = new JsonFolderProvenanceRepository(directory);
  const projectRepo = new JsonFolderProjectRepository(directory);
  const domainRepo = new JsonFolderDomainRepository(directory);
  const tagPaletteRepo = new JsonFileTagPaletteRepository(directory);
  cached = { repo, statusRepo, provenanceRepo, projectRepo, domainRepo, tagPaletteRepo, directory };
  return cached;
};
