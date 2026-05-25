import type { Action } from '../entities/Action';
import type { Entity, EntityField } from '../entities/Entity';
import type { EventDefinition } from '../entities/EventDefinition';
import type { Feature } from '../entities/Feature';
import type { Invariant } from '../entities/Invariant';
import type { Parameter } from '../entities/Parameter';
import type { Persona } from '../entities/Persona';
import type { Resource } from '../entities/Resource';
import type { Rule } from '../entities/Rule';
import type { Scenario } from '../entities/Scenario';
import type { StateDefinition } from '../entities/StateDefinition';
import type { Surface } from '../entities/Surface';
import type { Transition } from '../entities/Transition';
import type { Effect } from '../value-objects/Effect';
import { parameterTypeToStateType } from '../value-objects/ParameterType';
import type {
  ActionId,
  EntityFieldId,
  EntityId,
  EffectId,
  EventDefinitionId,
  InvariantId,
  ParameterId,
  PersonaId,
  ResourceId,
  RuleId,
  ScenarioId,
  StateDefinitionId,
  SurfaceId,
  TransitionId
} from '../value-objects/ids';

/**
 * Raised when an update / remove targets an id that does not exist in the
 * feature. The previous behavior was a silent no-op (`.map` returned the
 * collection unchanged, the ack still reported success). That made bad
 * ids, including the 8-char short ids when the prototype is on, fail
 * silently. Loud failures push the caller to fix the id before re-trying.
 *
 * Removes stay idempotent by design (`.filter`); only updates throw.
 */
export class EntityNotFoundInFeatureError extends Error {
  constructor(
    public readonly kind: string,
    public readonly id: string
  ) {
    super(`${kind} ${id} not found in feature`);
    this.name = 'EntityNotFoundInFeatureError';
  }
}

/**
 * Map-with-must-find. Walks `items`, applies `fn` to the element whose id
 * matches, and throws when nothing matched. Use for strict-update transforms
 * (rules, effects, scenarios, invariants, transitions, …). For idempotent
 * removes keep `.filter`, it stays a no-op when the id is unknown.
 */
const mustMap = <T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  kind: string,
  fn: (item: T) => T
): readonly T[] => {
  let found = false;
  const out = items.map((item) => {
    if (item.id === id) {
      found = true;
      return fn(item);
    }
    return item;
  });
  if (!found) throw new EntityNotFoundInFeatureError(kind, id);
  return out;
};

const updateSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  fn: (s: Surface) => Surface
): Feature => ({
  ...feature,
  surfaces: mustMap(feature.surfaces, String(surfaceId), 'surface', fn)
});

const updateActionIn = (
  surface: Surface,
  actionId: ActionId,
  fn: (c: Action) => Action
): Surface => ({
  ...surface,
  actions: mustMap(surface.actions, String(actionId), 'action', fn)
});

export const addSurface = (feature: Feature, surface: Surface): Feature => ({
  ...feature,
  surfaces: [...feature.surfaces, surface]
});

export const removeSurface = (feature: Feature, surfaceId: SurfaceId): Feature => ({
  ...feature,
  surfaces: feature.surfaces.filter((s) => s.id !== surfaceId)
});

const swapAt = <T>(items: readonly T[], a: number, b: number): readonly T[] => {
  if (a === b || a < 0 || b < 0 || a >= items.length || b >= items.length) return items;
  const next = items.slice();
  const tmp = next[a]!;
  next[a] = next[b]!;
  next[b] = tmp;
  return next;
};

type Span = { readonly start: number; readonly end: number };

/**
 * The contiguous range of surfaces that make up a surface's subtree:
 * itself plus every descendant that follows in the flat array. The convention
 * is that descendants always sit immediately after their ancestor, so the
 * subtree is the run starting at `startIdx` until depth dips back to
 * startDepth or below.
 */
const findSubtreeSpan = (surfaces: readonly Surface[], startIdx: number): Span => {
  const startDepth = surfaceDepth(surfaces, surfaces[startIdx]!.id);
  let end = startIdx;
  for (let i = startIdx + 1; i < surfaces.length; i += 1) {
    if (surfaceDepth(surfaces, surfaces[i]!.id) <= startDepth) break;
    end = i;
  }
  return { start: startIdx, end };
};

/**
 * Move a surface up (delta = -1) or down (delta = +1). When the surface has
 * children the whole subtree moves with it, swapping with its previous /
 * next sibling at the same depth. Never crossing a parent boundary. No-op
 * when the surface is already at the edge of its sibling group.
 */
export const moveSurfaceBy = (
  feature: Feature,
  surfaceId: SurfaceId,
  delta: -1 | 1
): Feature => {
  const surfaces = feature.surfaces;
  const idx = surfaces.findIndex((s) => s.id === surfaceId);
  if (idx < 0) return feature;
  const myDepth = surfaceDepth(surfaces, surfaceId);
  const mine = findSubtreeSpan(surfaces, idx);

  if (delta === 1) {
    const nextStart = mine.end + 1;
    if (nextStart >= surfaces.length) return feature;
    const nextDepth = surfaceDepth(surfaces, surfaces[nextStart]!.id);
    // Refuse to move past a shallower neighbour. That would change parents.
    if (nextDepth !== myDepth) return feature;
    const next = findSubtreeSpan(surfaces, nextStart);
    return {
      ...feature,
      surfaces: [
        ...surfaces.slice(0, mine.start),
        ...surfaces.slice(next.start, next.end + 1),
        ...surfaces.slice(mine.start, mine.end + 1),
        ...surfaces.slice(next.end + 1)
      ]
    };
  }

  if (mine.start === 0) return feature;
  const prevEnd = mine.start - 1;
  const prevEndDepth = surfaceDepth(surfaces, surfaces[prevEnd]!.id);
  if (prevEndDepth < myDepth) return feature;
  // Walk back to the start of the previous sibling's subtree.
  let prevStart = prevEnd;
  while (prevStart > 0 && surfaceDepth(surfaces, surfaces[prevStart]!.id) > myDepth) {
    prevStart -= 1;
  }
  return {
    ...feature,
    surfaces: [
      ...surfaces.slice(0, prevStart),
      ...surfaces.slice(mine.start, mine.end + 1),
      ...surfaces.slice(prevStart, mine.start),
      ...surfaces.slice(mine.end + 1)
    ]
  };
};

/** Whether moveSurfaceBy(..., -1) on this surface would change the array. */
export const canMoveSurfaceUp = (
  surfaces: readonly Surface[],
  surfaceId: SurfaceId
): boolean => {
  const idx = surfaces.findIndex((s) => s.id === surfaceId);
  if (idx <= 0) return false;
  const myDepth = surfaceDepth(surfaces, surfaceId);
  const prevDepth = surfaceDepth(surfaces, surfaces[idx - 1]!.id);
  return prevDepth >= myDepth;
};

/** Whether moveSurfaceBy(..., +1) on this surface would change the array. */
export const canMoveSurfaceDown = (
  surfaces: readonly Surface[],
  surfaceId: SurfaceId
): boolean => {
  const idx = surfaces.findIndex((s) => s.id === surfaceId);
  if (idx < 0) return false;
  const myDepth = surfaceDepth(surfaces, surfaceId);
  const mine = findSubtreeSpan(surfaces, idx);
  const nextStart = mine.end + 1;
  if (nextStart >= surfaces.length) return false;
  return surfaceDepth(surfaces, surfaces[nextStart]!.id) === myDepth;
};

export type SurfaceDropTarget =
  | { readonly kind: 'before'; readonly targetId: SurfaceId }
  | { readonly kind: 'after'; readonly targetId: SurfaceId }
  | { readonly kind: 'inside'; readonly targetId: SurfaceId };

/**
 * Move a surface (with its subtree) to a position relative to another surface.
 *
 * Three drop kinds:
 *   • before. Moved subtree becomes the previous sibling of `targetId`
 *   • after. Moved subtree becomes the next sibling of `targetId` (placed
 *               after target's full subtree)
 *   • inside. Moved subtree becomes the LAST child of `targetId`
 *
 * Rejects cycles: cannot drop onto self, into own descendant, or to a position
 * whose computed new parent is the moved surface or one of its descendants.
 */
export const moveSurfaceTo = (
  feature: Feature,
  surfaceId: SurfaceId,
  target: SurfaceDropTarget
): Feature => {
  if (target.targetId === surfaceId) return feature;
  const surfaces = feature.surfaces;
  const sourceIdx = surfaces.findIndex((s) => s.id === surfaceId);
  const targetIdx = surfaces.findIndex((s) => s.id === target.targetId);
  if (sourceIdx < 0 || targetIdx < 0) return feature;

  const sourceSpan = findSubtreeSpan(surfaces, sourceIdx);
  // Target is inside the moved subtree. Would create a cycle.
  if (targetIdx >= sourceSpan.start && targetIdx <= sourceSpan.end) return feature;

  const targetSurface = surfaces[targetIdx]!;
  const newParentId: SurfaceId | null =
    target.kind === 'inside' ? targetSurface.id : targetSurface.parentSurfaceId ?? null;

  if (newParentId === surfaceId) return feature;
  if (newParentId !== null && isDescendantOf(surfaces, newParentId, surfaceId)) {
    return feature;
  }

  // Update the moved surface's parent to match the new position; descendants
  // keep their existing parent chain so they remain attached to the surface.
  const movedRoot: Surface = {
    ...surfaces[sourceIdx]!,
    parentSurfaceId: newParentId ?? undefined
  };
  const movedSubtree: readonly Surface[] = [
    movedRoot,
    ...surfaces.slice(sourceSpan.start + 1, sourceSpan.end + 1)
  ];

  // Splice the subtree out, then locate the target in the resulting array
  // (its index may have shifted) and compute the insertion point.
  const without: readonly Surface[] = [
    ...surfaces.slice(0, sourceSpan.start),
    ...surfaces.slice(sourceSpan.end + 1)
  ];
  const newTargetIdx = without.findIndex((s) => s.id === target.targetId);
  if (newTargetIdx < 0) return feature;

  let insertIdx: number;
  if (target.kind === 'before') {
    insertIdx = newTargetIdx;
  } else {
    // 'after' or 'inside'. Both go past the target's full subtree.
    const targetSpan = findSubtreeSpan(without, newTargetIdx);
    insertIdx = targetSpan.end + 1;
  }

  return {
    ...feature,
    surfaces: [
      ...without.slice(0, insertIdx),
      ...movedSubtree,
      ...without.slice(insertIdx)
    ]
  };
};

const isDescendantOf = (
  surfaces: readonly Surface[],
  candidateId: SurfaceId,
  ancestorId: SurfaceId
): boolean => {
  let current = surfaces.find((s) => s.id === candidateId);
  let depth = 0;
  while (current?.parentSurfaceId && depth < 32) {
    if (current.parentSurfaceId === ancestorId) return true;
    const next = surfaces.find((s) => s.id === current!.parentSurfaceId);
    current = next;
    depth++;
  }
  return false;
};

/**
 * Set or clear a surface's parent for navigator grouping. Refuses cycles:
 * a surface cannot be its own parent, nor a descendant of itself. Pass
 * `null` to make the surface a root again.
 */
export const setSurfaceParent = (
  feature: Feature,
  surfaceId: SurfaceId,
  parentId: SurfaceId | null
): Feature => {
  if (parentId !== null) {
    if (parentId === surfaceId) return feature;
    if (!feature.surfaces.some((s) => s.id === parentId)) return feature;
    if (isDescendantOf(feature.surfaces, parentId, surfaceId)) return feature;
  }
  return updateSurface(feature, surfaceId, (s) => ({
    ...s,
    parentSurfaceId: parentId ?? undefined
  }));
};

/**
 * Compute the depth of a surface in the parent chain. Roots are depth 0.
 * Capped to prevent runaway loops on malformed data.
 */
export const surfaceDepth = (
  surfaces: readonly Surface[],
  surfaceId: SurfaceId
): number => {
  let depth = 0;
  let current = surfaces.find((s) => s.id === surfaceId);
  while (current?.parentSurfaceId && depth < 32) {
    const next = surfaces.find((s) => s.id === current!.parentSurfaceId);
    if (!next) break;
    current = next;
    depth++;
  }
  return depth;
};

export const renameSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  patch: Partial<Pick<Surface, 'name' | 'type' | 'description'>>
): Feature => updateSurface(feature, surfaceId, (s) => ({ ...s, ...patch }));

export const addStateDefinition = (
  feature: Feature,
  surfaceId: SurfaceId,
  definition: StateDefinition
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    stateDefinitions: [...s.stateDefinitions, definition]
  }));

/**
 * Update a single StateDefinition and propagate enumValues to every Parameter
 * that binds to its path.
 *
 * The reverse direction (parameter → state def) already runs inside
 * `updateParameter`. Without this forward sync, an LLM adding a new enum
 * value to the state def has to remember to also patch every bound
 * parameter, which is a footgun that the model has enough information to
 * prevent. We restrict propagation to `enumValues` (and clear them when the
 * state's type stops being enum); the parameter's own `type` is left alone
 * so format types like `email`/`date` that collapse to `string` survive.
 */
export const updateStateDefinition = (
  feature: Feature,
  surfaceId: SurfaceId,
  definitionId: StateDefinitionId,
  patch: Partial<StateDefinition>
): Feature =>
  updateSurface(feature, surfaceId, (s) => {
    const target = s.stateDefinitions.find((d) => d.id === definitionId);
    if (!target) throw new EntityNotFoundInFeatureError('stateDefinition', String(definitionId));
    const next: StateDefinition = { ...target, ...patch };

    const enumChanged =
      'enumValues' in patch && !arraysShallowEqual(target.enumValues, next.enumValues);
    const typeChanged = 'type' in patch && target.type !== next.type;

    const nextStateDefinitions = s.stateDefinitions.map((d) =>
      d.id === definitionId ? next : d
    );

    if (!enumChanged && !typeChanged) {
      return { ...s, stateDefinitions: nextStateDefinitions };
    }

    const boundPath = next.path;
    const propagateEnum = next.type === 'enum' ? next.enumValues : undefined;
    const stateNowEnum = next.type === 'enum';

    return {
      ...s,
      stateDefinitions: nextStateDefinitions,
      actions: s.actions.map((c) => ({
        ...c,
        parameters: c.parameters.map((p) => {
          if (p.bindToStatePath !== boundPath) return p;
          if (p.type !== 'enum') return p;
          if (!stateNowEnum) {
            // State stopped being enum: drop the parameter's enumValues but
            // leave the rest of the parameter alone. The validator will then
            // complain if the parameter's type is still enum without values.
            const { enumValues: _drop, ...rest } = p;
            return rest;
          }
          return propagateEnum === undefined
            ? p
            : { ...p, enumValues: propagateEnum };
        })
      }))
    };
  });

const arraysShallowEqual = (
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const removeStateDefinition = (
  feature: Feature,
  surfaceId: SurfaceId,
  definitionId: StateDefinitionId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    stateDefinitions: s.stateDefinitions.filter((d) => d.id !== definitionId)
  }));

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

/**
 * Move a state definition up or down within its surface's state list.
 */
export const moveStateDefinitionBy = (
  feature: Feature,
  surfaceId: SurfaceId,
  definitionId: StateDefinitionId,
  delta: -1 | 1
): Feature =>
  updateSurface(feature, surfaceId, (surface) => {
    const index = surface.stateDefinitions.findIndex((d) => d.id === definitionId);
    if (index < 0) return surface;
    return {
      ...surface,
      stateDefinitions: swapAt(surface.stateDefinitions, index, index + delta)
    };
  });

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

export const addRuleToSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({ ...s, rules: [...s.rules, rule] }));

export const removeRuleFromSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  ruleId: RuleId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    rules: s.rules.filter((r) => r.id !== ruleId)
  }));

export const updateRuleOnSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    rules: mustMap(s.rules, String(rule.id), 'rule', () => rule)
  }));

export const addRuleToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({ ...c, rules: [...c.rules, rule] }))
  );

export const removeRuleFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  ruleId: RuleId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      rules: c.rules.filter((r) => r.id !== ruleId)
    }))
  );

export const updateRuleOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      rules: mustMap(c.rules, String(rule.id), 'rule', () => rule)
    }))
  );

export const addEffectToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effect: Effect
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({ ...c, effects: [...c.effects, effect] }))
  );

export const updateEffectOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId,
  patch: Partial<Effect>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      effects: mustMap(c.effects, String(effectId), 'effect', (e) => ({ ...e, ...patch }) as Effect)
    }))
  );

export const removeEffectFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      effects: c.effects.filter((e) => e.id !== effectId)
    }))
  );

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

export const addInvariantToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariant: Invariant
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: [...c.invariants, invariant]
    }))
  );

export const updateInvariantOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: mustMap(c.invariants, String(invariantId), 'invariant', (i) => ({ ...i, ...patch }))
    }))
  );

export const removeInvariantFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariantId: InvariantId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: c.invariants.filter((i) => i.id !== invariantId)
    }))
  );

export const addInvariantToSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariant: Invariant
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: [...s.invariants, invariant]
  }));

export const updateInvariantOnSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: mustMap(s.invariants, String(invariantId), 'invariant', (i) => ({ ...i, ...patch }))
  }));

export const removeInvariantFromSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariantId: InvariantId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: s.invariants.filter((i) => i.id !== invariantId)
  }));

// ─── Feature-level invariants ─────────────────────────────────────────────
// Cross-surface invariants checked after every action regardless of which
// surface the action lives on. Mirrors the surface-level helpers above but
// against `feature.featureInvariants` instead of `surface.invariants`.

export const addFeatureInvariant = (feature: Feature, invariant: Invariant): Feature => ({
  ...feature,
  featureInvariants: [...(feature.featureInvariants ?? []), invariant]
});

export const updateFeatureInvariant = (
  feature: Feature,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature => ({
  ...feature,
  featureInvariants: mustMap(feature.featureInvariants ?? [], String(invariantId), 'featureInvariant', (i) => ({ ...i, ...patch }))
});

export const removeFeatureInvariant = (
  feature: Feature,
  invariantId: InvariantId
): Feature => ({
  ...feature,
  featureInvariants: (feature.featureInvariants ?? []).filter(
    (i) => i.id !== invariantId
  )
});

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

// ─── Personas ────────────────────────────────────────────────────────────────

export const addPersona = (feature: Feature, persona: Persona): Feature => ({
  ...feature,
  personas: [...feature.personas, persona]
});

export const updatePersona = (feature: Feature, persona: Persona): Feature => ({
  ...feature,
  personas: mustMap(feature.personas, String(persona.id), 'persona', () => persona)
});

export const removePersona = (feature: Feature, personaId: PersonaId): Feature => ({
  ...feature,
  personas: feature.personas.filter((p) => p.id !== personaId)
});

// ─── Resources ───────────────────────────────────────────────────────────────

export const addResource = (feature: Feature, resource: Resource): Feature => ({
  ...feature,
  resources: [...feature.resources, resource]
});

export const updateResource = (feature: Feature, resource: Resource): Feature => ({
  ...feature,
  resources: mustMap(feature.resources, String(resource.id), 'resource', () => resource)
});

export const removeResource = (feature: Feature, resourceId: ResourceId): Feature => ({
  ...feature,
  resources: feature.resources.filter((r) => r.id !== resourceId)
});

// ─── Entity ────────────────────────────────────────────────────────────────────

export const addEntity = (feature: Feature, data: Entity): Feature => ({
  ...feature,
  entities: [...feature.entities, data]
});

export const updateEntity = (feature: Feature, data: Entity): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(data.id), 'entity', () => data)
});

export const removeEntity = (feature: Feature, entityId: EntityId): Feature => ({
  ...feature,
  entities: feature.entities.filter((d) => d.id !== entityId)
});

export const addEntityField = (
  feature: Feature,
  entityId: EntityId,
  field: EntityField
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: [...d.fields, field]
  }))
});

export const removeEntityField = (
  feature: Feature,
  entityId: EntityId,
  fieldId: EntityFieldId
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: d.fields.filter((f) => f.id !== fieldId)
  }))
});

export const updateEntityField = (
  feature: Feature,
  entityId: EntityId,
  fieldId: EntityFieldId,
  patch: Partial<EntityField>
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: mustMap(d.fields, String(fieldId), 'entityField', (f) => ({ ...f, ...patch }))
  }))
});

// ─── Events ──────────────────────────────────────────────────────────────────

export const addEvent = (feature: Feature, event: EventDefinition): Feature => ({
  ...feature,
  events: [...(feature.events ?? []), event]
});

export const updateEvent = (feature: Feature, event: EventDefinition): Feature => ({
  ...feature,
  events: mustMap(feature.events ?? [], String(event.id), 'event', () => event)
});

export const removeEvent = (
  feature: Feature,
  eventId: EventDefinitionId
): Feature => ({
  ...feature,
  events: (feature.events ?? []).filter((e) => e.id !== eventId)
});
