import type { EventName } from '../value-objects/EventName';
import type { EventDefinitionId } from '../value-objects/ids';
import type { StateType } from '../value-objects/StateValue';

/**
 * One field on an event's payload. Matches the shape Parameter uses for its
 * inputs so the LLM can read a single mental model: name + type + required.
 * `type` is restricted to the basic state primitives + object/array. This is
 * a documentation schema, not a runtime validator, so we don't need every
 * Parameter format here.
 */
export type EventPayloadField = {
  readonly name: string;
  readonly type: StateType;
  readonly required: boolean;
  readonly description?: string;
};

/**
 * How much the emitting action depends on this event's handlers succeeding.
 *
 *   - `best_effort` (default): fire-and-forget. A handler that fails is
 *     reported but never affects the emitter — the historical behavior.
 *   - `required`: the emitter cannot be a clean success if a handler fails.
 *     Models "the command was accepted but the mandatory downstream update
 *     failed" — the emitter is reported blocked, its own state changes stand.
 *   - `transactional`: all-or-nothing. A failing handler rolls the emitter's
 *     state back to before the action ran, so nothing partial lands.
 */
export type EventDelivery = 'best_effort' | 'required' | 'transactional';

export const ALL_EVENT_DELIVERIES: readonly EventDelivery[] = [
  'best_effort',
  'required',
  'transactional'
];

/**
 * First-class event registered on the Feature. Action.emittedEvents
 * and emit_event effects reference these by name. Making events explicit
 * lets the dashboard show "this event has N producers and a known payload"
 * instead of treating every emission as an anonymous string.
 *
 * Subscribers are not stored on the definition (actions subscribe via
 * surface_rule conditions on a state path that an emit_event writes); the
 * EventCatalog service still derives the "where is this fired from" view
 * from the existing emission traversal.
 */
export type EventDefinition = {
  readonly id: EventDefinitionId;
  readonly name: EventName;
  readonly description?: string;
  readonly payloadSchema?: readonly EventPayloadField[];
  /**
   * Delivery guarantee for this event's handlers. Absent means `best_effort`
   * (fire-and-forget), which is the historical behavior. `required` /
   * `transactional` make a handler failure propagate to the emitting action.
   */
  readonly delivery?: EventDelivery;
};
