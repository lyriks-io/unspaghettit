import type { Action } from '../../entities/Action';
import type { Feature } from '../../entities/Feature';
import type { Parameter } from '../../entities/Parameter';
import { parameterTypeToStateType } from '../../value-objects/ParameterType';
import type { ActionId, ParameterId, SurfaceId } from '../../value-objects/ids';
import { mustMap, swapAt, updateActionIn, updateSurface } from './internal';

export const addAction = (
  feature: Feature,
  surfaceId: SurfaceId,
  action: Action
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    actions: [...s.actions, action]
  }));

export const removeAction = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    actions: s.actions.filter((c) => c.id !== actionId)
  }));

/**
 * Remove an action by id from whichever surface owns it, without the caller
 * needing to know the surface. Pure; returns the feature unchanged when no
 * action matches.
 */
export const removeActionAnywhere = (feature: Feature, actionId: ActionId): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map((s) => ({
    ...s,
    actions: s.actions.filter((c) => c.id !== actionId)
  }))
});

/**
 * Clear the Evolution marker on an action (accept the proposal -> committed
 * behavior), wherever it lives. Pure; a no-op for ids that don't match or
 * actions that aren't Evolutions.
 */
export const clearActionEvolution = (feature: Feature, actionId: ActionId): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map((s) => ({
    ...s,
    actions: s.actions.map((c) => {
      if (c.id !== actionId || c.evolution === undefined) return c;
      const { evolution: _evolution, ...committed } = c;
      return committed;
    })
  }))
});

/**
 * Dismiss an Evolution proposal — mark it `dismissed` rather than deleting it.
 * The action stays in the spec as a tombstone so the assistant can see the
 * idea was already raised-and-rejected and propose something different next
 * time. Pure; a no-op for ids that don't match or actions that aren't
 * Evolutions. Already-dismissed proposals are returned unchanged.
 */
export const dismissActionEvolution = (feature: Feature, actionId: ActionId): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map((s) => ({
    ...s,
    actions: s.actions.map((c) =>
      c.id === actionId && c.evolution !== undefined && c.evolution.dismissed !== true
        ? { ...c, evolution: { ...c.evolution, dismissed: true } }
        : c
    )
  }))
});

/**
 * Move an action up (delta = -1) or down (delta = +1) inside its surface's
 * action list. No-op when the action is at the relevant edge.
 */
export const moveActionBy = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  delta: -1 | 1
): Feature =>
  updateSurface(feature, surfaceId, (surface) => {
    const index = surface.actions.findIndex((c) => c.id === actionId);
    if (index < 0) return surface;
    return { ...surface, actions: swapAt(surface.actions, index, index + delta) };
  });

/**
 * Move a parameter up or down within its action's parameter list.
 */
export const moveParameterBy = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  parameterId: ParameterId,
  delta: -1 | 1
): Feature =>
  updateSurface(feature, surfaceId, (surface) =>
    updateActionIn(surface, actionId, (cap) => {
      const index = cap.parameters.findIndex((p) => p.id === parameterId);
      if (index < 0) return cap;
      return { ...cap, parameters: swapAt(cap.parameters, index, index + delta) };
    })
  );

export const updateAction = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  patch: Partial<Action>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({ ...c, ...patch }))
  );

/**
 * Update a single parameter and keep its bound state definition in sync.
 *
 * When a parameter has `bindToStatePath`, the matching StateDefinition on the
 * surface mirrors the parameter's runtime shape: same `type`, and same
 * `enumValues` when the type is enum. This sync runs whenever the parameter
 * is updated so the editor cannot drift into an inconsistent state where the
 * parameter writes a value the state slot is not declared to hold.
 *
 * If the parameter has no binding, or the bound path has no matching
 * StateDefinition on this surface, only the parameter is updated.
 */
export const updateParameter = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  parameterId: ParameterId,
  patch: Partial<Parameter>
): Feature =>
  updateSurface(feature, surfaceId, (surface) => {
    const nextSurface = updateActionIn(surface, actionId, (c) => ({
      ...c,
      parameters: mustMap(c.parameters, String(parameterId), 'parameter', (p) => ({ ...p, ...patch }))
    }));

    const cap = nextSurface.actions.find((c) => c.id === actionId);
    const param = cap?.parameters.find((p) => p.id === parameterId);
    if (!param || !param.bindToStatePath) return nextSurface;

    const boundPath = param.bindToStatePath;
    const baseType = parameterTypeToStateType(param.type);
    return {
      ...nextSurface,
      stateDefinitions: nextSurface.stateDefinitions.map((d) =>
        d.path === boundPath
          ? {
              ...d,
              type: baseType,
              enumValues: param.type === 'enum' ? param.enumValues : undefined
            }
          : d
      )
    };
  });

export const addParameter = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  parameter: Parameter
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      parameters: [...c.parameters, parameter]
    }))
  );

export const removeParameter = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  parameterId: ParameterId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      parameters: c.parameters.filter((p) => p.id !== parameterId)
    }))
  );
