import type { Feature } from '../../entities/Feature';
import type { ValidationResult } from './shared';
import { validateFeature } from './featureShape';
import { validateReferenceIntegrity } from './referenceIntegrity';

/** The `after` errors that were not already present in `before`. */
const errorsNotIn = (
  before: ValidationResult,
  after: ValidationResult
): readonly string[] => {
  if (after.valid) return [];
  const baseline = before.valid ? new Set<string>() : new Set(before.errors);
  return after.errors.filter((e) => !baseline.has(e));
};

/**
 * Diff-aware write gate. Returns the structural + reference-integrity errors
 * that `next` has but `current` did NOT — i.e. the errors the change would
 * *introduce*. Empty result ⇒ the write is allowed.
 *
 * Why diff-aware: a feature is built incrementally and is frequently in a
 * partially-valid state (most often: descriptions not filled in yet). The old
 * all-or-nothing structural gate meant any pre-existing error — even an
 * unrelated missing description elsewhere — blocked the next write, so you
 * literally could not *set* a description without the whole feature already
 * being valid. With this gate, pre-existing problems stay editable (and remain
 * visible via `score_feature` / `get_spec_gaps`); only NEW breakage is blocked.
 * This mirrors the reference-integrity stance that already shipped, now
 * extended to structural checks too.
 *
 * Pass `current: null` for a brand-new feature (no prior snapshot): every error
 * counts as introduced, so wholesale authoring still has to be valid.
 *
 * NOTE on normalization: callers must pass `current` at the SAME normalization
 * level they apply to `next` (e.g. both through normalizeFeatureExpressions),
 * otherwise normalization artifacts on untouched elements could read as
 * "introduced". Snapshots loaded from the repo are already normalized, so
 * re-normalizing the baseline is idempotent.
 */
export const introducedValidationErrors = (
  current: Feature | null,
  next: Feature
): readonly string[] => {
  const noErrors: ValidationResult = { valid: true };
  const newStructural = errorsNotIn(
    current ? validateFeature(current) : noErrors,
    validateFeature(next)
  );
  const newRefs = errorsNotIn(
    current ? validateReferenceIntegrity(current) : noErrors,
    validateReferenceIntegrity(next)
  );
  return [...newStructural, ...newRefs];
};
