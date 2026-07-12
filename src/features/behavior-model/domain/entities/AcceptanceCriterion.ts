import type { AcceptanceCriterionId } from '../value-objects/ids';

/**
 * A prose acceptance test — the "spec / documentation" facet of a feature, the
 * complement to the structured, model-checked action-level Scenario. Where a
 * Scenario answers "does the simulator prove this branch holds?", an
 * AcceptanceCriterion answers "what must be true for this behavior to be
 * accepted?", in the team's own Given/When/Then prose. Feature-level, like
 * featureInvariants / reachabilityGoals — not attached to a single action.
 *
 * NOT model-checked: `given`/`when`/`then` are free text on purpose (an edge
 * case authored by a human, not a formal assertion). It is rendered, searched,
 * and carried in the model as documentation; the DPO may read it as such. It
 * therefore never affects maturity or verification scores (see MaturityScorer,
 * which is deliberately NOT extended to this field).
 */
export type AcceptanceOutcome = 'success' | 'failure' | 'blocked';

export const ALL_ACCEPTANCE_OUTCOMES: readonly AcceptanceOutcome[] = [
  'success',
  'failure',
  'blocked'
];

export type AcceptanceCriterion = {
  readonly id: AcceptanceCriterionId;
  /** Short human label — the acceptance test's title. Validator requires it. */
  readonly title: string;
  /** Prose precondition. */
  readonly given: string;
  /** Prose trigger. */
  readonly when: string;
  /** Prose expected result. */
  readonly then: string;
  /** Whether the WHEN is expected to succeed, be rejected, or error out. */
  readonly expectedOutcome: AcceptanceOutcome;
  /**
   * Optional link to the surface this criterion is about (e.g. the journey's
   * workflow surface). Deliberately a plain `string`, not a branded SurfaceId:
   * a platform writer may point it at a workflow surface that lives on a
   * sibling ("Experience") feature and won't resolve here, so a dangling ref
   * must never hard-fail. Validation therefore does NOT check it resolves.
   */
  readonly relatedSurfaceId?: string;
  /** Optional free-form note. */
  readonly description?: string;
};
