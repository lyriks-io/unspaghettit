import { browser } from '$app/environment';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import { dropRoomClient, getRoomClient, type YDocClient } from '$lib/client/sync';
import { apiFetch } from '$shared/security/apiFetch';

class ImplementationStatusStore {
  loading = $state(false);
  refreshing = $state(false);
  status = $state<ImplementationStatus | null>(null);
  error = $state<string | null>(null);
  lastFetchedAt = $state<string | null>(null);
  /**
   * Timestamp of the last remote sync event for the currently-loaded feature.
   * Useful for the UI to show "fresh from server" indicators.
   */
  lastUpdateSignalAt = $state<string | null>(null);
  private currentId: FeatureId | null = null;
  private client: YDocClient<ImplementationStatus> | null = null;
  private clientUnsubscribe: (() => void) | null = null;

  async load(id: FeatureId): Promise<void> {
    this.currentId = id;
    this.error = null;
    this.loading = true;
    try {
      await this.fetchOnce(id);
      this.subscribeRoom(id);
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.currentId || this.refreshing) return;
    this.refreshing = true;
    this.error = null;
    try {
      await this.fetchOnce(this.currentId);
    } finally {
      this.refreshing = false;
    }
  }

  reset(): void {
    if (this.clientUnsubscribe) {
      this.clientUnsubscribe();
      this.clientUnsubscribe = null;
    }
    this.client = null;
    this.currentId = null;
    this.status = null;
    this.error = null;
    this.loading = false;
    this.refreshing = false;
    this.lastFetchedAt = null;
    this.lastUpdateSignalAt = null;
  }

  private async fetchOnce(id: FeatureId): Promise<void> {
    if (!browser) return;
    try {
      const res = await apiFetch(`/api/snapshots/${id}/implementation-status`);
      if (!res.ok) {
        this.status = null;
        return;
      }
      const body = (await res.json()) as ImplementationStatus | null;
      this.status = body ?? null;
      this.lastFetchedAt = new Date().toISOString();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private subscribeRoom(id: FeatureId): void {
    if (this.clientUnsubscribe) {
      this.clientUnsubscribe();
      this.clientUnsubscribe = null;
    }
    const client = getRoomClient<ImplementationStatus>('implementation-status', id);
    this.client = client;
    this.clientUnsubscribe = client.observe((next, origin) => {
      if (this.currentId !== id) return;
      if (origin === 'local') return;
      this.lastUpdateSignalAt = new Date().toISOString();
      this.status = next;
      this.lastFetchedAt = this.lastUpdateSignalAt;
    });
  }
}

export const implementationStatusStore = new ImplementationStatusStore();

export const releaseImplementationStatusRoom = (id: FeatureId): void => {
  dropRoomClient('implementation-status', id);
};
