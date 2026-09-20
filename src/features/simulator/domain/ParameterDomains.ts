import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { ValueSet } from '$features/behavior-model/domain/entities/ValueSet';
import { effectiveEnumValues } from '$features/behavior-model/domain/services/EnumValues';
import { fillDefaults, type ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import { isExpression } from '$features/behavior-model/domain/value-objects/Expression';
import {
  flattenLeafConditions,
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition,
  type LeafRuleCondition,
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
 * A grid that fits under the cap is explored whole. A wider one is SAMPLED so a
 * wide action can't explode the search, and the sample is a COVERING one: a base
 * combination plus one-at-a-time variations, so every value of every parameter
 * is tried at least once. The base takes, for each parameter, a value that does
 * not trip a block rule we can judge (its default when that qualifies), so the
 * sample is not spent on combinations the action's own rules refuse. When
 * sampled, the caller marks the run truncated so a green result is never
 * mistaken for exhaustive, and `coverage` says how much of the grid was tried.
 */
export type ParameterCombinations = {
  /** False when a required parameter has no enumerable domain — the action is skipped. */
  readonly explorable: boolean;
  readonly reason?: string;
  /** Parameter value maps to simulate the action with. Empty when not explorable. */
  readonly combos: readonly ParameterValues[];
  /** True when the full product exceeded the cap and only a sample is returned. */
  readonly capped: boolean;
  /**
   * How much of the grid `combos` stands for. Absent when not explorable.
   * `covering` tries every VALUE of every parameter, not every combination, so
   * a guard that needs two non-base values at once can still go untried.
   */
  readonly coverage?: ParameterCoverage;
};

export type ParameterCoverage = {
  /** Size of the full cartesian product. */
  readonly fullGridSize: number;
  /** Combinations actually returned. Exceeds the cap when covering needs it. */
  readonly sampled: number;
  readonly strategy: 'full' | 'covering';
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

// Leaves that reference this parameter, each with its polarity: a leaf under an
// odd number of `not` holds the rule open when it is FALSE. Quantifier bodies
// read a scoped element binding, never a parameter, so they are not descended.
const polarizedLeaves = (
  condition: RuleCondition | undefined,
  parameter: Parameter,
  negated = false
): readonly { readonly leaf: LeafRuleCondition; readonly negated: boolean }[] => {
  if (!condition || isQuantifierCondition(condition)) return [];
  if (isCompositeCondition(condition)) {
    return condition.kind === 'not'
      ? polarizedLeaves(condition.condition, parameter, !negated)
      : condition.conditions.flatMap((sub) => polarizedLeaves(sub, parameter, negated));
  }
  return leafReferencesParameter(condition.left, parameter) ? [{ leaf: condition, negated }] : [];
};

// Whether `value` lands on the blocked side of a block rule. Judged leaf by
// leaf, no solver: a leaf counts only when its right operand is a literal (or
// the operator takes none), because anything else needs a snapshot we do not
// have while sampling. Such a leaf is skipped, which keeps the current order.
// Parameter binds are applied before rules run, so a leaf on the bound state
// path sees the parameter value exactly as a param-left leaf does.
const tripsBlockRule = (
  parameter: Parameter,
  value: StateValue,
  blockRules: readonly Rule[]
): boolean =>
  blockRules.some((rule) =>
    polarizedLeaves(rule.condition, parameter).some(({ leaf, negated }) => {
      if (isExpression(leaf.right) && leaf.right.kind !== 'literal') return false;
      const held = evaluateCondition(
        { ...leaf, left: { kind: 'param', name: parameter.name } },
        {},
        { [parameter.name]: value }
      );
      return held !== negated;
    })
  );

// Candidate values reordered for the covering sample's BASE: values on the
// allowed side of every judgeable block rule first, the default leading its
// group. Stable otherwise, so the order stays the mined one where nothing can
// be judged. Without this the base inherits the first mined value, and for a
// threshold T that is T-1: the blocked side of the very rule that produced it.
const baseFirst = (
  parameter: Parameter,
  values: readonly StateValue[],
  blockRules: readonly Rule[]
): readonly StateValue[] => {
  const rank = (value: StateValue): number =>
    (tripsBlockRule(parameter, value, blockRules) ? 2 : 0) +
    (parameter.defaultValue !== undefined && value === parameter.defaultValue ? 0 : 1);
  return values
    .map((value, order) => ({ value, order, rank: rank(value) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.value);
};

// Covering sample of a grid too wide to enumerate: the base combination, then
// one variation per remaining value of each parameter. Linear in the number of
// values (1 + the sum of each domain size minus one), so it is never dropped to
// fit the cap: losing a value is what made a wide action look dead.
const coveringSample = (
  parameters: readonly Parameter[],
  ordered: readonly (readonly StateValue[])[]
): Record<string, StateValue>[] => {
  const base: Record<string, StateValue> = Object.fromEntries(
    parameters.map((parameter, i) => [parameter.name, ordered[i]![0] as StateValue])
  );
  const variations = parameters.flatMap((parameter, i) =>
    ordered[i]!.slice(1).map((value) => ({ ...base, [parameter.name]: value }))
  );
  return [base, ...variations];
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

  // Under the cap: the full cartesian product, in grid order. Over it: a
  // covering sample instead of the grid's prefix, which pinned the early
  // parameters to their first value and only ever varied the last ones.
  // Deterministic either way: same action, same combinations.
  let raw: Record<string, StateValue>[] = [{}];
  if (capped) {
    // Only rules that can refuse THIS action while it runs: its own and its
    // surface's. Invariants are judged on the post-state, not on parameters.
    const blockRules = [...action.rules, ...(context?.surfaceRules ?? [])].filter(
      (rule) => rule.effect.type === 'block_action'
    );
    raw = coveringSample(
      action.parameters,
      perParameter.map((values, i) => baseFirst(action.parameters[i]!, values, blockRules))
    );
  } else {
    for (let i = 0; i < action.parameters.length; i++) {
      const parameter = action.parameters[i]!;
      const values = perParameter[i]!;
      const next: Record<string, StateValue>[] = [];
      for (const base of raw) {
        for (const value of values) next.push({ ...base, [parameter.name]: value });
      }
      raw = next;
    }
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

  return {
    explorable: true,
    combos,
    capped,
    coverage: {
      fullGridSize: total,
      sampled: combos.length,
      strategy: capped ? 'covering' : 'full'
    }
  };
};
