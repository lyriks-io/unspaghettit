import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '../ports/ProjectRepository';

export const getProjectUseCase = (deps: { repository: ProjectRepository }) => {
  return async (id: ProjectId): Promise<Project | null> => {
    return deps.repository.get(id);
  };
};
