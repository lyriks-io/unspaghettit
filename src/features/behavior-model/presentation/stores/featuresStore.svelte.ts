import type { FeatureCardModel } from '$features/behavior-model/application/use-cases/ListFeaturesWithMaturity';
import type { LoadSamplesResult } from '$features/behavior-model/application/use-cases/LoadSamples';
import { importFeatureFromJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
import { emit } from '$shared/events/eventBus';
import { addTag, removeTag, type Tag } from '$shared/domain/Tags';
import { setCoreTag } from '$shared/domain/coreFeatureTag';

class FeaturesStore {
  loading = $state(true);
  summaries = $state<FeatureCardModel[]>([]);
  error = $state<string | null>(null);

  async refresh(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      const container = await getBrowserContainer();
      this.summaries = [...(await container.useCases.listFeaturesWithMaturity())];
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * In-place reload without flipping `loading`. Use after a user action that
   * already mutated `summaries` optimistically, or for background sync events
   * where the list should swap content without blanking the grid behind a
   * "Loading..." placeholder.
   */
  async refreshSilent(): Promise<void> {
    try {
      const container = await getBrowserContainer();
      this.summaries = [...(await container.useCases.listFeaturesWithMaturity())];
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  async create(name: string, description: string): Promise<string> {
    const container = await getBrowserContainer();
    const feature = await container.useCases.createFeature({ name, description });
    await this.refreshSilent();
    emit('feature.created', { id: feature.id, name: feature.name });
    return feature.id;
  }

  async addTag(id: string, tag: Tag): Promise<void> {
    const container = await getBrowserContainer();
    const feature = await container.useCases.getFeature(id as never);
    if (!feature) return;
    await container.useCases.saveFeature({
      ...feature,
      tags: addTag(feature.tags, tag)
    });
    await this.refreshSilent();
  }

  async removeTag(id: string, tag: Tag): Promise<void> {
    const container = await getBrowserContainer();
    const feature = await container.useCases.getFeature(id as never);
    if (!feature) return;
    await container.useCases.saveFeature({
      ...feature,
      tags: removeTag(feature.tags, tag)
    });
    await this.refreshSilent();
  }

  /**
   * Assign the feature to one core feature (or clear it with `null`). Sets a
   * reserved `core:` tag, enforcing at-most-one in a single save.
   */
  async setCore(id: string, value: string | null): Promise<void> {
    const container = await getBrowserContainer();
    const feature = await container.useCases.getFeature(id as never);
    if (!feature) return;
    await container.useCases.saveFeature({
      ...feature,
      tags: setCoreTag(feature.tags, value)
    });
    await this.refreshSilent();
  }

  async remove(id: string): Promise<void> {
    this.summaries = this.summaries.filter((s) => String(s.id) !== String(id));
    const container = await getBrowserContainer();
    await container.useCases.deleteFeature(id as never);
    emit('feature.deleted', { id });
  }

  async loadSamples(): Promise<LoadSamplesResult> {
    const container = await getBrowserContainer();
    const result = await container.useCases.loadSamples();
    await this.refreshSilent();
    await projectsStore.refreshSilent();
    return result;
  }

  async importJson(json: string): Promise<{ id: string; name: string; overwrote: boolean }> {
    const parsed = importFeatureFromJson(json);
    const container = await getBrowserContainer();
    const overwrote = this.summaries.some((s) => s.id === parsed.id);
    const saved = await container.useCases.saveFeature(parsed);
    await this.refreshSilent();
    return { id: saved.id, name: saved.name, overwrote };
  }
}

export const featuresStore = new FeaturesStore();
