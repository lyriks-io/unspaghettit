import type {
  ProjectRepository,
  ProjectSummary
} from '$features/projects/application/ports/ProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { apiFetch } from '$shared/security/apiFetch';

const BASE = '/api/projects';
const itemUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export class HttpProjectRepository implements ProjectRepository {
  async list(): Promise<readonly ProjectSummary[]> {
    const res = await apiFetch(BASE);
    if (!res.ok) throw new Error(`Project list failed (${res.status})`);
    const body = (await res.json()) as { summaries: readonly ProjectSummary[] };
    return body.summaries;
  }

  async get(id: ProjectId): Promise<Project | null> {
    const res = await apiFetch(itemUrl(id));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Project get failed (${res.status})`);
    return (await res.json()) as Project;
  }

  async save(project: Project): Promise<void> {
    const res = await apiFetch(itemUrl(project.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Project save failed (${res.status})${text ? `: ${text}` : ''}`);
    }
  }

  async delete(id: ProjectId): Promise<void> {
    const res = await apiFetch(itemUrl(id), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Project delete failed (${res.status})`);
  }
}
