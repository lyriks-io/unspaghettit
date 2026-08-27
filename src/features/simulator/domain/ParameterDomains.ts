import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { ValueSet } from '$features/behavior-model/domain/entities/ValueSet';
import { effectiveEnumValues } from '$features/behavior-model/domain/services/EnumValues';
import { fillDefaults, type ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import {
  flattenLeafConditions,
  isParamLeft,
  type LeftOperand,
  type RuleCondition
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';

/**
 * Bounded model checking used to fire every action with a SINGLE parameter set
 * (the defaults) and skip any action whose required parameter had no default —
 * so it never explored the branches a param value gates, and under-counted what
 * it covered. This derives, for each action, a small set of parameter value
 * combinations drawn from each parameter's DOMAIN:
 *
 *   - boolean  -> [true, false]
 *   - enum     -> every allowed value (inline or from a value set)
 *   - number   -> its min / max validation bounds and default, plus boundary
 *                 values (T-1, T, T+1) mined from every numeric threshold an
 *                 in-scope rule or invariant compares it against, so a guard like
 *                 `amount >= 500` gets both branches explored. A required number
 *                 that nothing bounds or references stays honestly "not explored".
 *   - other    -> its default; a REQUIRED one with no default has no enumerable
 *                 domain (we cannot invent a meaningful email / free-form
 *                 string), so the action stays honestly "not explored".
 *
 * The cartesian product is capped so a wide action can't explode the search;
 * when capped, the caller marks the run truncated so a green result is never
 * mistaken for exhaustive.
 */
export type ParameterCombinations = {
  /** False when a required parameter has no enumerable domain — the action is skipped. */
  readonly explorable: boolean;
  readonly reason?: string;
  /** Parameter value maps to simulate the action with. Empty when not explorable. */
  readonly combos: readonly ParameterValues[];
  /** True when the full product exceeded the cap and only a sample is returned. */
  readonly capped: boolean;
};

export const DEFAULT_MAX_COMBOS = 12;

/**
 * The conditions whose numeric leaves are mined for a number parameter's
 * boundary values. Action rules are always in scope (threaded from the action
 * itself); surface rules / invariants and feature invariants are added by the
 * caller when available — they can only gate a parameter via the state path it
 * writes to (`bindToStatePath`), since they have no parameters in scope.
 */
export type ThresholdContext = {
  /** Rules on the surface hosting the action. */
  readonly surfaceRules?: readonly Rule[];
  /** Invariants on that surface. */
  readonly surfaceInvariants?: readonly Invariant[];
  /** Feature-level invariants. */
  readonly featureInvariants?: readonly Invariant[];
};

// A condition leaf references THIS parameter when its left operand is either the
// parameter itself (`{kind:'param'}`, only legal on action rules) or the state
// path the parameter writes to (`left === bindToStatePath`, the only route open
// to surface rules / invariants, which have no parameters in scope).
const leafReferencesParameter = (left: LeftOperand, parameter: Parameter): boolean =>
  isParamLeft(left)
    ? left.name === parameter.name
    : parameter.bindToStatePath !== undefined && left === parameter.bindToStatePath;

// A numeric threshold from a leaf's `right`, which may be a raw number or a
// `{ kind:'literal', value:<number> }` expression node. Anything else yields
// undefined (no threshold to mine).
const numericThreshold = (right: unknown): number | undefined => {
  if (typeof right === 'number') return right;
  if (right !== null && typeof right === 'object') {
    const node = right as { kind?: unknown; value?: unknown };
    if (node.kind === 'literal' && typeof node.value === 'number') return node.value;
  }
  return undefined;
};

// Boundary values mined from every numeric threshold the in-scope conditions
// compare this parameter against. For each threshold T we add T-1, T, T+1 so
// both sides of every >/>=/</<=/== guard get exercised — e.g. a rule
// `amount >= 500` yields 499 and 500, letting the explorer take either branch.
const conditionThresholds = (
  parameter: Parameter,
  conditions: readonly (RuleCondition | undefined)[]
): readonly number[] => {
  const out: number[] = [];
  for (const condition of conditions) {
    for (const leaf of flattenLeafConditions(condition)) {
      if (!leafReferencesParameter(leaf.left, parameter)) continue;
      const threshold = numericThreshold(leaf.right);
      if (threshold === undefined) continue;
      out.push(threshold - 1, threshold, threshold + 1);
    }
  }
  return out;
};

// Boundary values for a number parameter: its min/max validation bounds, its
// default, and the thresholds any in-scope rule/invariant references (see
// conditionThresholds). Empty when the parameter is unbounded, has no default,
// and no condition references it — an arbitrary sample would give false
// confidence, so such a required number stays honestly "not explored".
const numberSamples = (
  parameter: Parameter,
  conditions: readonly (RuleCondition | undefined)[]
): readonly number[] => {
  const bounds: number[] = [];
  for (const validation of parameter.validations ?? []) {
    if (validation.type === 'min' || validation.type === 'max') bounds.push(validation.value);
  }
  if (typeof parameter.defaultValue === 'number') bounds.push(parameter.defaultValue);
  bounds.push(...conditionThresholds(parameter, conditions));
  return [...new Set(bounds)];
};

/**
 * The values to try for one parameter, or `'unbounded'` when it is required and
 * has no enumerable domain (which makes the whole action unexplorable).
 */
const parameterValues = (
  parameter: Parameter,
  valueSets: readonly ValueSet[] | undefined,
  conditions: readonly (RuleCondition | undefined)[]
): readonly StateValue[] | 'unbounded' => {
  if (parameter.type === 'boolean') return [true, false];
  if (parameter.type === 'enum') {
    const allowed = effectiveEnumValues(parameter, valueSets);
    if (allowed && allowed.length > 0) return allowed;
    if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
    return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
  }
  if (parameter.type === 'number') {
    const samples = numberSamples(parameter, conditions);
    if (samples.length > 0) return samples;
    return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
  }
  // Collections have a canonical boundary value the way booleans do: the
  // empty collection. Before this, a required array/object parameter without
  // a default made the WHOLE action unexplorable ("the explorer cannot invent
  // a value"), which read as "the engine cannot model-check lists". Rules
  // that need a non-empty sample still deserve an explicit defaultValue.
  if (parameter.type === 'array') {
    if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
    return parameter.required ? [[] as StateValue] : [undefined as unknown as StateValue];
  }
  if (parameter.type === 'object') {
    if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
    return parameter.required ? [{} as StateValue] : [undefined as unknown as StateValue];
  }
  if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
  return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
};

export const parameterCombinations = (
  action: Action,
  valueSets: readonly ValueSet[] | undefined,
  maxCombos: number = DEFAULT_MAX_COMBOS,
  context?: ThresholdContext
): ParameterCombinations => {
  // Conditions whose numeric leaves are mined for number-parameter boundaries.
  // Action rules are always in scope; surface rules / invariants and feature
  // invariants are added when the caller supplies them.
  const conditions: readonly (RuleCondition | undefined)[] = [
    ...action.rules.map((rule) => rule.condition),
    ...(context?.surfaceRules ?? []).map((rule) => rule.condition),
    ...(context?.surfaceInvariants ?? []).map((invariant) => invariant.condition),
    ...(context?.featureInvariants ?? []).map((invariant) => invariant.condition)
  ];

  const perParameter: (readonly StateValue[])[] = [];
  for (const parameter of action.parameters) {
    const values = parameterValues(parameter, valueSets, conditions);
    if (values === 'unbounded') {
      return {
        explorable: false,
        reason: `required ${parameter.type} parameter "${parameter.name}" has no default and no enumerable domain; the explorer cannot invent a value`,
        combos: [],
        capped: false
      };
    }
    perParameter.push(values);
  }

  const total = perParameter.reduce((acc, values) => acc * Math.max(1, values.length), 1);
  const capped = total > maxCombos;

  // Cartesian product, stopping once we hit the cap. The prefix we keep is a
  // deterministic sample of the full grid.
  let raw: Record<string, StateValue>[] = [{}];
  for (let i = 0; i < action.parameters.length; i++) {
    const parameter = action.parameters[i]!;
    const values = perParameter[i]!;
    const next: Record<string, StateValue>[] = [];
    for (const base of raw) {
      for (const value of values) {
        next.push({ ...base, [parameter.name]: value });
        if (next.length >= maxCombos) break;
      }
      if (next.length >= maxCombos) break;
    }
    raw = next;
  }
  if (raw.length === 0) raw = [{}];

  // Drop undefined entries (unset optional params) so fillDefaults keeps the
  // parameter absent rather than overriding a default with undefined.
  const combos = raw.map((combo) =>
    fillDefaults(
      action.parameters,
      Object.fromEntries(Object.entries(combo).filter(([, value]) => value !== undefined))
    )
  );

  return { explorable: true, combos, capped };
};
