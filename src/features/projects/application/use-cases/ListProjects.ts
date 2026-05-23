import type {
  ProjectRepository,
  ProjectSummary
} from '../ports/ProjectRepository';

export const listProjectsUseCase = (deps: { repository: ProjectRepository }) => {
  return async (): Promise<readonly ProjectSummary[]> => {
    return deps.repository.list();
  };
};
