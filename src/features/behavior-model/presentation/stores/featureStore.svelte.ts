import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { FeatureValidationError } from '$features/behavior-model/application/use-cases/MutateFeature';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { dropRoomClient, getRoomClient, type YDocClient } from '$lib/client/sync';
import { deepClonePlain, reconcileInPlace } from '$lib/client/reconcile';
import type { HistoryEntry } from '$lib/sync/protocol';
import { emit } from '$shared/events/eventBus';

type Mutator = (current: Feature) => Feature;

class FeatureStore {
  loading = $state(true);
  feature = $state<Feature | null>(null);
  error = $state<string | null>(null);
  saveError = $state<string | null>(null);
  saving = $state(false);
  historyEntries = $state<HistoryEntry[]>([]);
  historyCursor = $state(-1);
  // Undo/redo are pure cursor moves on the shared history. Derive them
  // from the cursor instead of carrying separate reactive state.
  canUndo = $derived(this.historyCursor > 0);
  canRedo = $derived(
    this.historyCursor >= 0 && this.historyCursor < this.historyEntries.length - 1
  );
  private currentId: FeatureId | null = null;
  private client: YDocClient<Feature> | null = null;
  private clientUnsubscribe: (() => void) | null = null;
  private historyUnsubscribe: (() => void) | null = null;

  async load(id: FeatureId): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      this.currentId = id;
      const container = await getBrowserContainer();
      const fresh = await container.useCases.getFeature(id);
      this.feature = fresh;
      this.subscribeRoom(id);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async mutate(mutator: Mutator): Promise<void> {
    if (!this.feature || !this.currentId) return;
    // Snapshot the live proxy to a plain POJO BEFORE handing it to the mutator
    //. Most mutators do shallow copies (`{...feature, surfaces: [...]}`),
    // which leaves inner items as live $state proxies. Reconciling against
    // those proxies and then handing the same object to Yjs would mutate
    // shared references on both sides and broadcast a corrupted snapshot.
    const currentSnapshot = $state.snapshot(this.feature) as unknown as Feature;
    const next = mutator(currentSnapshot);
    const cleanNext = next === currentSnapshot ? currentSnapshot : (deepClonePlain(next) as Feature);
    this.applyNext(cleanNext);
    if (!this.client) return;
    this.saving = true;
    this.saveError = null;
    try {
      this.client.setSnapshot(cleanNext);
      emit('feature.saved', { id: String(cleanNext.id), name: cleanNext.name });
    } catch (e) {
      if (e instanceof FeatureValidationError && e.errors.length > 0) {
        this.saveError = `${e.message}\n• ${e.errors.join('\n• ')}`;
      } else {
        this.saveError = (e as Error).message;
      }
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
    if (this.historyUnsubscribe) {
      this.historyUnsubscribe();
      this.historyUnsubscribe = null;
    }
    this.client = null;
    this.currentId = null;
    this.feature = null;
    this.error = null;
    this.saveError = null;
    this.loading = true;
    this.saving = false;
    this.historyEntries = [];
    this.historyCursor = -1;
  }

  /**
   * Step the shared history cursor backward by one. The server applies the
   * previous snapshot to the Y.Doc and broadcasts a fresh history_snapshot;
   * the room observer below picks up the resulting remote map write and
   * reconciles the live feature into the new state. No local replay, no
   * new history entry.
   */
  undo(): void {
    this.client?.undo();
  }

  redo(): void {
    this.client?.redo();
  }

  /** Time-travel directly to a specific history entry. */
  jumpToHistory(entryId: string): void {
    this.client?.jumpTo(entryId);
  }

  /**
   * Wipe the feature's shared history. The server replies with a fresh
   * snapshot containing a single "Cleared history" anchor — every peer
   * sees the same wipe via the room's broadcast. The current state of
   * the feature itself is untouched.
   */
  clearHistory(): void {
    this.client?.clearHistory();
  }

  private subscribeRoom(id: FeatureId): void {
    if (this.clientUnsubscribe) {
      this.clientUnsubscribe();
      this.clientUnsubscribe = null;
    }
    if (this.historyUnsubscribe) {
      this.historyUnsubscribe();
      this.historyUnsubscribe = null;
    }
    const client = getRoomClient<Feature>('feature', id);
    this.client = client;
    this.clientUnsubscribe = client.observe((next, origin) => {
      if (origin === 'local') return;
      if (!next) return;
      if (this.currentId !== id) return;
      this.applyNext(next);
    });
    this.historyEntries = client.history.entries;
    this.historyCursor = client.history.cursor;
    this.historyUnsubscribe = client.observeHistory((view) => {
      if (this.currentId !== id) return;
      this.historyEntries = view.entries;
      this.historyCursor = view.cursor;
    });
  }

  /**
   * Bring the live $state proxy in step with `next` while preserving the
   * identity of every unchanged sub-tree. Critical for reorders: a naive
   * field-by-field replace (what fast-json-patch generates) creates a
   * transient duplicate-id state that Svelte's keyed `{#each}` rejects with
   * `each_key_duplicate`. The reconciler moves items via array splice so the
   * each block sees a clean rearrangement.
   */
  private applyNext(next: Feature): void {
    if (!this.feature) {
      this.feature = next;
      return;
    }
    reconcileInPlace(this.feature, next);
  }
}

export const featureStore = new FeatureStore();

// Best-effort cleanup when navigating away. Keeps the WS connection count bounded.
export const releaseFeatureRoom = (id: FeatureId): void => {
  dropRoomClient('feature', id);
};
