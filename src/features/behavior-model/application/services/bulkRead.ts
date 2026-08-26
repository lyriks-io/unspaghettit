import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

/**
 * Every full feature, in one store pass when the repository offers `listFull`,
 * else `list` + one `get` per id. Callers never need to know which.
 */
export const listAllFeatures = async (repo: FeatureRepository): Promise<readonly Feature[]> => {
  if (repo.listFull) return repo.listFull();
  const out: Feature[] = [];
  for (const summary of await repo.list()) {
    const feature = await repo.get(summary.id);
    if (feature) out.push(feature);
  }
  return out;
};

/**
 * The features named by `ids`, in that order, `null` where an id resolves to
 * nothing. One store pass for several ids, a plain `get` for a single one.
 */
export const loadFeaturesByIds = async (
  repo: FeatureRepository,
  ids: readonly (FeatureId | string)[]
): Promise<readonly (Feature | null)[]> => {
  if (ids.length === 0) return [];
  if (ids.length === 1 || !repo.listFull) {
    return Promise.all(ids.map((id) => repo.get(id as FeatureId)));
  }
  const byId = new Map<string, Feature>();
  for (const feature of await repo.listFull()) byId.set(String(feature.id), feature);
  return ids.map((id) => byId.get(String(id)) ?? null);
};
