import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureSummary } from '$features/behavior-model/application/ports/FeatureRepository';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';

/**
 * Loads full child Feature objects for a project so the project editor can
 * render the aggregated Resources/Entity/Events/Transitions panels with
 * attribution back to the owning feature. Kept separate from
 * `projectStore` to isolate the multi-fetch concern.
 *
 * Two flavors of refresh:
 *   - `load(...)` flips `loading=true` and is right for the cold open of
 *     a project page (the panel SHOULD show a "Loading..." placeholder).
 *   - `syncWith(...)` / `refetchOne(...)` do an incremental update with NO
 *     loading flicker so out-of-band MCP writes don't make the cards
 *     blank-then-redraw on every change.
 */
class ProjectFeaturesStore {
  loading = $state(false);
  features = $state<Feature[]>([]);
  allSummaries = $state<FeatureSummary[]>([]);
  error = $state<string | null>(null);

  async load(featureIds: readonly FeatureId[]): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const container = await getBrowserContainer();
      const fetched = await Promise.all(
        featureIds.map((id) => container.useCases.getFeature(id))
      );
      this.features = fetched.filter((e): e is Feature => e !== null);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Bring `features[]` in line with the project's current featureIds[]
   * without toggling `loading`. Existing features keep their reference
   * (Svelte sees no change → no DOM churn). Missing features get fetched
   * and merged in; removed ones are dropped. Out-of-band project edits
   * (MCP add_feature_to_project) flow through here, so the UI gets the
   * new card sliding into the existing list instead of a full redraw.
   */
  async syncWith(featureIds: readonly FeatureId[]): Promise<void> {
    const wanted = new Set(featureIds.map(String));
    const have = new Map(this.features.map((f) => [String(f.id), f]));
    const missing = featureIds.filter((id) => !have.has(String(id)));
    let nextHave = have;
    if (missing.length > 0) {
      try {
        const container = await getBrowserContainer();
        const fetched = await Promise.all(
          missing.map((id) => container.useCases.getFeature(id))
        );
        nextHave = new Map(have);
        for (const f of fetched) if (f) nextHave.set(String(f.id), f);
      } catch (e) {
        this.error = (e as Error).message;
        return;
      }
    }
    // Preserve project order; drop anything no longer attached.
    this.features = featureIds
      .map((id) => nextHave.get(String(id)))
      .filter((f): f is Feature => f !== undefined && wanted.has(String(f.id)));
  }

  /**
   * Re-fetch a single feature the user already owns. Mutates the array
   * in-place at its current index so the keyed `{#each}` re-uses the
   * existing DOM node — no flicker, scroll position preserved.
   */
  async refetchOne(featureId: FeatureId): Promise<void> {
    try {
      const container = await getBrowserContainer();
      const fresh = await container.useCases.getFeature(featureId);
      const idx = this.features.findIndex((f) => String(f.id) === String(featureId));
      if (!fresh) {
        if (idx >= 0) this.features = [...this.features.slice(0, idx), ...this.features.slice(idx + 1)];
        return;
      }
      if (idx >= 0) {
        this.features = [...this.features.slice(0, idx), fresh, ...this.features.slice(idx + 1)];
      } else {
        this.features = [...this.features, fresh];
      }
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  async loadAllSummaries(): Promise<void> {
    try {
      const container = await getBrowserContainer();
      this.allSummaries = [...(await container.useCases.listFeatures())];
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  reset(): void {
    this.features = [];
    this.allSummaries = [];
    this.loading = false;
    this.error = null;
  }
}

export const projectFeaturesStore = new ProjectFeaturesStore();
