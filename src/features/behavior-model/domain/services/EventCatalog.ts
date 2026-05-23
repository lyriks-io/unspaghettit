import type { Feature } from '../entities/Feature';
import type { EventName } from '../value-objects/EventName';

/**
 * Where an event is emitted from. Used for navigation deep-links and so the
 * UI can show the user "this event fires from these N places".
 */
export type EventEmissionSource = {
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId?: string;
  readonly actionName?: string;
  /** Whether the emission is a default action-level event or fired by a rule. */
  readonly origin: 'action_default' | 'action_effect' | 'action_rule_effect' | 'surface_rule_effect';
  readonly description?: string;
};

export type EventEntry = {
  readonly name: EventName;
  /** Group by the leading dot-segment ("cart" in "cart.item.added"). */
  readonly group: string;
  readonly emissions: readonly EventEmissionSource[];
};

const groupOf = (name: string): string => {
  const seg = name.split('.')[0];
  return seg && seg.length > 0 ? seg : '_root';
};

/**
 * Walk the feature and collect every event emitted across:
 *  - action.emittedEvents (intent-level declarations)
 *  - action.effects (emit_event default effects)
 *  - action.rules.effect (emit_event when a rule fires)
 *  - surface.rules.effect (emit_event surface-level rules)
 *
 * Output is grouped by the event's namespace and sorted alphabetically. Each
 * unique event collapses every occurrence into a single entry with all its
 * emission sources, so the user sees "order.placed (3 places)" once instead
 * of three times.
 */
export const buildEventCatalog = (feature: Feature): readonly EventEntry[] => {
  const byName = new Map<string, EventEmissionSource[]>();

  const push = (name: string, source: EventEmissionSource) => {
    let list = byName.get(name);
    if (!list) {
      list = [];
      byName.set(name, list);
    }
    list.push(source);
  };

  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      // Declared intent-level events.
      for (const evt of cap.emittedEvents) {
        push(String(evt), {
          surfaceId: surface.id as unknown as string,
          surfaceName: surface.name,
          actionId: cap.id as unknown as string,
          actionName: cap.name,
          origin: 'action_default'
        });
      }
      // Default effects on success.
      for (const effect of cap.effects) {
        if (effect.type === 'emit_event') {
          push(String(effect.event), {
            surfaceId: surface.id as unknown as string,
            surfaceName: surface.name,
            actionId: cap.id as unknown as string,
            actionName: cap.name,
            origin: 'action_effect',
            description: effect.description
          });
        }
      }
      // Effects produced by rules on the action.
      for (const rule of cap.rules) {
        if (rule.effect.type === 'emit_event') {
          push(String(rule.effect.event), {
            surfaceId: surface.id as unknown as string,
            surfaceName: surface.name,
            actionId: cap.id as unknown as string,
            actionName: cap.name,
            origin: 'action_rule_effect',
            description: rule.description
          });
        }
      }
    }
    // Surface-level rule effects.
    for (const rule of surface.rules) {
      if (rule.effect.type === 'emit_event') {
        push(String(rule.effect.event), {
          surfaceId: surface.id as unknown as string,
          surfaceName: surface.name,
          origin: 'surface_rule_effect',
          description: rule.description
        });
      }
    }
  }

  const entries: EventEntry[] = [];
  for (const [name, emissions] of byName) {
    entries.push({
      name: name as unknown as EventName,
      group: groupOf(name),
      emissions
    });
  }
  entries.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return String(a.name).localeCompare(String(b.name));
  });
  return entries;
};

export type EventCatalogGroup = {
  readonly group: string;
  readonly events: readonly EventEntry[];
};

export const groupEventCatalog = (
  entries: readonly EventEntry[]
): readonly EventCatalogGroup[] => {
  const map = new Map<string, EventEntry[]>();
  for (const entry of entries) {
    let list = map.get(entry.group);
    if (!list) {
      list = [];
      map.set(entry.group, list);
    }
    list.push(entry);
  }
  return Array.from(map.entries())
    .map(([group, events]) => ({ group, events }))
    .sort((a, b) => a.group.localeCompare(b.group));
};
