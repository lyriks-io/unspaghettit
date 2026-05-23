import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectRepository } from '../ports/ProjectRepository';

/**
 * Returns the first project that lists this feature id, or null if none.
 * Used by the feature editor so each feature can resolve its
 * project context and surface sibling features' resources/data/events
 * as part of the same logical "product".
 */
export const findProjectContainingFeatureUseCase = (deps: {
  repository: ProjectRepository;
}) => {
  return async (featureId: FeatureId): Promise<Project | null> => {
    const summaries = await deps.repository.list();
    for (const summary of summaries) {
      const project = await deps.repository.get(summary.id);
      if (!project) continue;
      if (project.featureIds.some((id) => id === featureId)) return project;
    }
    return null;
  };
};
