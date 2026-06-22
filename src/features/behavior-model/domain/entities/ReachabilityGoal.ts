import type { ReachabilityGoalId } from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';

/**
 * A LIVENESS property — the "something good is (still) achievable" half of
 * verification, complementing invariants (the "nothing bad happens" half).
 * Where an invariant must hold in EVERY reachable state, a reachability goal
 * is about whether a target state can be reached at all:
 *
 *   - `reachable`        — some reachable state satisfies `condition`. Fails
 *     when the goal is impossible within the search bound (e.g. "checkout can
 *     reach `order.placed`" but no action sequence ever gets there — a dead end
 *     in the product, not just in one scenario).
 *   - `always_reachable` — from EVERY reachable state, the goal is still
 *     reachable. Fails when there is a reachable "trap" state from which the
 *     goal can no longer be reached (e.g. a flow that can get permanently stuck
 *     short of completion). This is the classic liveness check.
 *
 * The model checker evaluates these over the reachable state space, so a goal
 * is bounded the same way model_check is: a clean result means "within N steps",
 * not a proof. Feature-level, like featureInvariants — no parameter scope.
 */
export type ReachabilityGoalKind = 'reachable' | 'always_reachable';

export const ALL_REACHABILITY_GOAL_KINDS: readonly ReachabilityGoalKind[] = [
  'reachable',
  'always_reachable'
];

export type ReachabilityGoal = {
  readonly id: ReachabilityGoalId;
  readonly name: string;
  readonly kind: ReachabilityGoalKind;
  readonly condition: RuleCondition;
  /** Mandatory like every authored element; the validator enforces presence. */
  readonly description?: string;
  /** Shown when the goal fails, to explain what should have been reachable. */
  readonly message?: string;
};
