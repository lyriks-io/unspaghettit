import type { ConstantId } from '../value-objects/ids';
import type { StateValue } from '../value-objects/StateValue';

/**
 * A named, reusable value declared once at the feature level and referenced
 * from anywhere an Expression is accepted via `{ kind: 'const', name }`
 * (a rule's `right`, a `set_state.value`, a derived state formula, an
 * invariant's threshold…).
 *
 * The motivation is DRY inside the spec: a threshold like a life-ladder gate
 * or an era cutoff is authored ONCE here instead of being copy-pasted into
 * every rule and invariant that compares against it — which is exactly how
 * those literals drift out of sync (and out of sync with the code constant
 * that implements them). Change the number here and every reference follows.
 *
 * Distinct from a StateDefinition: a constant never changes during a run
 * (no effect can write it) and has no default/derived machinery. Distinct
 * from a ValueSet: a ValueSet is a set of allowed enum *strings*; a Constant
 * is a single scalar/array value used in comparisons and arithmetic.
 */
export type Constant = {
  readonly id: ConstantId;
  /**
   * The stable identifier expressions reference via `{ kind: 'const', name }`.
   * Unique within the feature. Prefer a short lowerCamelCase noun
   * (e.g. `plantsOxygen`, `eraCutoffYear`).
   */
  readonly name: string;
  /** The value substituted at evaluation time. Any StateValue (number, string, boolean, array…). */
  readonly value: StateValue;
  readonly description: string;
};
