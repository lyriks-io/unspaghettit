import type { ProjectSummary } from '$features/projects/application/ports/ProjectRepository';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { emit } from '$shared/events/eventBus';

const UNKNOWN_PROJECT_NAME = 'Unknown';

class ProjectsStore {
  loading = $state(true);
  summaries = $state<ProjectSummary[]>([]);
  search = $state('');
  pendingDeleteId = $state<string | null>(null);
  /** State: projects.selectedProjectId. ID of the project the user has focus on in the list, "" for none. */
  selectedProjectId = $state<string>('');
  error = $state<string | null>(null);

  async refresh(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      const container = await getBrowserContainer();
      this.summaries = [...(await container.useCases.listProjects())];
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Reload without flipping `loading` so the grid doesn't blank under a
   * "Loading..." placeholder on background sync events or post-action syncs.
   */
  async refreshSilent(): Promise<void> {
    try {
      const container = await getBrowserContainer();
      this.summaries = [...(await container.useCases.listProjects())];
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  setSearch(query: string): void {
    this.search = query;
    emit('project.search_updated', { query });
  }

  setSelectedProject(id: string): void {
    this.selectedProjectId = id;
    if (id) emit('project.opened', { id });
  }

  /**
   * Open Project. Records the selection (so `projects.selectedProjectId`
   * reflects the active row) and returns the target path for the caller to
   * navigate to. Action: aa939b7e (Open Project).
   */
  openProject(id: string): string {
    this.setSelectedProject(id);
    return `/projects/${id}`;
  }

  stagePendingDelete(id: string): void {
    this.pendingDeleteId = id;
    emit('project.delete_requested', { id });
  }

  clearPendingDelete(): void {
    this.pendingDeleteId = null;
  }

  async create(name: string, description: string): Promise<ProjectId> {
    const container = await getBrowserContainer();
    const project = await container.useCases.createProject({
      name,
      description
    });
    await this.refreshSilent();
    emit('project.created', { id: String(project.id), name: project.name });
    return project.id;
  }

  async remove(id: ProjectId): Promise<void> {
    this.summaries = this.summaries.filter((s) => String(s.id) !== String(id));
    this.clearPendingDelete();
    const container = await getBrowserContainer();
    await container.useCases.deleteProject(id);
    emit('project.deleted', { id: String(id) });
  }

  /**
   * Sweep every feature that is not linked to any project into an auto-created
   * "Unknown" project. Idempotent: if the Unknown project already exists, it's
   * reused; if there are no orphans, nothing happens.
   */
  async reconcileOrphanFeatures(): Promise<void> {
    const container = await getBrowserContainer();
    const features = await container.useCases.listFeatures();
    if (features.length === 0) return;

    const projectSummaries = await container.useCases.listProjects();
    const assigned = new Set<string>();
    for (const ps of projectSummaries) {
      const full = await container.useCases.getProject(ps.id);
      if (full) {
        for (const fid of full.featureIds) assigned.add(String(fid));
      }
    }

    const orphans = features.filter((f) => !assigned.has(String(f.id)));
    if (orphans.length === 0) return;

    let unknown = projectSummaries.find((p) => p.name === UNKNOWN_PROJECT_NAME);
    if (!unknown) {
      const created = await container.useCases.createProject({
        name: UNKNOWN_PROJECT_NAME,
        description:
          'Auto-created bucket. Holds features that are not assigned to any other project. Rename or reassign to clean it up.'
      });
      unknown = {
        id: created.id,
        name: created.name,
        description: created.description,
        featureCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      };
    }

    for (const orphan of orphans) {
      await container.useCases.addFeatureToProject(unknown.id, orphan.id as FeatureId);
    }

    await this.refreshSilent();
  }
}

export const projectsStore = new ProjectsStore();
