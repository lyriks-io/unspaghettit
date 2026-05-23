import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '../ports/ProjectRepository';

export const deleteProjectUseCase = (deps: { repository: ProjectRepository }) => {
  return async (id: ProjectId): Promise<void> => {
    await deps.repository.delete(id);
  };
};
