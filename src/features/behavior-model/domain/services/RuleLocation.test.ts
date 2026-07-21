import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { locateRule } from './RuleLocation';

const block = (id: string) =>
  ({ id: asEffectId(id), type: 'block_action', reason: 'nope' }) as const;

const surface: Surface = {
  id: asSurfaceId('checkout'),
  name: 'Checkout',
  type: 'screen',
  description: 'Where the order is placed.',
  stateDefinitions: [],
  rules: [
    {
      id: asRuleId('must-be-signed-in'),
      category: 'permissions',
      effect: block('e-surface'),
      description: 'Only signed-in users may check out'
    }
  ],
  invariants: [],
  transitions: [],
  actions: [
    {
      id: asActionId('place-order'),
      name: 'Place Order',
      intent: 'Submit the cart.',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('cart-not-empty'),
          category: 'validation',
          effect: block('e-action'),
          description: 'Cart must have at least one item'
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: []
    }
  ]
};

const feature: Feature = {
  id: asFeatureId('commerce'),
  name: 'Commerce',
  description: 'Buying flow.',
  surfaces: [surface],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z'
};

describe('locateRule', () => {
  it('finds a surface rule and reports its home surface', () => {
    expect(locateRule(feature, 'must-be-signed-in')).toEqual({
      kind: 'surface',
      surfaceId: asSurfaceId('checkout')
    });
  });

  it('finds an action rule and reports the owning surface and action', () => {
    expect(locateRule(feature, 'cart-not-empty')).toEqual({
      kind: 'action',
      surfaceId: asSurfaceId('checkout'),
      actionId: asActionId('place-order')
    });
  });

  it('returns null for an unknown rule id', () => {
    expect(locateRule(feature, 'no-such-rule')).toBeNull();
  });
});
