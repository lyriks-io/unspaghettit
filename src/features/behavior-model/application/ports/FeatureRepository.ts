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
  /**
   * Every full feature in ONE pass. Optional: a store that can read all its
   * records cheaper than one `get` per id offers it, and callers that need many
   * features go through `listAllFeatures` / `loadFeaturesByIds`
   * (application/services/bulkRead), which fall back to `list` + `get`.
   *
   * The reason it exists: a folder store re-reads the whole folder on every
   * `get`, so a loop of N gets costs N times the folder, and a tool that needs a
   * project's features paid that on every call.
   */
  listFull?(): Promise<readonly Feature[]>;
}
