import type { Action } from '../entities/Action';
import type { Scenario } from '../entities/Scenario';
import type { ParameterValues } from './ParameterValidator';
import { writePath, type StateSnapshot } from '../value-objects/StatePath';

/**
 * Apply a scenario's state overrides to the given snapshot. Overrides are
 * written in declaration order so later entries win on conflict. Matches
 * the order the modeler authored them.
 */
export const applyScenarioToSnapshot = (
  scenario: Scenario,
  snapshot: StateSnapshot
): StateSnapshot => {
  let next = snapshot;
  for (const override of scenario.stateOverrides) {
    next = writePath(next, override.path, override.value);
  }
  return next;
};

/**
 * Auto-fill action parameters from a scenario by name. Existing values in
 * `current` (e.g. typed in by the user, or set by a persona) win over scenario
 * defaults. The scenario only fills slots that aren't already populated.
 */
export const applyScenarioToParameters = (
  scenario: Scenario,
  action: Action,
  current: ParameterValues
): ParameterValues => {
  const fromScenario: { [k: string]: ParameterValues[string] } = {};
  const paramNames = new Set(action.parameters.map((p) => p.name));
  for (const override of scenario.parameterOverrides) {
    if (paramNames.has(override.parameterName)) {
      fromScenario[override.parameterName] = override.value;
    }
  }
  return { ...fromScenario, ...current };
};
