import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Tag } from '$shared/domain/Tags';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

export type FeatureSummary = {
  readonly id: FeatureId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly surfaceCount: number;
  readonly actionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface FeatureRepository {
  list(): Promise<readonly FeatureSummary[]>;
  get(id: FeatureId): Promise<Feature | null>;
  save(feature: Feature): Promise<void>;
  delete(id: FeatureId): Promise<void>;
}
