import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import {
  queueItemKey,
  type QueueItemId
} from '$features/implementation-queue/domain/entities/QueueItem';

/**
 * Loaded asynchronously alongside an open feature. If the feature is
 * part of a project, this exposes the project's other (sibling) features
 * so the project editor can present resources, data, events, and transitions as a
 * single union "owned by the project". Sibling entities are read-only here;
 * only the currently-open feature can be mutated through the editor.
 */
class ProjectContextStore {
  loading = $state<boolean>(false);
  project = $state<Project | null>(null);
  siblings = $state<readonly Feature[]>([]);
  error = $state<string | null>(null);
  private currentFeatureId: FeatureId | null = null;

  /** Resolve the project (if any) containing `featureId` and fetch siblings. */
  async load(featureId: FeatureId): Promise<void> {
    this.currentFeatureId = featureId;
    this.loading = true;
    this.error = null;
    try {
      const container = await getBrowserContainer();
      const project = await container.useCases.findProjectContainingFeature(featureId);
      if (this.currentFeatureId !== featureId) return; // stale load, ignore
      this.project = project;
      if (!project) {
        this.siblings = [];
        return;
      }
      const siblingIds = project.featureIds.filter((id) => id !== featureId);
      const siblings: Feature[] = [];
      for (const id of siblingIds) {
        const feature = await container.useCases.getFeature(id);
        if (this.currentFeatureId !== featureId) return;
        if (feature) siblings.push(feature);
      }
      this.siblings = siblings;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      if (this.currentFeatureId === featureId) this.loading = false;
    }
  }

  reset(): void {
    this.currentFeatureId = null;
    this.project = null;
    this.siblings = [];
    this.error = null;
    this.loading = false;
  }

  /** Convenience: is the open feature inside a project right now. */
  get isInProject(): boolean {
    return this.project !== null;
  }

  /**
   * True when the containing project's queue already holds an entry for
   * this action. Used to flip the hover button from "+ queue" to "queued".
   * Computed against the local store snapshot so it's synchronous and
   * stays cheap to call from every action row.
   */
  isActionQueued(featureId: FeatureId, actionId: ActionId): boolean {
    const queue = this.project?.implementationQueue ?? [];
    const key = `action:${String(featureId)}:${String(actionId)}`;
    return queue.some((q) => queueItemKey(q) === key);
  }

  /** Symmetric to isActionQueued, for surface-kind entries. */
  isSurfaceQueued(featureId: FeatureId, surfaceId: SurfaceId): boolean {
    const queue = this.project?.implementationQueue ?? [];
    const key = `surface:${String(featureId)}:${String(surfaceId)}`;
    return queue.some((q) => queueItemKey(q) === key);
  }

  /**
   * Queue an action of the currently-open feature for "implement next".
   * Returns false when there's no project context (e.g. the feature isn't
   * attached to a project) so the caller can no-op gracefully.
   */
  async enqueueAction(featureId: FeatureId, actionId: ActionId): Promise<boolean> {
    const project = this.project;
    if (!project) return false;
    try {
      const container = await getBrowserContainer();
      const result = await container.useCases.enqueueQueueItem(project.id, {
        kind: 'action',
        featureId,
        actionId
      });
      // Local merge: only the queue slice changed. Skip the round-trip
      // re-fetch so the next "is queued?" call returns true immediately.
      this.project = result.project;
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    }
  }

  /** Symmetric to enqueueAction. */
  async enqueueSurface(featureId: FeatureId, surfaceId: SurfaceId): Promise<boolean> {
    const project = this.project;
    if (!project) return false;
    try {
      const container = await getBrowserContainer();
      const result = await container.useCases.enqueueQueueItem(project.id, {
        kind: 'surface',
        featureId,
        surfaceId
      });
      this.project = result.project;
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    }
  }

  /**
   * Remove a queue entry by id. Symmetric with enqueueAction so the
   * action-row toggle can flip both ways from the same store.
   */
  async dequeueByItemId(itemId: QueueItemId): Promise<void> {
    const project = this.project;
    if (!project) return;
    try {
      const container = await getBrowserContainer();
      const next = await container.useCases.dequeueQueueItem(project.id, itemId);
      this.project = next;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /**
   * Find the queue item id for an action so a toggle in ActionEditor can
   * dequeue without re-deriving the id from the (featureId, actionId)
   * tuple at every callsite.
   */
  findQueueItemIdForAction(featureId: FeatureId, actionId: ActionId): QueueItemId | null {
    const queue = this.project?.implementationQueue ?? [];
    const key = `action:${String(featureId)}:${String(actionId)}`;
    const match = queue.find((q) => queueItemKey(q) === key);
    return match ? match.id : null;
  }

  /** Symmetric to findQueueItemIdForAction. */
  findQueueItemIdForSurface(featureId: FeatureId, surfaceId: SurfaceId): QueueItemId | null {
    const queue = this.project?.implementationQueue ?? [];
    const key = `surface:${String(featureId)}:${String(surfaceId)}`;
    const match = queue.find((q) => queueItemKey(q) === key);
    return match ? match.id : null;
  }
}

export const projectContextStore = new ProjectContextStore();
