import {
  evaluateConditionInternal,
  type EvaluationContext
} from '../value-objects/Expression';
import type { StateSnapshot } from '../value-objects/StatePath';
import type { RuleCondition } from '../value-objects/RuleCondition';

export type ParameterContext = EvaluationContext['parameters'];
export type ConstantContext = NonNullable<EvaluationContext['constants']>;

const EMPTY_PARAMETERS: ParameterContext = {};
const EMPTY_CONSTANTS: ConstantContext = {};

/**
 * Evaluate a condition. `parameters` is optional so existing call-sites
 * (tests, ad-hoc checks) keep compiling; when present, conditions on the
 * right side can reference parameter values via `{ kind: 'param', name }`
 * inside an Expression.
 *
 * A `null` / `undefined` condition evaluates to TRUE, supports the
 * "unconditional rule" pattern. Invariants do NOT use this path: they
 * require a condition and the validator enforces that.
 *
 * Composite conditions (`all` / `any` / `not`) recurse. Implementation
 * lives in `Expression.ts` (`evaluateConditionInternal`) so the `switch`
 * Expression node can reuse it without a module cycle; this file is a
 * thin re-export for backward-compatible call sites.
 */
export const evaluateCondition = (
  condition: RuleCondition | undefined | null,
  snapshot: StateSnapshot,
  parameters: ParameterContext = EMPTY_PARAMETERS,
  constants: ConstantContext = EMPTY_CONSTANTS
): boolean => evaluateConditionInternal(condition, { snapshot, parameters, constants });
