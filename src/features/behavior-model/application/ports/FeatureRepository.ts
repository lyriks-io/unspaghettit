import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureSummary } from '$features/behavior-model/domain/services/featureSummary';

/**
 * Re-exported so the many callers that import `FeatureSummary` from the port
 * keep working. It is DEFINED in the domain, next to the one function that
 * builds it: a summary is a projection of a Feature, not a property of how a
 * Feature happens to be stored, and the domain builder must not have to import
 * a port to describe its own return type.
 */
export type { FeatureSummary };

export interface FeatureRepository {
  list(): Promise<readonly FeatureSummary[]>;
  get(id: FeatureId): Promise<Feature | null>;
  save(feature: Feature): Promise<void>;
  delete(id: FeatureId): Promise<void>;
}
