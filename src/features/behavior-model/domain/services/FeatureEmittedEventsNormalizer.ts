import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Effect } from '../value-objects/Effect';
import { asEventName, type EventName } from '../value-objects/EventName';
import type { Surface } from '../entities/Surface';

/**
 * Ensure `Action.emittedEvents` contains every event name that appears in
 * an `emit_event` effect anywhere on the action (effects, onBlockedEffects,
 * or rule effects). Declaring an emit_event effect without also listing the
 * event in `emittedEvents` is the most common bookkeeping mistake when
 * authoring via the MCP: the scorer's "event declarations" check then
 * flags the action as recommended even though the emission is plainly
 * wired. Auto-syncing here removes one redundant `update_action` op per
 * emit_event effect added.
 *
 * Strategy: union (merge, never strip). `emittedEvents` is also a
 * declaration of intent, entries with no matching effect today might
 * fire from outside the spec or be planned for later. Keep them.
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
  if (fromEffects.size === 0) return action;
  const existing = new Set(action.emittedEvents.map(String));
  let changed = false;
  for (const name of fromEffects) {
    if (!existing.has(name)) {
      existing.add(name);
      changed = true;
    }
  }
  if (!changed) return action;
  return {
    ...action,
    emittedEvents: [...existing].map((s) => asEventName(s)) as readonly EventName[]
  };
};

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
