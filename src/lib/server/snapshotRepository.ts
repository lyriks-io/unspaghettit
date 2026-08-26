import { JsonFolderFeatureRepository } from '$features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { discoverSnapshotDirectory } from '$features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/JsonFolderImplementationStatusRepository';
import { JsonFolderProvenanceRepository } from '$features/source-provenance/infrastructure/persistence/JsonFolderProvenanceRepository';
import { JsonFolderProjectSourceRepository } from '$features/source-provenance/infrastructure/persistence/JsonFolderProjectSourceRepository';
import { migrateEmbeddedSourceDocsAndLog } from '$features/source-provenance/infrastructure/persistence/migrateEmbeddedSourceDocs';
import { JsonFolderProjectRepository } from '$features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { JsonFolderDomainRepository } from '$features/domains/infrastructure/persistence/JsonFolderDomainRepository';
import { JsonFileTagPaletteRepository } from '$features/tag-palette/infrastructure/persistence/JsonFileTagPaletteRepository';
import { withProjectLibrary } from '$features/projects/infrastructure/persistence/ProjectScopedFeatureRepository';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import {
  fileNamingFromEnv,
  migrateFlatLayoutAndLog
} from '$shared/infrastructure/persistence/snapshotLayout';

let cached: {
  repo: JsonFolderFeatureRepository;
  featureRepo: FeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  provenanceRepo: JsonFolderProvenanceRepository;
  sourceRepo: JsonFolderProjectSourceRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  tagPaletteRepo: JsonFileTagPaletteRepository;
  directory: string;
} | null = null;

/**
 * `repo` is the raw on-disk feature store; `featureRepo` is the same store seen
 * THROUGH the owning project's canonical library, so a feature that references
 * project-scoped entities/resources/personas arrives with them resolved (and
 * saves strip them back to refs). Behavior reads and writes should use
 * `featureRepo`; the raw `repo` is for import/export paths that deliberately
 * want the stored shape byte-for-byte.
 */
export const getSnapshotRepository = (): {
  repo: JsonFolderFeatureRepository;
  featureRepo: FeatureRepository;
  statusRepo: JsonFolderImplementationStatusRepository;
  provenanceRepo: JsonFolderProvenanceRepository;
  sourceRepo: JsonFolderProjectSourceRepository;
  projectRepo: JsonFolderProjectRepository;
  domainRepo: JsonFolderDomainRepository;
  tagPaletteRepo: JsonFileTagPaletteRepository;
  directory: string;
} => {
  if (cached) return cached;
  const override = process.env.UNSPA_SNAPSHOTS;
  const { directory } = discoverSnapshotDirectory({ override });
  migrateFlatLayoutAndLog(directory, 'unspa-sveltekit');
  migrateEmbeddedSourceDocsAndLog(directory, 'unspa-sveltekit');
  // Same naming rule as the MCP server, so both write the same file names.
  const fileNaming = fileNamingFromEnv(process.env);
  const repo = new JsonFolderFeatureRepository(directory, { fileNaming });
  const statusRepo = new JsonFolderImplementationStatusRepository(directory);
  const provenanceRepo = new JsonFolderProvenanceRepository(directory);
  const sourceRepo = new JsonFolderProjectSourceRepository(directory);
  const projectRepo = new JsonFolderProjectRepository(directory, { fileNaming });
  const domainRepo = new JsonFolderDomainRepository(directory);
  const tagPaletteRepo = new JsonFileTagPaletteRepository(directory);
  cached = {
    repo,
    featureRepo: withProjectLibrary(repo, projectRepo),
    statusRepo,
    provenanceRepo,
    sourceRepo,
    projectRepo,
    domainRepo,
    tagPaletteRepo,
    directory
  };
  return cached;
};
