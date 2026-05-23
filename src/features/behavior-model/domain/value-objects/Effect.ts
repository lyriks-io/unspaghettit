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
  | 'transition_surface';

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

export type Effect =
  | SetStateEffect
  | ShowMessageEffect
  | EmitEventEffect
  | BlockActionEffect
  | AllowActionEffect
  | TransitionSurfaceEffect;

export const ALL_EFFECT_TYPES: readonly EffectType[] = [
  'set_state',
  'show_message',
  'emit_event',
  'block_action',
  'allow_action',
  'transition_surface'
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
  }
};

export const isBlockingEffect = (e: Effect): e is BlockActionEffect => e.type === 'block_action';
