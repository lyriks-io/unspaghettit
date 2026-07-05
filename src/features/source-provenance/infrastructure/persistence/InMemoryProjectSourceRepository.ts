import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';
import type { ProjectSourceRepository } from '$features/source-provenance/application/ports/ProjectSourceRepository';

export class InMemoryProjectSourceRepository implements ProjectSourceRepository {
  private readonly byId = new Map<string, ProjectSource>();

  async listForProject(projectId: string | null): Promise<readonly ProjectSource[]> {
    return [...this.byId.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
  }

  async find(sourceId: string): Promise<ProjectSource | null> {
    return this.byId.get(sourceId) ?? null;
  }

  async save(source: ProjectSource): Promise<void> {
    this.byId.set(source.id, source);
  }

  async delete(sourceId: string): Promise<void> {
    this.byId.delete(sourceId);
  }
}
