import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Provenance } from '$features/source-provenance/domain/Provenance';

export interface ProvenanceRepository {
  get(id: FeatureId): Promise<Provenance | null>;
  save(provenance: Provenance): Promise<void>;
  delete(id: FeatureId): Promise<void>;
}
