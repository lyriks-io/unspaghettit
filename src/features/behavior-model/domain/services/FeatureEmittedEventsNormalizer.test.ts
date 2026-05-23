import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import { asEventName } from '../value-objects/EventName';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { normalizeFeatureEmittedEvents } from './FeatureEmittedEventsNormalizer';

const wrapFeature = (action: Action): Feature => {
  const surface: Surface = {
    id: asSurfaceId('s1'),
    name: 'Screen',
    type: 'screen',
    stateDefinitions: [],
    actions: [action],
    rules: [],
    invariants: [],
    transitions: []
  };
  return {
    id: asFeatureId('e'),
    name: 'F',
    surfaces: [surface],
    personas: [],
    resources: [],
    entities: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z'
  };
};

const baseAction: Action = {
  id: asActionId('c1'),
  name: 'Do',
  intent: 'd',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
};

describe('normalizeFeatureEmittedEvents', () => {
  it('mirrors emit_event effect names into emittedEvents', () => {
    const action: Action = {
      ...baseAction,
      effects: [
        { id: asEffectId('e1'), type: 'emit_event', event: asEventName('cart.placed') }
      ]
    };
    const next = normalizeFeatureEmittedEvents(wrapFeature(action));
    expect(next.surfaces[0]?.actions[0]?.emittedEvents.map(String)).toEqual([
      'cart.placed'
    ]);
  });

  it('unions effect names with manually-declared events without duplicating', () => {
    const action: Action = {
      ...baseAction,
      effects: [
        { id: asEffectId('e1'), type: 'emit_event', event: asEventName('a.b') }
      ],
      emittedEvents: [asEventName('a.b'), asEventName('c.d')]
    };
    const out = normalizeFeatureEmittedEvents(wrapFeature(action))
      .surfaces[0]!.actions[0]!.emittedEvents.map(String);
    expect(new Set(out)).toEqual(new Set(['a.b', 'c.d']));
    expect(out).toHaveLength(2);
  });

  it('does not strip declared events that have no corresponding effect', () => {
    const action: Action = {
      ...baseAction,
      emittedEvents: [asEventName('declared.but.unwired')]
    };
    const out = normalizeFeatureEmittedEvents(wrapFeature(action)).surfaces[0]!.actions[0]!
      .emittedEvents.map(String);
    expect(out).toEqual(['declared.but.unwired']);
  });

  it('picks up emit_event from rule effects and onBlockedEffects', () => {
    const action: Action = {
      ...baseAction,
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('x'), operator: 'is_true' },
          effect: { id: asEffectId('e1'), type: 'emit_event', event: asEventName('on.rule') }
        }
      ],
      onBlockedEffects: [
        { id: asEffectId('e2'), type: 'emit_event', event: asEventName('on.blocked') }
      ]
    };
    const out = new Set(
      normalizeFeatureEmittedEvents(wrapFeature(action))
        .surfaces[0]!.actions[0]!.emittedEvents.map(String)
    );
    expect(out).toContain('on.rule');
    expect(out).toContain('on.blocked');
  });

  it('is idempotent', () => {
    const action: Action = {
      ...baseAction,
      effects: [
        { id: asEffectId('e1'), type: 'emit_event', event: asEventName('a.b') }
      ]
    };
    const first = normalizeFeatureEmittedEvents(wrapFeature(action));
    const second = normalizeFeatureEmittedEvents(first);
    expect(second.surfaces[0]!.actions[0]!.emittedEvents.map(String)).toEqual(['a.b']);
  });
});
