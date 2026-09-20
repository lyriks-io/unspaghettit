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

/**
 * Where a criterion stands in the life of the spec. Absent means `active`.
 *
 *  - `active`: it describes what the product must do today.
 *  - `superseded`: a later decision replaced it. Kept, because the history of a
 *    behavior is part of its specification, but it must never read as current.
 *  - `draft`: proposed, not yet agreed. It supersedes nothing until it is active.
 *
 * Authors set it; nothing in the engine flips it for them. What the engine does
 * is compute, on every read, who supersedes whom (see `CriterionStanding`), so a
 * criterion that was replaced without being marked says so.
 */
export type CriterionStatus = 'active' | 'superseded' | 'draft';

export const ALL_CRITERION_STATUSES: readonly CriterionStatus[] = [
  'active',
  'superseded',
  'draft'
];

/**
 * How one criterion relates to another.
 *
 *  - `supersedes`: this one replaces the other.
 *  - `refines`: this one narrows or details the other, which still holds.
 *  - `exception_to`: this one carves a case out of the other, which still holds
 *    everywhere else.
 */
export type CriterionRelationKind = 'supersedes' | 'refines' | 'exception_to';

export const ALL_CRITERION_RELATION_KINDS: readonly CriterionRelationKind[] = [
  'supersedes',
  'refines',
  'exception_to'
];

export type CriterionRelation = {
  readonly kind: CriterionRelationKind;
  /** The criterion this one relates to. Resolved in this feature unless `featureId` names another. */
  readonly criterionId: string;
  /**
   * Set when the target lives in ANOTHER feature. The link is then carried but
   * not resolved, for the same reason `relatedSurfaceId` is not: this feature
   * is validated on its own and cannot see its siblings.
   */
  readonly featureId?: string;
  /** Why, in the team's words ("shallow water is audible again since the reef level"). */
  readonly note?: string;
};

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
  /**
   * Where the criterion stands. See {@link CriterionStatus}. Optional: absent
   * means `active`, so a criterion written before this field reads as it did.
   */
  readonly status?: CriterionStatus;
  /**
   * What this criterion supersedes, refines or is an exception to. Optional;
   * absent and empty mean the same. Like everything on a criterion it is
   * documentation: it never affects maturity or any verification score (the
   * MaturityScorer does not read criteria at all).
   */
  readonly relations?: readonly CriterionRelation[];
};
