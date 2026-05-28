import type { ParameterId, ResourceId, ValueSetId } from '../value-objects/ids';
import type { ParameterType } from '../value-objects/ParameterType';
import type { ParameterValidation } from '../value-objects/ParameterValidation';
import type { StatePath } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

export type Parameter = {
  readonly id: ParameterId;
  readonly name: string;
  readonly type: ParameterType;
  readonly required: boolean;
  readonly description?: string;
  readonly enumValues?: readonly string[];
  /**
   * For type=enum: reference a named ValueSet on the feature instead of
   * inlining `enumValues`. Mutually exclusive with `enumValues`. Effective
   * allowed values resolve via `effectiveEnumValues(param, feature.valueSets)`.
   */
  readonly valueSetId?: ValueSetId;
  readonly defaultValue?: StateValue;
  /**
   * Zod-style validators applied at parameter-validation time, before rules
   * evaluate. A failure produces a `parameterError` and the simulation
   * status becomes `failed`.
   */
  readonly validations?: readonly ParameterValidation[];
  /**
   * Optional state path the parameter writes into when the action runs.
   * Applied to the snapshot before rules evaluate, so rules can read the
   * bound value.
   */
  readonly bindToStatePath?: StatePath;
  /**
   * Optional pointer to a Resource defined on the feature. Captures where
   * the parameter's value comes from / will be persisted to (e.g. Postgres
   * users.email column). Used for compliance, residency, and AI builder
   * context. Does not affect simulation.
   */
  readonly resourceId?: ResourceId;
};
