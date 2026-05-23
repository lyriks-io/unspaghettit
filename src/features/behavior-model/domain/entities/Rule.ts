import type { Effect } from '../value-objects/Effect';
import type { RuleId } from '../value-objects/ids';
import type { RuleCategory } from '../value-objects/RuleCategory';
import type { RuleCondition } from '../value-objects/RuleCondition';

export type Rule = {
  readonly id: RuleId;
  readonly category: RuleCategory;
  /**
   * Omit to make the rule fire unconditionally. Useful for "always run
   * this side-effect when the action fires", for example, reset stale
   * mode-specific totals when the user switches split mode. Equivalent
   * to a condition that always evaluates true.
   */
  readonly condition?: RuleCondition;
  readonly effect: Effect;
  readonly description?: string;
};
