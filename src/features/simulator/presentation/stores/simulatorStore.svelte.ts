import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import {
  applyPersonaToParameters,
  applyPersonaToSnapshot
} from '$features/behavior-model/domain/services/PersonaApplier';
import {
  applyScenarioToParameters,
  applyScenarioToSnapshot
} from '$features/behavior-model/domain/services/ScenarioApplier';
import { buildInitialSnapshot } from '$features/behavior-model/domain/services/StateSnapshot';
import type { StatePath, StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import type {
  ActionId,
  PersonaId,
  ScenarioId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { readPath, writePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SimulationResult } from '$features/simulator/domain/SimulationResult';
import { simulate } from '$features/simulator/domain/SimulatorEngine';
import { emit } from '$shared/events/eventBus';

class SimulatorStore {
  surfaceId = $state<SurfaceId | null>(null);
  actionId = $state<ActionId | null>(null);
  personaId = $state<PersonaId | null>(null);
  scenarioId = $state<ScenarioId | null>(null);
  snapshot = $state<StateSnapshot>({});
  parameters = $state<ParameterValues>({});
  lastResult = $state<SimulationResult | null>(null);
  history = $state<readonly SimulationResult[]>([]);
  /** True while a synchronous simulation is mid-flight. Flips on/off inside run(). */
  isRunning = $state<boolean>(false);
  /** ISO timestamp of the last completed simulation run. */
  lastRunAt = $state<string | null>(null);
  /**
   * When true, switching surfaces preserves the current snapshot. Values
   * already in state survive the transition; only state paths the new surface
   * declares but the snapshot doesn't already hold get filled from defaults.
   * Lets the modeler test the feature as a real navigation flow rather
   * than each surface in isolation. Default off.
   */
  persistAcrossNavigation = $state<boolean>(false);

  /**
   * Reset every simulator state to the surface's defaults. By default this
   * also clears the active persona. Pass `{ keepPersona: true }` when the
   * caller will re-apply a persistent persona on top.
   */
  resetTo(surface: Surface, options: { keepPersona?: boolean } = {}): void {
    this.surfaceId = surface.id;
    this.snapshot = buildInitialSnapshot(surface.stateDefinitions);
    this.parameters = {};
    if (!options.keepPersona) this.personaId = null;
    this.lastResult = null;
    this.history = [];
  }

  /**
   * Called every time the simulator is shown for a surface.
   *
   * Two modes:
   *
   * • Default ("isolated"): the snapshot resets to the new surface's defaults
   *   and any sticky persona is re-applied. Each surface is tested fresh.
   *
   * • `persistAcrossNavigation` toggle on ("real-flow"): the existing snapshot
   *   carries over. Only state paths the new surface declares which the
   *   snapshot does not already hold get filled from defaults. Lets the
   *   modeler walk the feature as a real navigation flow. Auth state,
   *   cart contents, consent choices etc. survive transitions.
   */
  ensureSnapshotForSurface(surface: Surface, feature: Feature): void {
    if (this.surfaceId === surface.id) return;

    if (this.persistAcrossNavigation) {
      this.surfaceId = surface.id;
      // Fill any new-surface defaults that aren't already present in the
      // running snapshot. Existing values win.
      let next = this.snapshot;
      for (const def of surface.stateDefinitions) {
        if (readPath(next, def.path) === undefined) {
          next = writePath(next, def.path, def.defaultValue);
        }
      }
      this.snapshot = next;
      return;
    }

    const persistent =
      this.personaId !== null
        ? feature.personas.find(
            (p) => p.id === this.personaId && p.persistAcrossSurfaces === true
          )
        : undefined;
    if (persistent) {
      this.resetTo(surface, { keepPersona: true });
      this.snapshot = applyPersonaToSnapshot(persistent, this.snapshot);
    } else {
      this.resetTo(surface);
    }
  }

  setPersistAcrossNavigation(value: boolean): void {
    this.persistAcrossNavigation = value;
  }

  setStatePath(path: StatePath, value: string | number | boolean): void {
    this.snapshot = writePath(this.snapshot, path, value);
  }

  /**
   * Update a parameter's runtime value. When the parameter is bound to a
   * state path, also write the value into the snapshot in real time so the
   * Current state inspector mirrors what would happen if the action ran
   * right now. The user sees the binding flow live as they type.
   */
  setParameter(
    name: string,
    value: StateValue,
    bindToStatePath?: StatePath
  ): void {
    this.parameters = { ...this.parameters, [name]: value };
    if (bindToStatePath) {
      this.snapshot = writePath(this.snapshot, bindToStatePath, value);
    }
  }

  /**
   * Switch to a different action while keeping the active "Test as"
   * persona alive. The persona's parameter overrides are re-fanned out to the
   * new action (matched by parameter name) and bound parameters are
   * propagated into the snapshot so the state inspector reflects the change
   * the same way live typing would.
   *
   * Pass the new action + feature for the persona re-fill to work; if
   * omitted, the call still updates `actionId` but leaves parameters
   * empty (legacy behavior, used internally by tests).
   */
  selectCapability(
    id: ActionId | null,
    context?: { readonly action: Action; readonly feature: Feature }
  ): void {
    this.actionId = id;
    this.scenarioId = null;
    this.parameters = {};
    if (id) emit('sim.action.selected', { actionId: String(id) });

    if (!context || this.personaId === null) return;
    const persona = context.feature.personas.find((p) => p.id === this.personaId);
    if (!persona) return;
    this.parameters = applyPersonaToParameters(persona, context.action, {});
    for (const param of context.action.parameters) {
      if (!param.bindToStatePath) continue;
      const value = this.parameters[param.name];
      if (value === undefined) continue;
      this.snapshot = writePath(this.snapshot, param.bindToStatePath, value);
    }
  }

  /**
   * Layer an action scenario over the current persona's snapshot. Persona
   * applies first (the user identity baseline), then the scenario adds the
   * action-specific state. Pass `null` to clear back to bare persona.
   *
   * Mirrors the same layering the simulator engine would see at run time, so
   * the live state inspector matches what `simulate()` will receive.
   */
  applyScenario(
    scenario: Scenario | null,
    feature: Feature,
    action: Action,
    surface: Surface
  ): void {
    this.snapshot = buildInitialSnapshot(surface.stateDefinitions);
    this.parameters = {};
    this.scenarioId = scenario ? scenario.id : null;
    if (scenario) emit('sim.scenario.selected', { scenarioId: String(scenario.id) });

    const persona =
      this.personaId !== null
        ? feature.personas.find((p) => p.id === this.personaId) ?? null
        : null;
    if (persona) {
      this.snapshot = applyPersonaToSnapshot(persona, this.snapshot);
      this.parameters = applyPersonaToParameters(persona, action, {});
    }

    if (scenario) {
      this.snapshot = applyScenarioToSnapshot(scenario, this.snapshot);
      this.parameters = applyScenarioToParameters(scenario, action, this.parameters);
    }

    for (const param of action.parameters) {
      if (!param.bindToStatePath) continue;
      const value = this.parameters[param.name];
      if (value === undefined) continue;
      this.snapshot = writePath(this.snapshot, param.bindToStatePath, value);
    }
  }

  /**
   * Apply a persona. Or clear back to a fresh manual setup. Either way the
   * snapshot starts from the surface's defaults so a previous persona's
   * overrides never linger. Bound parameters also propagate into the snapshot
   * so the Current state inspector reflects them immediately, matching the
   * live-typing behavior.
   */
  applyPersona(
    persona: Persona | null,
    action: Action | null,
    surface: Surface
  ): void {
    this.snapshot = buildInitialSnapshot(surface.stateDefinitions);
    this.parameters = {};
    this.personaId = persona ? persona.id : null;
    this.scenarioId = null;
    if (persona) emit('sim.persona.selected', { personaId: String(persona.id) });
    if (!persona) return;
    this.snapshot = applyPersonaToSnapshot(persona, this.snapshot);
    if (action) {
      this.parameters = applyPersonaToParameters(persona, action, {});
      for (const param of action.parameters) {
        if (!param.bindToStatePath) continue;
        const value = this.parameters[param.name];
        if (value === undefined) continue;
        this.snapshot = writePath(this.snapshot, param.bindToStatePath, value);
      }
    }
  }

  clearHistory(): void {
    this.history = [];
  }

  run(surface: Surface, action: Action): SimulationResult {
    this.isRunning = true;
    try {
      const result = simulate({
        surface,
        action,
        snapshot: this.snapshot,
        parameters: this.parameters
      });
      this.lastResult = result;
      if (result.status === 'success') {
        this.snapshot = result.nextState;
      }
      this.history = [result, ...this.history].slice(0, 10);
      this.lastRunAt = new Date().toISOString();
      emit('action.simulated', {
        actionId: String(action.id),
        status: result.status
      });
      return result;
    } finally {
      this.isRunning = false;
    }
  }
}

export const simulatorStore = new SimulatorStore();
