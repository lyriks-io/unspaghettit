import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asPersonaId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { buildSearchDocs } from './buildSearchDocs';
import type { SearchDoc, SearchEntityKind } from './SearchDoc';

const surface: Surface = {
  id: asSurfaceId('checkout'),
  name: 'Checkout',
  type: 'screen',
  description: 'Where the order is placed.',
  stateDefinitions: [
    {
      id: asStateDefinitionId('cart-count'),
      path: asStatePath('cart.itemCount'),
      type: 'number',
      defaultValue: 0
    }
  ],
  rules: [
    {
      id: asRuleId('require-items'),
      category: 'validation',
      effect: {
        id: asEffectId('block-empty'),
        type: 'block_action',
        reason: 'Cart is empty'
      },
      description: 'Block checkout when the cart is empty'
    }
  ],
  invariants: [
    {
      id: asInvariantId('count-non-negative'),
      name: 'Item count never negative',
      condition: { left: asStatePath('cart.itemCount'), operator: 'greater_than', right: 0 },
      message: 'cart.itemCount must be >= 0'
    }
  ],
  transitions: [],
  actions: [
    {
      id: asActionId('apply-coupon'),
      name: 'Apply Coupon',
      intent: 'Apply a discount code to the cart.',
      parameters: [
        {
          id: asParameterId('code'),
          name: 'couponCode',
          type: 'string',
          required: true,
          description: 'The discount code to apply.'
        }
      ],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('set-discount'),
          type: 'set_state',
          path: asStatePath('cart.discount'),
          value: 10
        }
      ],
      emittedEvents: [],
      transitions: []
    }
  ]
};

const feature: Feature = {
  id: asFeatureId('commerce'),
  name: 'Commerce',
  description: 'Buying flow.',
  tags: [{ type: 'domain', value: 'sales' }],
  surfaces: [surface],
  personas: [
    {
      id: asPersonaId('vip'),
      name: 'VIP Customer',
      description: 'A returning premium buyer.',
      stateOverrides: [],
      parameterOverrides: []
    }
  ],
  resources: [],
  entities: [
    {
      id: asEntityId('cart'),
      namespace: 'cart',
      description: 'Shopping cart.',
      fields: [
        {
          id: asEntityFieldId('item-count'),
          name: 'itemCount',
          type: 'number',
          description: 'How many items.'
        }
      ]
    }
  ],
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

const input = {
  projects: [
    {
      id: 'shop',
      name: 'Shop',
      description: 'The storefront.',
      tags: [{ type: 'team', value: 'growth' }],
      featureIds: ['commerce']
    }
  ],
  features: [feature],
  domains: [{ id: 'sales-domain', name: 'Sales', description: 'Revenue area.' }]
};

const byKind = (docs: readonly SearchDoc[], kind: SearchEntityKind): SearchDoc[] =>
  docs.filter((d) => d.kind === kind);

describe('buildSearchDocs', () => {
  const docs = buildSearchDocs(input);

  it('emits a doc for every modeled element kind', () => {
    const kinds = new Set(docs.map((d) => d.kind));
    for (const kind of [
      'domain',
      'project',
      'feature',
      'surface',
      'action',
      'parameter',
      'rule',
      'invariant',
      'effect',
      'state',
      'persona',
      'entity',
      'entity-field'
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('threads breadcrumb context onto nested elements', () => {
    const action = byKind(docs, 'action')[0]!;
    expect(action.title).toBe('Apply Coupon');
    expect(action.featureName).toBe('Commerce');
    expect(action.surfaceName).toBe('Checkout');
    expect(action.projectName).toBe('Shop');
  });

  it('deep-links an action to its focus anchor on the right surface', () => {
    const action = byKind(docs, 'action')[0]!;
    expect(action.nav.href).toBe(
      '/features/commerce?surface=checkout&focus=action%3Aapply-coupon'
    );
  });

  it('humanizes the state path for display but keeps the raw path searchable', () => {
    const state = byKind(docs, 'state')[0]!;
    expect(state.title).toBe('Cart item count');
    expect(state.haystack).toContain('cart.itemcount');
    expect(state.nav.href).toContain('panel=state');
  });

  it('folds tags into the owning project/feature haystack', () => {
    const project = byKind(docs, 'project')[0]!;
    expect(project.haystack).toContain('growth');
    const feat = byKind(docs, 'feature')[0]!;
    expect(feat.haystack).toContain('sales');
  });

  it('summarizes effects for both display and matching', () => {
    const effect = byKind(docs, 'effect')[0]!;
    expect(effect.title).toContain('Set cart.discount');
    expect(effect.haystack).toContain('set cart.discount');
  });

  it('gives every doc a unique id', () => {
    const ids = docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
