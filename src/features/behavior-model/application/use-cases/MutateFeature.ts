import type { Clock } from '$shared/domain/Clock';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { normalizeFeatureEmittedEvents } from '$features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { normalizeFeatureExpressions } from '$features/behavior-model/domain/services/FeatureExpressionNormalizer';
import { normalizeFeatureSharedState } from '$features/behavior-model/domain/services/FeatureSharedStateNormalizer';
import {
  validateFeature,
  validateReferenceIntegrity
} from '$features/behavior-model/domain/services/FeatureValidator';
import type { FeatureRepository } from '../ports/FeatureRepository';

export type FeatureTransform = (feature: Feature) => Feature;

export class FeatureValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: readonly string[]
  ) {
    super(message);
    this.name = 'FeatureValidationError';
  }
}

export class FeatureNotFoundError extends Error {
  constructor(featureId: string) {
    super(`Feature ${featureId} not found`);
    this.name = 'FeatureNotFoundError';
  }
}

/**
 * Generic mutate-then-save use case. Loads an feature by id, applies a
 * pure transform, validates the result for structural integrity, then
 * persists it. Used by every granular MCP write tool so they share one
 * load/validate/save loop.
 *
 * Throws `FeatureNotFoundError` if no feature matches the id, or
 * `FeatureValidationError` if the transformed feature fails
 * structural validation. Either error must be surfaced to the caller; the
 * snapshot is left untouched in both cases.
 */
export const mutateFeatureUseCase = (deps: {
  repository: FeatureRepository;
  clock: Clock;
}) => {
  return async (input: {
    featureId: FeatureId;
    transform: FeatureTransform;
  }): Promise<Feature> => {
    const current = await deps.repository.get(input.featureId);
    if (!current) throw new FeatureNotFoundError(input.featureId);

    // Normalize Expression trees before validation so downstream consumers
    // (validators, scorer, evaluator) can assume well-formed children. JSON
    // authoring lets raw scalars land inside Expression bodies where the type
    // demands an Expression node; this rewrites them as {kind:"literal",value}.
    // Then mirror every emit_event effect into action.emittedEvents so the
    // scorer's "event declarations" check passes without forcing an extra
    // update_action op from the caller.
    // Rule-category normalization runs ONLY at import (FeatureJson) and on
    // save_feature, not on writes. That way `category: "permission"` from
    // the LLM hits the strict validator and gets a "did you mean..." error
    // instead of being silently remapped, fresh authoring learns the
    // canonical vocabulary on the next call. Legacy snapshots still load.
    const transformed = normalizeFeatureSharedState(
      normalizeFeatureEmittedEvents(
        normalizeFeatureExpressions(input.transform(current))
      )
    );
    const validation = validateFeature(transformed);
    if (!validation.valid) {
      throw new FeatureValidationError(
        'Feature would be invalid after the requested change.',
        validation.errors
      );
    }

    // Reference-integrity errors are enforced diff-aware: an error already
    // present on the loaded snapshot stays editable (so legacy data with
    // dangling refs isn't bricked), but a mutation cannot introduce a *new*
    // dangling reference. Same error string before and after = the
    // mutation didn't touch it.
    const beforeRefs = validateReferenceIntegrity(current);
    const afterRefs = validateReferenceIntegrity(transformed);
    if (!afterRefs.valid) {
      const baseline = beforeRefs.valid ? new Set<string>() : new Set(beforeRefs.errors);
      const introduced = afterRefs.errors.filter((e) => !baseline.has(e));
      if (introduced.length > 0) {
        throw new FeatureValidationError(
          'Feature would contain new dangling references after the requested change.',
          introduced
        );
      }
    }

    const next: Feature = { ...transformed, updatedAt: deps.clock() };
    await deps.repository.save(next);
    return next;
  };
};
