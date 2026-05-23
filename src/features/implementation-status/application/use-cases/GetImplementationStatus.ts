import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';

export const getImplementationStatusUseCase =
  (deps: { readonly statuses: ImplementationStatusRepository }) =>
  async (featureId: FeatureId): Promise<ImplementationStatus | null> =>
    deps.statuses.get(featureId);
