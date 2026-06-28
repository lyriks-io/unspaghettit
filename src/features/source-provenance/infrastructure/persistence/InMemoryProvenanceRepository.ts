import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Provenance } from '$features/source-provenance/domain/Provenance';
import type { ProvenanceRepository } from '$features/source-provenance/application/ports/ProvenanceRepository';

export class InMemoryProvenanceRepository implements ProvenanceRepository {
  private readonly byId = new Map<string, Provenance>();

  async get(id: FeatureId): Promise<Provenance | null> {
    return this.byId.get(String(id)) ?? null;
  }

  async save(provenance: Provenance): Promise<void> {
    this.byId.set(String(provenance.featureId), provenance);
  }

  async delete(id: FeatureId): Promise<void> {
    this.byId.delete(String(id));
  }
}
