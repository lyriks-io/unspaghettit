import type { Action } from '../../entities/Action';
import type { Feature } from '../../entities/Feature';
import type { Surface } from '../../entities/Surface';
import type { ActionId, SurfaceId } from '../../value-objects/ids';

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
export const mustMap = <T extends { readonly id: string }>(
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

export const updateSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  fn: (s: Surface) => Surface
): Feature => ({
  ...feature,
  surfaces: mustMap(feature.surfaces, String(surfaceId), 'surface', fn)
});

export const updateActionIn = (
  surface: Surface,
  actionId: ActionId,
  fn: (c: Action) => Action
): Surface => ({
  ...surface,
  actions: mustMap(surface.actions, String(actionId), 'action', fn)
});

export const swapAt = <T>(items: readonly T[], a: number, b: number): readonly T[] => {
  if (a === b || a < 0 || b < 0 || a >= items.length || b >= items.length) return items;
  const next = items.slice();
  const tmp = next[a]!;
  next[a] = next[b]!;
  next[b] = tmp;
  return next;
};
