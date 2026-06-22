import type { Expression } from './Expression';
import type { EffectId, SurfaceId } from './ids';
import type { EventName } from './EventName';
import type { StatePath } from './StatePath';
import type { StateValue } from './StateValue';

export type EffectType =
  | 'set_state'
  | 'show_message'
  | 'emit_event'
  | 'block_action'
  | 'allow_action'
  | 'transition_surface'
  | 'append_to_list'
  | 'remove_from_list'
  | 'update_list_item';

/**
 * Writes `value` (or the result of `value` if it is an `Expression`) to the
 * state path at apply time. Accepting an Expression lets a tick express
 * `x + vx`, `min(health, 100)`, `count + 1` etc. without forcing the modeler
 * to flatten the math into multiple rules or describe it in prose.
 */
export type SetStateEffect = {
  readonly id: EffectId;
  readonly type: 'set_state';
  readonly path: StatePath;
  readonly value: StateValue | Expression;
  readonly description?: string;
};

export type ShowMessageEffect = {
  readonly id: EffectId;
  readonly type: 'show_message';
  readonly message: string;
  readonly tone?: 'info' | 'success' | 'warning' | 'error';
  readonly description?: string;
};

export type EmitEventEffect = {
  readonly id: EffectId;
  readonly type: 'emit_event';
  readonly event: EventName;
  readonly description?: string;
};

export type BlockActionEffect = {
  readonly id: EffectId;
  readonly type: 'block_action';
  readonly reason: string;
  readonly description?: string;
};

export type AllowActionEffect = {
  readonly id: EffectId;
  readonly type: 'allow_action';
  readonly description?: string;
};

export type TransitionSurfaceEffect = {
  readonly id: EffectId;
  readonly type: 'transition_surface';
  readonly target: SurfaceId;
  readonly description?: string;
};

/**
 * Predicate that selects elements inside an array-typed state path. Matches
 * an object element when `element[field]` deep-equals the resolved `equals`
 * value (an Expression so the comparand can be a param, another state path,
 * or a literal). Used by `remove_from_list` and `update_list_item` so a modeler
 * can say "the cart line whose productId equals the `productId` parameter"
 * without numeric indices (which state paths can't express).
 */
export type ListItemMatch = {
  readonly field: string;
  readonly equals: StateValue | Expression;
};

/**
 * Appends `item` to the array at `path`. When the path holds no array yet
 * (undefined / wrong type) the engine treats it as an empty list and writes
 * `[item]`, so "add the first item to an empty cart" needs no separate seed.
 * `item` may be an Expression (e.g. a `param` carrying the object to push, or
 * an arithmetic result for an array of numbers). The grow half of collection
 * support that `set_state` (whole-value overwrite) could never express.
 */
export type AppendToListEffect = {
  readonly id: EffectId;
  readonly type: 'append_to_list';
  readonly path: StatePath;
  readonly item: StateValue | Expression;
  readonly description?: string;
};

/**
 * Removes elements from the array at `path`. Selector is exactly one of:
 *   - `where`: drop object elements matching the field predicate.
 *   - `value`: drop elements deep-equal to the resolved value (arrays of
 *     scalars, or whole-object equality).
 * With neither selector the effect is a no-op — we never implicitly clear a
 * whole list (use `set_state` with `[]` for that, explicitly).
 */
export type RemoveFromListEffect = {
  readonly id: EffectId;
  readonly type: 'remove_from_list';
  readonly path: StatePath;
  readonly where?: ListItemMatch;
  readonly value?: StateValue | Expression;
  readonly description?: string;
};

/**
 * Sets `field` to the resolved `value` on every object element of the array
 * at `path` that matches the `where` predicate. The in-place mutation half of
 * collection support: "set qty to the `qty` param on the cart line whose
 * productId matches" without rebuilding the whole array. Set multiple fields
 * with multiple effects.
 */
export type UpdateListItemEffect = {
  readonly id: EffectId;
  readonly type: 'update_list_item';
  readonly path: StatePath;
  readonly where: ListItemMatch;
  readonly field: string;
  readonly value: StateValue | Expression;
  readonly description?: string;
};

export type Effect =
  | SetStateEffect
  | ShowMessageEffect
  | EmitEventEffect
  | BlockActionEffect
  | AllowActionEffect
  | TransitionSurfaceEffect
  | AppendToListEffect
  | RemoveFromListEffect
  | UpdateListItemEffect;

export const ALL_EFFECT_TYPES: readonly EffectType[] = [
  'set_state',
  'show_message',
  'emit_event',
  'block_action',
  'allow_action',
  'transition_surface',
  'append_to_list',
  'remove_from_list',
  'update_list_item'
];

export const effectTypeLabel = (t: EffectType): string => {
  switch (t) {
    case 'set_state':
      return 'Set state';
    case 'show_message':
      return 'Show message';
    case 'emit_event':
      return 'Emit event';
    case 'block_action':
      return 'Block action';
    case 'allow_action':
      return 'Allow action';
    case 'transition_surface':
      return 'Transition to surface';
    case 'append_to_list':
      return 'Append to list';
    case 'remove_from_list':
      return 'Remove from list';
    case 'update_list_item':
      return 'Update list item';
  }
};

export const isBlockingEffect = (e: Effect): e is BlockActionEffect => e.type === 'block_action';
