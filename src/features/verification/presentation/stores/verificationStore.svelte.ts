import { browser } from '$app/environment';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { VerificationReport } from '$features/verification/domain/VerificationReport';
import { apiFetch } from '$shared/security/apiFetch';

/**
 * Presentation store for the Verify view. Runs the server-side verification
 * spine (scenarios + maturity + reachability + model check + drift + event
 * coherence) on demand and holds the report. No Yjs room — verification is a
 * computed read, re-run explicitly via `load` / `refresh`, not a live document.
 */
class VerificationStore {
  loading = $state(false);
  report = $state<VerificationReport | null>(null);
  error = $state<string | null>(null);
  /** When true, the heavier bounded model checking is requested. */
  modelCheck = $state(true);
  private currentId: FeatureId | null = null;

  async load(id: FeatureId): Promise<void> {
    this.currentId = id;
    await this.run();
  }

  async refresh(): Promise<void> {
    if (this.currentId) await this.run();
  }

  setModelCheck(on: boolean): void {
    this.modelCheck = on;
    void this.refresh();
  }

  reset(): void {
    this.currentId = null;
    this.report = null;
    this.error = null;
    this.loading = false;
  }

  private async run(): Promise<void> {
    if (!browser || !this.currentId) return;
    const id = this.currentId;
    this.loading = true;
    this.error = null;
    try {
      const res = await apiFetch(`/api/snapshots/${id}/verify?modelCheck=${this.modelCheck ? '1' : '0'}`);
      if (!res.ok) {
        this.error = `Verification failed (${res.status})`;
        this.report = null;
        return;
      }
      // Ignore a response that arrived after the user navigated to another feature.
      if (this.currentId !== id) return;
      this.report = (await res.json()) as VerificationReport;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      if (this.currentId === id) this.loading = false;
    }
  }
}

export const verificationStore = new VerificationStore();
