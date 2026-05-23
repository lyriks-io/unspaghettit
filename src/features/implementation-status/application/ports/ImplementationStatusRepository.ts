import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';

export interface ImplementationStatusRepository {
  get(id: FeatureId): Promise<ImplementationStatus | null>;
  save(status: ImplementationStatus): Promise<void>;
  delete(id: FeatureId): Promise<void>;
}
