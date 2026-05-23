import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '../ports/FeatureRepository';

export const getFeatureUseCase = (deps: { repository: FeatureRepository }) => {
  return async (id: FeatureId): Promise<Feature | null> => {
    return deps.repository.get(id);
  };
};
