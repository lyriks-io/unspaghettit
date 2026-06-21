import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import type { ProjectRepository } from '../ports/ProjectRepository';

export interface ImportProjectBundleResult {
  readonly projectId: string;
  readonly featuresImported: number;
  readonly statusesImported: number;
}

/**
 * Restore a ProjectBundleV1 onto the snapshot repositories. The write ORDER is
 * the invariant this use case owns:
 *   1. every Feature first, so the project save's add-feature guard can resolve
 *      them;
 *   2. then the Project itself, preserving its id, featureIds[] ordering, queue,
 *      and metadata;
 *   3. lastly the implementation-status sidecars (idempotent if absent).
 *
 * Pass sync-aware repositories to broadcast the writes to open editors. Conflict
 * policy (v1): bundle ids are preserved and overwrite any existing rows — the
 * "restore my own backup" flow. Previously this orchestration lived inline in
 * the import route handler.
 */
export const importProjectBundleUseCase = (deps: {
  features: FeatureRepository;
  projects: ProjectRepository;
  statuses: ImplementationStatusRepository;
}) => {
  return async (bundle: ProjectBundleV1): Promise<ImportProjectBundleResult> => {
    for (const feature of bundle.features) {
      await deps.features.save(feature);
    }
    await deps.projects.save(bundle.project);
    for (const status of bundle.statuses) {
      await deps.statuses.save(status);
    }
    return {
      projectId: bundle.project.id,
      featuresImported: bundle.features.length,
      statusesImported: bundle.statuses.length
    };
  };
};
