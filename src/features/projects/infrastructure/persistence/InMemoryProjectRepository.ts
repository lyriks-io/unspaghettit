import type {
  ProjectRepository,
  ProjectSummary
} from '$features/projects/application/ports/ProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { normalizeTags } from '$shared/domain/Tags';

const toSummary = (p: Project): ProjectSummary => ({
  id: p.id,
  name: p.name,
  description: p.description,
  tags: normalizeTags(p.tags, { type: p.customTagType, value: p.customTag }),
  featureCount: p.featureIds.length,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt
});

export class InMemoryProjectRepository implements ProjectRepository {
  private store = new Map<ProjectId, Project>();

  async list(): Promise<readonly ProjectSummary[]> {
    return Array.from(this.store.values())
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(toSummary);
  }

  async get(id: ProjectId): Promise<Project | null> {
    return this.store.get(id) ?? null;
  }

  async save(project: Project): Promise<void> {
    this.store.set(project.id, project);
  }

  async delete(id: ProjectId): Promise<void> {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}
