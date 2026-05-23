import type { PersonaId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

/**
 * A Persona is a named "fake user" preset. When applied to a simulation it overrides
 * matching state paths and pre-fills action parameters by name. Personas are
 * scoped to an Feature because state paths and parameter names live there.
 */
export type PersonaStateOverride = {
  readonly path: StatePath;
  readonly value: StateValue;
};

export type PersonaParameterOverride = {
  /** Matched against Action.parameters[].name when running an action. */
  readonly parameterName: string;
  readonly value: StateValue;
};

export type Persona = {
  readonly id: PersonaId;
  readonly name: string;
  readonly description?: string;
  readonly stateOverrides: readonly PersonaStateOverride[];
  readonly parameterOverrides: readonly PersonaParameterOverride[];
  /**
   * If true, switching surfaces in the simulator keeps this persona's state
   * overrides applied to the new surface's default snapshot. Otherwise the
   * persona is cleared whenever the active surface changes.
   */
  readonly persistAcrossSurfaces?: boolean;
};
