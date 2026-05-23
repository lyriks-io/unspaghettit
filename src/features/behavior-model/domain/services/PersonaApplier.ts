import type { Action } from '../entities/Action';
import type { Persona } from '../entities/Persona';
import type { ParameterValues } from './ParameterValidator';
import { writePath, type StateSnapshot } from '../value-objects/StatePath';

/**
 * Apply a persona's state overrides to a snapshot. State overrides are written
 * in declaration order so later overrides win on conflict. Matches the order
 * the user authored them.
 */
export const applyPersonaToSnapshot = (
  persona: Persona,
  snapshot: StateSnapshot
): StateSnapshot => {
  let next = snapshot;
  for (const override of persona.stateOverrides) {
    next = writePath(next, override.path, override.value);
  }
  return next;
};

/**
 * Auto-fill action parameters from the persona by name. Existing values in
 * `current` (e.g. typed in by the user) win over persona defaults.
 */
export const applyPersonaToParameters = (
  persona: Persona,
  action: Action,
  current: ParameterValues
): ParameterValues => {
  const fromPersona: { [k: string]: ParameterValues[string] } = {};
  const paramNames = new Set(action.parameters.map((p) => p.name));
  for (const override of persona.parameterOverrides) {
    if (paramNames.has(override.parameterName)) {
      fromPersona[override.parameterName] = override.value;
    }
  }
  return { ...fromPersona, ...current };
};
