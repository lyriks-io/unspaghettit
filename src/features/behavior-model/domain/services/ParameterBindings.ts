import type { Parameter } from '../entities/Parameter';
import type { ParameterValues } from './ParameterValidator';
import { writePath, type StateSnapshot } from '../value-objects/StatePath';

/**
 * Apply parameter -> state-path bindings to the snapshot. For every parameter
 * with `bindToStatePath`, the corresponding parameter value is written into
 * the bound path. This runs *before* rules so they can react to bound values.
 */
export const applyParameterBindings = (
  parameters: readonly Parameter[],
  values: ParameterValues,
  snapshot: StateSnapshot
): StateSnapshot => {
  let next = snapshot;
  for (const parameter of parameters) {
    if (!parameter.bindToStatePath) continue;
    const value = values[parameter.name];
    if (value === undefined) continue;
    next = writePath(next, parameter.bindToStatePath, value);
  }
  return next;
};
