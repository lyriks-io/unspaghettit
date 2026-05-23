import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { normalizeTags } from '$shared/domain/Tags';

const toSummary = (e: Feature): FeatureSummary => ({
  id: e.id,
  name: e.name,
  description: e.description,
  tags: normalizeTags(e.tags),
  surfaceCount: e.surfaces.length,
  actionCount: e.surfaces.reduce((acc, s) => acc + s.actions.length, 0),
  createdAt: e.createdAt,
  updatedAt: e.updatedAt
});

export class InMemoryFeatureRepository implements FeatureRepository {
  private store = new Map<FeatureId, Feature>();

  async list(): Promise<readonly FeatureSummary[]> {
    return Array.from(this.store.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }

  async get(id: FeatureId): Promise<Feature | null> {
    return this.store.get(id) ?? null;
  }

  async save(feature: Feature): Promise<void> {
    this.store.set(feature.id, feature);
  }

  async delete(id: FeatureId): Promise<void> {
    this.store.delete(id);
  }

  // Test helper. Not part of the port.
  clear(): void {
    this.store.clear();
  }
}
