import type { Clock } from '$shared/domain/Clock';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { validateFeature } from '$features/behavior-model/domain/services/FeatureValidator';
import type { FeatureRepository } from '../ports/FeatureRepository';
import { FeatureValidationError } from './MutateFeature';

export const saveFeatureUseCase = (deps: {
  repository: FeatureRepository;
  clock: Clock;
}) => {
  return async (feature: Feature): Promise<Feature> => {
    // Same gate as `mutateFeatureUseCase`: structural integrity must hold
    // before we let an feature reach disk. The editor's full-replace save
    // path used to skip this and was the channel through which mistyped
    // defaults (e.g. `"365"` for type=number) sneaked into snapshots.
    const validation = validateFeature(feature);
    if (!validation.valid) {
      throw new FeatureValidationError(
        'Cannot save invalid feature.',
        validation.errors
      );
    }
    const next: Feature = { ...feature, updatedAt: deps.clock() };
    await deps.repository.save(next);
    return next;
  };
};
