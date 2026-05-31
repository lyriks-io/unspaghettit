import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import {
  buildBuilderModeDashboard,
  type BuilderModeDashboard,
  type BuilderModeProjectInput
} from '$features/builder-mode/domain/BuilderModeDashboard';

export const getBuilderModeDashboardUseCase =
  (deps: {
    readonly projects: ProjectRepository;
    readonly features: FeatureRepository;
    readonly statuses: ImplementationStatusRepository;
  }) =>
  async (): Promise<BuilderModeDashboard> => {
    const projectSummaries = await deps.projects.list();
    const inputs: BuilderModeProjectInput[] = [];

    for (const summary of projectSummaries) {
      const project = await deps.projects.get(summary.id);
      if (!project) continue;
      const coreFeatures = await Promise.all(
        project.featureIds.map(async (featureId) => {
          const [feature, implementationStatus] = await Promise.all([
            deps.features.get(featureId),
            deps.statuses.get(featureId)
          ]);
          return feature ? { feature, implementationStatus } : null;
        })
      );
      inputs.push({
        project,
        coreFeatures: coreFeatures.filter(
          (entry): entry is NonNullable<(typeof coreFeatures)[number]> => entry !== null
        )
      });
    }

    return buildBuilderModeDashboard(inputs);
  };
