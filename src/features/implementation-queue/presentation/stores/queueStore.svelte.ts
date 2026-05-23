import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
import type { QueueView } from '../../application/use-cases/ListQueue';
import {
  queueItemKey,
  type QueueItem,
  type QueueItemId
} from '../../domain/entities/QueueItem';

/**
 * Reactive view of the active project's queue. Reads come from
 * `projectStore.project.implementationQueue` (which Yjs already keeps in
 * sync across tabs); writes go through the queue use cases and then
 * `projectStore.applyProject`-equivalent path so the UI updates locally
 * without a round-trip.
 *
 * The store deliberately mirrors `projectStore`'s lifecycle: it's a
 * singleton that observes whatever project is currently loaded. Components
 * don't pass a projectId; they just read `queueStore.views` and call
 * `queueStore.enqueue*` / `dequeue` / `moveTo`.
 */
class QueueStore {
  views = $state<readonly QueueView[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  /** Refresh `views` for the currently loaded project. Idempotent. */
  async refresh(): Promise<void> {
    const projectId = projectStore.project?.id;
    if (!projectId) {
      this.views = [];
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const container = await getBrowserContainer();
      this.views = await container.useCases.listQueue(projectId);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /** True when the queue already holds an entry for this (kind, ids) tuple. */
  isQueued(target:
    | { kind: 'feature'; featureId: FeatureId }
    | { kind: 'surface'; featureId: FeatureId; surfaceId: SurfaceId }
    | { kind: 'action'; featureId: FeatureId; actionId: ActionId }
  ): boolean {
    const key =
      target.kind === 'feature'
        ? `feature:${String(target.featureId)}`
        : target.kind === 'surface'
          ? `surface:${String(target.featureId)}:${String(target.surfaceId)}`
          : `action:${String(target.featureId)}:${String(target.actionId)}`;
    return this.views.some((v) => queueItemKey(v.item) === key);
  }

  async enqueueFeature(projectId: ProjectId, featureId: FeatureId): Promise<void> {
    await this.mutate(async (container) => {
      await container.useCases.enqueueQueueItem(projectId, { kind: 'feature', featureId });
    });
  }

  async enqueueSurface(
    projectId: ProjectId,
    featureId: FeatureId,
    surfaceId: SurfaceId
  ): Promise<void> {
    await this.mutate(async (container) => {
      await container.useCases.enqueueQueueItem(projectId, {
        kind: 'surface',
        featureId,
        surfaceId
      });
    });
  }

  async enqueueAction(
    projectId: ProjectId,
    featureId: FeatureId,
    actionId: ActionId
  ): Promise<void> {
    await this.mutate(async (container) => {
      await container.useCases.enqueueQueueItem(projectId, {
        kind: 'action',
        featureId,
        actionId
      });
    });
  }

  async dequeue(projectId: ProjectId, itemId: QueueItemId): Promise<void> {
    await this.mutate(async (container) => {
      await container.useCases.dequeueQueueItem(projectId, itemId);
    });
  }

  async moveTo(projectId: ProjectId, itemId: QueueItemId, targetIndex: number): Promise<void> {
    await this.mutate(async (container) => {
      await container.useCases.moveQueueItem(projectId, itemId, {
        kind: 'to',
        targetIndex
      });
    });
  }

  reset(): void {
    this.views = [];
    this.loading = false;
    this.error = null;
  }

  /**
   * Wrap an awaitable mutation: clear the error, run it, then refresh from
   * the repo so the local view matches the persisted truth. Any thrown
   * error is captured on the store and the UI can surface it (or dismiss).
   */
  private async mutate(
    op: (container: Awaited<ReturnType<typeof getBrowserContainer>>) => Promise<void>
  ): Promise<void> {
    this.error = null;
    try {
      const container = await getBrowserContainer();
      await op(container);
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
}

export const queueStore = new QueueStore();

export type { QueueItem, QueueItemId };
