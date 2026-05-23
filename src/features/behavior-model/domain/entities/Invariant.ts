import type { InvariantId } from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';

export type Invariant = {
  readonly id: InvariantId;
  readonly name: string;
  readonly condition: RuleCondition;
  readonly message: string;
  readonly description?: string;
};
