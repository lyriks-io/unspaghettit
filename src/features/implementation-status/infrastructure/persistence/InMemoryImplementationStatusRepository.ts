import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';

export class InMemoryImplementationStatusRepository
  implements ImplementationStatusRepository
{
  private readonly byId = new Map<string, ImplementationStatus>();

  async get(id: FeatureId): Promise<ImplementationStatus | null> {
    return this.byId.get(String(id)) ?? null;
  }

  async save(status: ImplementationStatus): Promise<void> {
    this.byId.set(String(status.featureId), status);
  }

  async delete(id: FeatureId): Promise<void> {
    this.byId.delete(String(id));
  }
}
