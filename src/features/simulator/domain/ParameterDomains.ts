import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import type { ValueSet } from '$features/behavior-model/domain/entities/ValueSet';
import { effectiveEnumValues } from '$features/behavior-model/domain/services/EnumValues';
import { fillDefaults, type ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
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
 *   - number   -> its min / max validation bounds (boundary values), else its
 *                 default, else 0
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

// Boundary values for a number parameter: its min/max validation bounds, plus
// its default. Empty when the parameter is unbounded and has no default — an
// arbitrary sample (0) would give false confidence, so such a required number
// stays honestly "not explored" rather than pretending to cover the domain.
const numberSamples = (parameter: Parameter): readonly number[] => {
  const bounds: number[] = [];
  for (const validation of parameter.validations ?? []) {
    if (validation.type === 'min' || validation.type === 'max') bounds.push(validation.value);
  }
  if (typeof parameter.defaultValue === 'number') bounds.push(parameter.defaultValue);
  return [...new Set(bounds)];
};

/**
 * The values to try for one parameter, or `'unbounded'` when it is required and
 * has no enumerable domain (which makes the whole action unexplorable).
 */
const parameterValues = (
  parameter: Parameter,
  valueSets: readonly ValueSet[] | undefined
): readonly StateValue[] | 'unbounded' => {
  if (parameter.type === 'boolean') return [true, false];
  if (parameter.type === 'enum') {
    const allowed = effectiveEnumValues(parameter, valueSets);
    if (allowed && allowed.length > 0) return allowed;
    if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
    return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
  }
  if (parameter.type === 'number') {
    const samples = numberSamples(parameter);
    if (samples.length > 0) return samples;
    return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
  }
  if (parameter.defaultValue !== undefined) return [parameter.defaultValue];
  return parameter.required ? 'unbounded' : [undefined as unknown as StateValue];
};

export const parameterCombinations = (
  action: Action,
  valueSets: readonly ValueSet[] | undefined,
  maxCombos: number = DEFAULT_MAX_COMBOS
): ParameterCombinations => {
  const perParameter: (readonly StateValue[])[] = [];
  for (const parameter of action.parameters) {
    const values = parameterValues(parameter, valueSets);
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
