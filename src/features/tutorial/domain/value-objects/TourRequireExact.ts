import type { TourFormId } from './TourFormId';

/**
 * Hard requirement that a specific form's name input must equal `value`
 * before its submit button is enabled. Forms opt in by consulting
 * `evaluateTourSubmitGuard(currentStep, this-form-id, current-value)`
 * and folding the result into their existing `disabled` binding.
 *
 * `formId` namespaces which form should respond — only one form per
 * step. Other forms keep their normal behavior.
 */
export type TourRequireExact = {
  readonly formId: TourFormId;
  readonly value: string;
};
