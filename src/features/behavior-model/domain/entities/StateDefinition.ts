import type { Expression } from '../value-objects/Expression';
import type { StateDefinitionId, SurfaceId, ValueSetId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';
import type { StateType, StateValue } from '../value-objects/StateValue';
import type { StateVariableId } from '$features/projects/domain/value-objects/ids';

export type StateDefinition = {
  readonly id: StateDefinitionId;
  /** Stable project identity when this definition is a surface projection. */
  readonly stateVariableId?: StateVariableId;
  readonly path: StatePath;
  readonly type: StateType;
  readonly defaultValue: StateValue;
  /**
   * When present, this path is COMPUTED, not authored. The engine recomputes it
   * from this Expression after every mutation, so a value like `cart.subtotal`
   * stays correct without every action remembering to re-`set_state` it (the
   * "forgot to recompute, invariant Σ now broken" bug class). Derived paths are
   * read-only: the validator rejects effects that try to write them, and any
   * stray write is immediately overwritten by the next recompute. `defaultValue`
   * is still required and serves as the value before the first compute / when
   * the expression can't be evaluated (missing operand). A derived expression
   * may reference other derived paths; recomputation iterates to a fixpoint.
   */
  readonly derived?: Expression;
  readonly enumValues?: readonly string[];
  /**
   * For type=enum: reference a named ValueSet on the feature instead of
   * inlining `enumValues`. Mutually exclusive with `enumValues` (the validator
   * rejects setting both). Effective allowed values resolve via
   * `effectiveEnumValues(def, feature.valueSets)`.
   */
  readonly valueSetId?: ValueSetId;
  readonly description?: string;
  /**
   * Surfaces (other than the owning surface) that also read or write this
   * state path. Declarative only. The runtime already accesses any path
   * across surfaces because the snapshot is global. But the dashboard uses
   * it to render the spec-vs-code diff honestly and to flag dangling refs
   * when a sharing surface is deleted. Empty/absent means "this surface
   * only".
   */
  readonly sharedWith?: readonly SurfaceId[];
};
