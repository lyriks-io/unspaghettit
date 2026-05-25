import type { TourStep } from '../entities/TourStep';
import type { TourFormId } from '../value-objects/TourFormId';
import { isNameMatch } from './NameMatch';

/**
 * Pure verdict on whether the tour's current step blocks a given form's
 * submit. Held in the domain layer so the predicate is unit-testable
 * without Svelte, the DOM, or the live tour store — the form components
 * thread their current input value in and read `blocked` straight on the
 * disabled binding.
 *
 * `blocked: true` ALWAYS implies `requiredValue !== null`; the type is
 * kept loose because the no-constraint case returns `requiredValue: null`
 * too.
 */
export type SubmitGuardVerdict = {
  readonly blocked: boolean;
  readonly requiredValue: string | null;
};

/**
 * For a given form, decide whether the current tour step keeps submit
 * blocked. The check is:
 *   1. There IS an active step that declares `requireExact`.
 *   2. The declaration targets this exact `formId`.
 *   3. The user's typed value (per `isNameMatch`) does NOT equal the
 *      required value.
 *
 * Name comparison is delegated to `isNameMatch` so the guard and the
 * tour-step advance matchers agree on what "exact name" means.
 */
export const evaluateTourSubmitGuard = (
  step: TourStep | null,
  formId: TourFormId,
  currentValue: string
): SubmitGuardVerdict => {
  const req = step?.requireExact;
  if (!req || req.formId !== formId) {
    return { blocked: false, requiredValue: null };
  }
  return {
    blocked: !isNameMatch(currentValue, req.value),
    requiredValue: req.value
  };
};
