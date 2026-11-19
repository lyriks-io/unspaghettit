import type { InvariantId } from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';
import type { Disabled } from './Disabled';

export type Invariant = {
  readonly id: InvariantId;
  readonly name: string;
  readonly condition: RuleCondition;
  readonly message: string;
  readonly description?: string;
  /** Set while the element is put aside: kept and readable, left out of every reading. */
  readonly disabled?: Disabled;
};
