import { browser } from '$app/environment';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Provenance } from '$features/source-provenance/domain/Provenance';
import { apiFetch } from '$shared/security/apiFetch';

/**
 * Loads the provenance sidecar (stored source file + recorded spans) for a
 * feature. Read-only: the agent writes provenance through the MCP, the dashboard
 * just displays it. Unlike the implementation-status store there is no live room
 * subscription yet, so call `refresh()` to pick up spans recorded while open.
 */
class ProvenanceStore {
  loading = $state(false);
  refreshing = $state(false);
  provenance = $state<Provenance | null>(null);
  error = $state<string | null>(null);
  lastFetchedAt = $state<string | null>(null);
  private currentId: FeatureId | null = null;

  async load(id: FeatureId): Promise<void> {
    this.currentId = id;
    this.error = null;
    this.loading = true;
    try {
      await this.fetchOnce(id);
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
    this.currentId = null;
    this.provenance = null;
    this.error = null;
    this.loading = false;
    this.refreshing = false;
    this.lastFetchedAt = null;
  }

  private async fetchOnce(id: FeatureId): Promise<void> {
    if (!browser) return;
    try {
      const res = await apiFetch(`/api/snapshots/${id}/provenance`);
      if (!res.ok) {
        this.provenance = null;
        return;
      }
      const body = (await res.json()) as Provenance | null;
      // Ignore a response that arrived after the user navigated to another feature.
      if (this.currentId !== id) return;
      this.provenance = body ?? null;
      this.lastFetchedAt = new Date().toISOString();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
}

export const provenanceStore = new ProvenanceStore();
