import type { Clock } from '$shared/domain/Clock';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { introducedValidationErrors } from '$features/behavior-model/domain/services/FeatureValidator';
import type { FeatureRepository } from '../ports/FeatureRepository';
import { FeatureValidationError } from './MutateFeature';

export const saveFeatureUseCase = (deps: {
  repository: FeatureRepository;
  clock: Clock;
}) => {
  return async (feature: Feature): Promise<Feature> => {
    // Same diff-aware gate as `mutateFeatureUseCase`: a full-replace save is
    // blocked only when it INTRODUCES a new error versus the prior snapshot, so
    // the editor can save edits to a partially-built feature without every
    // not-yet-filled description blocking the write. A brand-new feature (no
    // prior) must be fully valid. Still catches the regression this gate was
    // added for — a newly mistyped default (e.g. `"365"` for type=number) is
    // "introduced" and rejected.
    const prior = await deps.repository.get(feature.id);
    const introduced = introducedValidationErrors(prior, feature);
    if (introduced.length > 0) {
      throw new FeatureValidationError(
        'Cannot save: the change would introduce new validation errors.',
        introduced
      );
    }
    const next: Feature = { ...feature, updatedAt: deps.clock() };
    await deps.repository.save(next);
    return next;
  };
};
