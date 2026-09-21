import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Effect } from '../value-objects/Effect';
import { asEventName, type EventName } from '../value-objects/EventName';
import { asEffectId } from '../value-objects/ids';
import type { Surface } from '../entities/Surface';

/**
 * Keep an action's declared emissions and its emitting effects saying the same
 * thing, in BOTH directions. `emittedEvents` is what everyone reads as "this
 * action emits that"; an `emit_event` effect is what actually fires at runtime
 * (cascades, `triggeredByEvent` handlers). Letting the two drift is how a model
 * ends up declaring thirteen events that emit nothing.
 *
 *  - effect → declaration: every event an `emit_event` effect fires (on the
 *    action, its onBlocked fallbacks or one of its rules) is listed in
 *    `emittedEvents`, so the scorer stops flagging a plainly wired emission.
 *  - declaration → effect: every declared event that NO effect fires gets a
 *    default `emit_event` effect on the action, so the declaration means what
 *    its name promises: the event is emitted when the action succeeds.
 *
 * The synthesized effect carries a deterministic id (`eff-emit-<action>-<event>`),
 * so re-running finds its work done instead of appending a second copy, and a
 * saved feature keeps the same ids across loads.
 *
 * An event that must fire only under a condition is authored as an `emit_event`
 * effect on the rule that carries the condition: the name is then already
 * covered and nothing is synthesized for it.
 *
 * Strategy: union, never strip. Neither side loses what it declared.
 */
export const normalizeFeatureEmittedEvents = (feature: Feature): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map(normalizeSurface)
});

const normalizeSurface = (surface: Surface): Surface => ({
  ...surface,
  actions: surface.actions.map(normalizeAction)
});

const normalizeAction = (action: Action): Action => {
  const fromEffects = collectEmittedEventNames(action);

  // effect → declaration
  const declared = new Set(action.emittedEvents.map(String));
  let declarationsChanged = false;
  for (const name of fromEffects) {
    if (!declared.has(name)) {
      declared.add(name);
      declarationsChanged = true;
    }
  }

  // declaration → effect: what is declared and nothing fires.
  const unwired = [...declared].filter((name) => !fromEffects.has(name));
  const effects = unwired.length
    ? [...action.effects, ...unwired.map((name) => emitEffectFor(action, name))]
    : action.effects;

  if (!declarationsChanged && effects === action.effects) return action;
  return {
    ...action,
    ...(declarationsChanged
      ? { emittedEvents: [...declared].map((s) => asEventName(s)) as readonly EventName[] }
      : {}),
    effects
  };
};

/** The default emission of a declared event: deterministic id, no condition. */
const emitEffectFor = (action: Action, name: string): Effect => ({
  id: asEffectId(`eff-emit-${String(action.id)}-${name.replace(/\./g, '-')}`),
  type: 'emit_event',
  event: asEventName(name),
  description: `Emits "${name}" when ${action.name} succeeds (declared on the action).`
});

const collectEmittedEventNames = (action: Action): Set<string> => {
  const names = new Set<string>();
  const visit = (e: Effect) => {
    if (e.type === 'emit_event') names.add(String(e.event));
  };
  for (const e of action.effects) visit(e);
  for (const e of action.onBlockedEffects ?? []) visit(e);
  for (const r of action.rules) visit(r.effect);
  return names;
};
