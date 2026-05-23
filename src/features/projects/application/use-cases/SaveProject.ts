import type { Clock } from '$shared/domain/Clock';
import type { Project } from '$features/projects/domain/entities/Project';
import { normalizeTags } from '$shared/domain/Tags';
import type { ProjectRepository } from '../ports/ProjectRepository';

export const saveProjectUseCase = (deps: {
  repository: ProjectRepository;
  clock: Clock;
}) => {
  return async (project: Project): Promise<Project> => {
    if (typeof project.name !== 'string' || project.name.trim().length === 0) {
      throw new Error('Project name is required');
    }
    if (typeof project.description !== 'string' || project.description.trim().length === 0) {
      throw new Error('Project description is required');
    }
    const trimmedTagType = project.customTagType?.trim() ?? '';
    const trimmedTag = project.customTag?.trim() ?? '';
    const tags = normalizeTags(project.tags, { type: trimmedTagType, value: trimmedTag });
    const next: Project = {
      ...project,
      tags,
      customTagType: undefined,
      customTag: undefined,
      updatedAt: deps.clock()
    };
    await deps.repository.save(next);
    return next;
  };
};
