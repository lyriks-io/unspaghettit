import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '../ports/FeatureRepository';

export const deleteFeatureUseCase = (deps: { repository: FeatureRepository }) => {
  return async (id: FeatureId): Promise<void> => {
    await deps.repository.delete(id);
  };
};
