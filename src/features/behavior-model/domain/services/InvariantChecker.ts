import type { Invariant } from '../entities/Invariant';
import type { InvariantId } from '../value-objects/ids';
import type { StateSnapshot } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';
import { evaluateCondition } from './RuleEvaluator';

export type InvariantViolation = {
  readonly invariantId: InvariantId;
  readonly invariantName: string;
  readonly message: string;
};

export const checkInvariants = (
  invariants: readonly Invariant[],
  snapshot: StateSnapshot,
  parameters: { readonly [name: string]: StateValue } = {}
): readonly InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  for (const invariant of invariants) {
    const holds = evaluateCondition(invariant.condition, snapshot, parameters);
    if (!holds) {
      violations.push({
        invariantId: invariant.id,
        invariantName: invariant.name,
        message: invariant.message
      });
    }
  }
  return violations;
};
