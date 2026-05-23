import type { Clock } from '$shared/domain/Clock';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Tag } from '$shared/domain/Tags';
import { normalizeTags } from '$shared/domain/Tags';
import type { FeatureRepository } from '../ports/FeatureRepository';

export type CreateFeatureInput = {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
};

export const createFeatureUseCase = (deps: {
  repository: FeatureRepository;
  ids: IdGenerator;
  clock: Clock;
}) => {
  return async (input: CreateFeatureInput): Promise<Feature> => {
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Feature name is required');
    }
    const trimmedDescription = input.description?.trim() ?? '';
    if (trimmedDescription.length === 0) {
      throw new Error('Feature description is required');
    }
    const now = deps.clock();
    const feature: Feature = {
      id: asFeatureId(deps.ids()),
      name: trimmedName,
      description: trimmedDescription,
      ...(normalizeTags(input.tags) ? { tags: normalizeTags(input.tags) } : {}),
      surfaces: [],
      personas: [],
      resources: [],
      entities: [],
      events: [],
      createdAt: now,
      updatedAt: now
    };
    await deps.repository.save(feature);
    return feature;
  };
};
