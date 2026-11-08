import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ActionId, SurfaceId } from '$features/behavior-model/domain/value-objects/ids';

/** A part of an action that is edited inside the action's own card. */
export type ActionPartKind = 'scenario' | 'parameter';

export type ActionPartLocation = { readonly surfaceId: SurfaceId; readonly actionId: ActionId };

/**
 * Resolve a scenario or a parameter id to the action that holds it. Both are
 * edited inside their action's card, so a deep link to one
 * (`?focus=scenario:<id>`, `?focus=parameter:<id>`) must select that surface and
 * expand that action before the focus observer can find the row. Ids are unique
 * within a feature. Returns null when no action holds it.
 */
export const locateActionPart = (
  feature: Feature,
  kind: ActionPartKind,
  id: string
): ActionPartLocation | null => {
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      const parts = kind === 'scenario' ? (action.scenarios ?? []) : action.parameters;
      if (parts.some((part) => String(part.id) === id)) {
        return { surfaceId: surface.id, actionId: action.id };
      }
    }
  }
  return null;
};
