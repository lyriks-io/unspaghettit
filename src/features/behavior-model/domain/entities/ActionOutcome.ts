import type { Effect } from '../value-objects/Effect';
import type { OutcomeId } from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';

/**
 * The terminal results an action can resolve to, beyond the coarse
 * success / blocked status. Real behavior is rarely binary: a charge is
 * declined, a call times out, a job is queued, a batch partially completes.
 *
 * `status` (success | blocked) still answers "did the action run, or did a
 * guard reject it?"; the `kind` here answers "which result did the run resolve
 * to?". A blocked action has no outcome (it never ran); a successful action
 * resolves to exactly one.
 */
export type ActionOutcomeKind =
  | 'success'
  | 'rejected'
  | 'failure'
  | 'timeout'
  | 'cancelled'
  | 'partial'
  | 'pending';

export const ALL_ACTION_OUTCOME_KINDS: readonly ActionOutcomeKind[] = [
  'success',
  'rejected',
  'failure',
  'timeout',
  'cancelled',
  'partial',
  'pending'
];

/**
 * One named result an action can resolve to. Deliberately reuses the vocabulary
 * an author already knows: a `condition` (the same `RuleCondition` as rules and
 * invariants) selects it, and `effects` (the same `Effect` list, which can set
 * state, emit events, or transition) are what happens when it is selected.
 *
 * The simulator evaluates an action's outcomes in order and picks the FIRST
 * whose condition holds against the post-effect snapshot; an outcome with no
 * condition is the catch-all default, so authors put specific results first and
 * a default last. With no outcomes declared an action just succeeds, exactly as
 * before — outcomes are purely additive.
 */
export type ActionOutcome = {
  readonly id: OutcomeId;
  readonly name: string;
  readonly kind: ActionOutcomeKind;
  /** Selects this outcome; first match wins. Omit for the catch-all default. */
  readonly condition?: RuleCondition;
  /** Applied (in order) when this outcome is selected — state, events, transition. */
  readonly effects?: readonly Effect[];
  readonly description?: string;
};
