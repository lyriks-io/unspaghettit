import type { Feature } from '../../entities/Feature';
import type { Scenario } from '../../entities/Scenario';
import type { Transition } from '../../entities/Transition';
import type { ActionId, ScenarioId, SurfaceId, TransitionId } from '../../value-objects/ids';
import { mustMap, updateActionIn, updateSurface } from './internal';

// ─── Transitions ─────────────────────────────────────────────────────────────

export const addTransitionToSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  transition: Transition
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    transitions: [...s.transitions, transition]
  }));

export const updateTransitionOnSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  transitionId: TransitionId,
  patch: Partial<Transition>
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    transitions: mustMap(s.transitions, String(transitionId), 'transition', (t) => ({ ...t, ...patch }))
  }));

export const removeTransitionFromSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  transitionId: TransitionId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    transitions: s.transitions.filter((t) => t.id !== transitionId)
  }));

// ─── Transitions (action-scoped) ─────────────────────────────────────────
// An action can carry its own transitions[] (declarative "this action leads
// here" edges the diagram / graph / coverage read), distinct from the
// surface's. Mirrors the surface helpers above but against action.transitions.

export const addTransitionToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  transition: Transition
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      transitions: [...(c.transitions ?? []), transition]
    }))
  );

export const updateTransitionOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  transitionId: TransitionId,
  patch: Partial<Transition>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      transitions: mustMap(c.transitions ?? [], String(transitionId), 'transition', (t) => ({
        ...t,
        ...patch
      }))
    }))
  );

export const removeTransitionFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  transitionId: TransitionId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      transitions: (c.transitions ?? []).filter((t) => t.id !== transitionId)
    }))
  );

// ─── Scenarios (action-scoped) ───────────────────────────────────────────

export const addScenarioToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  scenario: Scenario
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      scenarios: [...(c.scenarios ?? []), scenario]
    }))
  );

export const updateScenarioOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  scenarioId: ScenarioId,
  patch: Partial<Scenario>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      scenarios: mustMap(c.scenarios ?? [], String(scenarioId), 'scenario', (sc) => ({ ...sc, ...patch }))
    }))
  );

export const removeScenarioFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  scenarioId: ScenarioId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      scenarios: (c.scenarios ?? []).filter((sc) => sc.id !== scenarioId)
    }))
  );
