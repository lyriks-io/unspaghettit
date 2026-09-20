import { describe, expect, it } from 'vitest';
import { asEventName } from '../value-objects/EventName';
import { ALL_ACTION_ACTORS, effectiveActor } from './Action';

describe('effectiveActor', () => {
  it('reads an action that says nothing as fired by a person', () => {
    expect(effectiveActor({})).toBe('user');
  });

  it('reads an event handler that says nothing as fired by an event', () => {
    expect(effectiveActor({ triggeredByEvent: asEventName('order.placed') })).toBe('event');
  });

  it('lets a declared actor win over the derivation, on a handler too', () => {
    for (const actor of ALL_ACTION_ACTORS) {
      expect(effectiveActor({ actor })).toBe(actor);
      expect(effectiveActor({ actor, triggeredByEvent: asEventName('order.placed') })).toBe(actor);
    }
  });

  it('does not need a modeled event to be event-fired', () => {
    expect(effectiveActor({ actor: 'event' })).toBe('event');
  });
});
