import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import { operativeFeature } from '$features/behavior-model/domain/services/DisabledElements';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

/**
 * The model as every reading takes it: each feature comes out without its
 * disabled elements (see DisabledElements.operativeFeature). Wrapping the
 * repository, like the project library does, is what makes the filter total:
 * the simulation, the scenarios, the model check, the proofs, the maturity and
 * the spec gaps load their features here, so none of them can forget it.
 *
 * Read-only on purpose. A write goes through the full model, or it would save
 * a feature stripped of what was only put aside.
 */
export class OperativeFeatureRepository implements FeatureRepository {
  constructor(private readonly inner: FeatureRepository) {}

  list(): Promise<readonly FeatureSummary[]> {
    return this.inner.list();
  }

  async get(id: FeatureId): Promise<Feature | null> {
    const feature = await this.inner.get(id);
    return feature ? operativeFeature(feature) : null;
  }

  async listFull(): Promise<readonly Feature[]> {
    const all = this.inner.listFull
      ? await this.inner.listFull()
      : (
          await Promise.all((await this.inner.list()).map((s) => this.inner.get(s.id)))
        ).filter((f): f is Feature => f !== null);
    return all.map(operativeFeature);
  }

  save(): Promise<void> {
    return Promise.reject(new Error('The operative model is read-only: write through the full model.'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('The operative model is read-only: write through the full model.'));
  }
}

/** The operative view of a repository, for the readings. */
export const operativeRepository = (inner: FeatureRepository): FeatureRepository =>
  new OperativeFeatureRepository(inner);
