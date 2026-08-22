import type { Clock } from '$shared/domain/Clock';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { normalizeFeatureEmittedEvents } from '$features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { normalizeFeatureExpressions } from '$features/behavior-model/domain/services/FeatureExpressionNormalizer';
import { normalizeFeatureSharedState } from '$features/behavior-model/domain/services/FeatureSharedStateNormalizer';
import { introducedValidationErrors } from '$features/behavior-model/domain/services/FeatureValidator';
import { stampElementVersions } from '$features/behavior-model/domain/services/FeatureElementVersions';
import type { FeatureRepository } from '../ports/FeatureRepository';

/** The shared normalization pipeline applied before validation + save. */
const normalizeForSave = (feature: Feature): Feature =>
  normalizeFeatureSharedState(
    normalizeFeatureEmittedEvents(normalizeFeatureExpressions(feature))
  );

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
    const transformed = normalizeForSave(input.transform(current));

    // Diff-aware gate (both structural AND reference-integrity): block the
    // write only when it INTRODUCES a new error. Pre-existing problems on a
    // partially-built feature — most commonly descriptions not yet filled in —
    // stay editable, so you can set a description (or any field) without the
    // whole feature already being valid. The baseline is normalized the same
    // way as `transformed` so normalization artifacts on untouched elements
    // don't read as introduced. See introducedValidationErrors for the why.
    const introduced = introducedValidationErrors(normalizeForSave(current), transformed);
    if (introduced.length > 0) {
      throw new FeatureValidationError(
        'The requested change would introduce new validation errors. (Pre-existing issues elsewhere in the feature are not blocking — fix them whenever; they show up in get_spec_gaps / score_feature.)',
        introduced
      );
    }

    // Stamp the elements this write actually changed, so drift can name them
    // instead of implicating the whole feature. See FeatureElementVersions.
    const now = deps.clock();
    const next: Feature = stampElementVersions(current, { ...transformed, updatedAt: now }, now);
    await deps.repository.save(next);
    return next;
  };
};
