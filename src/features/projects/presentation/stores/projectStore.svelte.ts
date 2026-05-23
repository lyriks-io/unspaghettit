import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { dropRoomClient, getRoomClient, type YDocClient } from '$lib/client/sync';
import { reconcileInPlace } from '$lib/client/reconcile';
import { emit } from '$shared/events/eventBus';

export type ProjectPanel = 'features' | 'queue' | 'resources' | 'data' | 'events' | 'transitions';

class ProjectStore {
  loading = $state(true);
  project = $state<Project | null>(null);
  /**
   * Spec state paths project.id / project.name / project.featureIds live
   * inside the Project entity. These $derived accessors expose each one as
   * its own reactive value so consumers can subscribe to just the field that
   * changed.
   */
  id = $derived<string>(this.project ? String(this.project.id) : '');
  name = $derived<string>(this.project?.name ?? '');
  featureIds = $derived<readonly string[]>(
    this.project ? this.project.featureIds.map(String) : []
  );
  error = $state<string | null>(null);
  saveError = $state<string | null>(null);
  saving = $state(false);
  dirty = $state(false);
  lastSavedAt = $state('');
  activePanel = $state<ProjectPanel>('features');
  selectedFeatureId = $state<string>('');
  search = $state('');
  private currentId: ProjectId | null = null;
  private client: YDocClient<Project> | null = null;
  private clientUnsubscribe: (() => void) | null = null;

  async load(id: ProjectId): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      this.currentId = id;
      const container = await getBrowserContainer();
      const fresh = await container.useCases.getProject(id);
      this.project = fresh;
      this.dirty = false;
      this.lastSavedAt = fresh?.updatedAt ?? '';
      this.subscribeRoom(id);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  setActivePanel(panel: ProjectPanel): void {
    this.activePanel = panel;
    emit('project.panel_switched', { panel });
  }

  setSearch(query: string): void {
    this.search = query;
    emit('project.editor_search_updated', { query });
  }

  setSelectedFeature(id: string): void {
    this.selectedFeatureId = id;
    if (id) emit('project.feature_opened', { featureId: id });
  }

  async addFeature(featureId: FeatureId): Promise<void> {
    if (!this.project || !this.currentId) return;
    this.saving = true;
    this.saveError = null;
    try {
      const container = await getBrowserContainer();
      const next = await container.useCases.addFeatureToProject(
        this.currentId,
        featureId
      );
      this.applyProject(next);
      emit('project.feature_added', {
        projectId: String(this.currentId),
        featureId: String(featureId)
      });
    } catch (e) {
      this.saveError = (e as Error).message;
    } finally {
      this.saving = false;
    }
  }

  async removeFeature(featureId: FeatureId): Promise<void> {
    if (!this.project || !this.currentId) return;
    this.saving = true;
    this.saveError = null;
    try {
      const container = await getBrowserContainer();
      const next = await container.useCases.removeFeatureFromProject(
        this.currentId,
        featureId
      );
      this.applyProject(next);
      emit('project.feature_removed', {
        projectId: String(this.currentId),
        featureId: String(featureId)
      });
    } catch (e) {
      this.saveError = (e as Error).message;
    } finally {
      this.saving = false;
    }
  }

  async rename(name: string): Promise<void> {
    if (!this.project) return;
    this.saving = true;
    this.saveError = null;
    try {
      const container = await getBrowserContainer();
      const next = await container.useCases.saveProject({
        ...this.project,
        name: name.trim()
      });
      this.applyProject(next);
    } catch (e) {
      this.saveError = (e as Error).message;
    } finally {
      this.saving = false;
    }
  }

  async updateMetadata(name: string, description: string): Promise<void> {
    if (!this.project) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    this.saving = true;
    this.saveError = null;
    try {
      const container = await getBrowserContainer();
      const trimmedDescription = description.trim();
      const next = await container.useCases.saveProject({
        ...this.project,
        name: trimmedName,
        description: trimmedDescription.length > 0 ? trimmedDescription : undefined
      });
      this.applyProject(next);
      emit('project.saved', { id: String(next.id), name: next.name });
    } catch (e) {
      this.saveError = (e as Error).message;
    } finally {
      this.saving = false;
    }
  }

  async setDescription(description: string): Promise<void> {
    if (!this.project) return;
    this.saving = true;
    this.saveError = null;
    try {
      const container = await getBrowserContainer();
      const trimmed = description.trim();
      const next = await container.useCases.saveProject({
        ...this.project,
        description: trimmed.length > 0 ? trimmed : undefined
      });
      this.applyProject(next);
    } catch (e) {
      this.saveError = (e as Error).message;
    } finally {
      this.saving = false;
    }
  }

  dismissSaveError(): void {
    this.saveError = null;
  }

  reset(): void {
    if (this.clientUnsubscribe) {
      this.clientUnsubscribe();
      this.clientUnsubscribe = null;
    }
    this.client = null;
    this.currentId = null;
    this.project = null;
    this.error = null;
    this.saveError = null;
    this.loading = true;
    this.saving = false;
    this.dirty = false;
    this.lastSavedAt = '';
    this.activePanel = 'features';
    this.selectedFeatureId = '';
    this.search = '';
  }

  private applyProject(next: Project): void {
    if (this.project) reconcileInPlace(this.project, next);
    else this.project = next;
    this.dirty = false;
    this.lastSavedAt = next.updatedAt;
  }

  private subscribeRoom(id: ProjectId): void {
    if (this.clientUnsubscribe) {
      this.clientUnsubscribe();
      this.clientUnsubscribe = null;
    }
    const client = getRoomClient<Project>('project', id);
    this.client = client;
    this.clientUnsubscribe = client.observe((next, origin) => {
      if (origin === 'local') return;
      if (!next) return;
      if (this.currentId !== id) return;
      if (this.project) reconcileInPlace(this.project, next);
      else this.project = next;
      this.lastSavedAt = next.updatedAt;
    });
  }
}

export const projectStore = new ProjectStore();

export const releaseProjectRoom = (id: ProjectId): void => {
  dropRoomClient('project', id);
};
