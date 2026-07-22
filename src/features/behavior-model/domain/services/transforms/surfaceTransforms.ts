import type { Feature } from '../../entities/Feature';
import type { StateDefinition } from '../../entities/StateDefinition';
import type { Surface } from '../../entities/Surface';
import type { StateDefinitionId, SurfaceId } from '../../value-objects/ids';
import { EntityNotFoundInFeatureError, swapAt, updateSurface } from './internal';

export const addSurface = (feature: Feature, surface: Surface): Feature => ({
  ...feature,
  surfaces: [...feature.surfaces, surface]
});

export const removeSurface = (feature: Feature, surfaceId: SurfaceId): Feature => ({
  ...feature,
  surfaces: feature.surfaces.filter((s) => s.id !== surfaceId)
});

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
  patch: Partial<Pick<Surface, 'name' | 'type' | 'description' | 'presentation'>>
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
