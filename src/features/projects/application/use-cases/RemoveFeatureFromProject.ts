import type { Clock } from '$shared/domain/Clock';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '../ports/ProjectRepository';

export const removeFeatureFromProjectUseCase = (deps: {
  repository: ProjectRepository;
  clock: Clock;
}) => {
  return async (projectId: ProjectId, featureId: FeatureId): Promise<Project> => {
    const project = await deps.repository.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.featureIds.includes(featureId)) return project;
    const next: Project = {
      ...project,
      featureIds: project.featureIds.filter((id) => id !== featureId),
      updatedAt: deps.clock()
    };
    await deps.repository.save(next);
    return next;
  };
};
