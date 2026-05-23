import type { Clock } from '$shared/domain/Clock';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '../ports/ProjectRepository';

export type MoveDirection = 'up' | 'down';

export const moveFeatureInProjectUseCase = (deps: {
  repository: ProjectRepository;
  clock: Clock;
}) => {
  return async (
    projectId: ProjectId,
    featureId: FeatureId,
    direction: MoveDirection
  ): Promise<Project> => {
    const project = await deps.repository.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const idx = project.featureIds.indexOf(featureId);
    if (idx < 0) {
      throw new Error(`Feature ${featureId} is not attached to project ${projectId}`);
    }
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= project.featureIds.length) return project;
    const next = project.featureIds.slice();
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    const updated: Project = {
      ...project,
      featureIds: next,
      updatedAt: deps.clock()
    };
    await deps.repository.save(updated);
    return updated;
  };
};
