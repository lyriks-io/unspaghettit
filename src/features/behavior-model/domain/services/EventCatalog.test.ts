import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId
} from '../value-objects/ids';
import { asEventName } from '../value-objects/EventName';
import { asStatePath } from '../value-objects/StatePath';
import { buildEventCatalog, groupEventCatalog } from './EventCatalog';

const exp = (surfaces: readonly Surface[]): Feature => ({
  id: asFeatureId('e'),
  name: 'E',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
});

describe('EventCatalog', () => {
  it('collects events from emittedEvents, effects, and rule effects', () => {
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [],
      rules: [
        {
          id: asRuleId('sr1'),
          category: 'security',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: {
            id: asEffectId('se1'),
            type: 'emit_event',
            event: asEventName('audit.login.attempted')
          }
        }
      ],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId('c'),
          name: 'Cap',
          intent: '',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId('r1'),
              category: 'business',
              condition: { left: asStatePath('a.b'), operator: 'is_true' },
              effect: {
                id: asEffectId('e1'),
                type: 'emit_event',
                event: asEventName('cart.coupon.applied')
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('e2'),
              type: 'emit_event',
              event: asEventName('cart.item.added')
            }
          ],
          emittedEvents: [asEventName('cart.item.added')], // intent declaration matches the effect
          transitions: []
        }
      ]
    };
    const events = buildEventCatalog(exp([surface]));
    expect(events.map((e) => String(e.name))).toEqual([
      'audit.login.attempted',
      'cart.coupon.applied',
      'cart.item.added'
    ]);
    const cartItemAdded = events.find((e) => e.name === ('cart.item.added' as never));
    expect(cartItemAdded?.emissions).toHaveLength(2); // declared + effect
  });

  it('groups by leading namespace', () => {
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [],
      rules: [],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId('c'),
          name: 'Cap',
          intent: '',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [
            asEventName('order.placed'),
            asEventName('order.cancelled'),
            asEventName('cart.item.added')
          ],
          transitions: []
        }
      ]
    };
    const groups = groupEventCatalog(buildEventCatalog(exp([surface])));
    expect(groups.map((g) => g.group)).toEqual(['cart', 'order']);
    expect(groups[1]?.events.map((e) => String(e.name))).toEqual([
      'order.cancelled',
      'order.placed'
    ]);
  });
});
