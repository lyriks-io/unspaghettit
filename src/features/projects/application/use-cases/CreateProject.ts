import type { Clock } from '$shared/domain/Clock';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { normalizeTags, type Tag } from '$shared/domain/Tags';
import type { ProjectRepository } from '../ports/ProjectRepository';

export type CreateProjectInput = {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly customTagType?: string;
  readonly customTag?: string;
};

export const createProjectUseCase = (deps: {
  repository: ProjectRepository;
  ids: IdGenerator;
  clock: Clock;
}) => {
  return async (input: CreateProjectInput): Promise<Project> => {
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Project name is required');
    }
    const trimmedDescription = input.description?.trim() ?? '';
    if (trimmedDescription.length === 0) {
      throw new Error('Project description is required');
    }
    const now = deps.clock();
    const trimmedTagType = input.customTagType?.trim() ?? '';
    const trimmedTag = input.customTag?.trim() ?? '';
    const tags = normalizeTags(input.tags, { type: trimmedTagType, value: trimmedTag });
    const project: Project = {
      id: asProjectId(deps.ids()),
      name: trimmedName,
      description: trimmedDescription,
      ...(tags ? { tags } : {}),
      featureIds: [],
      createdAt: now,
      updatedAt: now
    };
    await deps.repository.save(project);
    return project;
  };
};
