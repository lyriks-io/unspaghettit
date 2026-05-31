import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import {
  buildBuilderModeDashboard,
  type BuilderModeProject,
  type BuilderModeProjectInput
} from '$features/builder-mode/domain/BuilderModeDashboard';

/**
 * Scoped sibling of {@link getBuilderModeDashboardUseCase}: rebuild ONE project's
 * builder-mode view. Used after a single-feature mutation so the Builder refreshes
 * just the affected project instead of re-reading and re-scoring every project.
 * Returns null when the project no longer exists.
 */
export const getBuilderModeProjectUseCase =
  (deps: {
    readonly projects: ProjectRepository;
    readonly features: FeatureRepository;
    readonly statuses: ImplementationStatusRepository;
  }) =>
  async (projectId: ProjectId): Promise<BuilderModeProject | null> => {
    const project = await deps.projects.get(projectId);
    if (!project) return null;
    const coreFeatures = await Promise.all(
      project.featureIds.map(async (featureId) => {
        const [feature, implementationStatus] = await Promise.all([
          deps.features.get(featureId),
          deps.statuses.get(featureId)
        ]);
        return feature ? { feature, implementationStatus } : null;
      })
    );
    const input: BuilderModeProjectInput = {
      project,
      coreFeatures: coreFeatures.filter(
        (entry): entry is NonNullable<(typeof coreFeatures)[number]> => entry !== null
      )
    };
    return buildBuilderModeDashboard([input]).projects[0] ?? null;
  };
