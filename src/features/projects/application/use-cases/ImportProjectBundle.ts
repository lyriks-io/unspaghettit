import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import { isSafeSegment } from '$shared/infrastructure/persistence/snapshotLayout';
import type { ProjectRepository } from '../ports/ProjectRepository';

export interface ImportProjectBundleResult {
  readonly projectId: string;
  readonly featuresImported: number;
  readonly statusesImported: number;
}

/**
 * A bundle carried an id that is not a path-safe identifier. Every id in a
 * legitimate bundle is 8-char hex or a v4 UUID; a `../`-laden id can only come
 * from a hand-crafted (malicious) `.unspa` file trying to make a sidecar write
 * escape the snapshot tree. Rejected up front so nothing is persisted — the
 * write path also guards each filename as defence-in-depth.
 */
export class BundleValidationError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid project bundle: ${reason}`);
    this.name = 'BundleValidationError';
  }
}

const assertBundleIdsSafe = (bundle: ProjectBundleV1): void => {
  if (!isSafeSegment(bundle.project.id)) {
    throw new BundleValidationError(`project id "${bundle.project.id}" is not a valid id`);
  }
  for (const feature of bundle.features) {
    if (!isSafeSegment(feature.id)) {
      throw new BundleValidationError(`feature id "${feature.id}" is not a valid id`);
    }
  }
  for (const status of bundle.statuses) {
    if (!isSafeSegment(String(status.featureId))) {
      throw new BundleValidationError(
        `status featureId "${status.featureId}" is not a valid id`
      );
    }
  }
};

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
    // Fail closed BEFORE the first write: features are persisted ahead of the
    // project + statuses, so a bad id caught mid-loop would otherwise leave a
    // partial import behind.
    assertBundleIdsSafe(bundle);
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
