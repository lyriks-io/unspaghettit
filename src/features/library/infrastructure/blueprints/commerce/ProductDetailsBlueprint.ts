import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { COMMERCE_BLUEPRINT_IDS, commerceResources } from './shared';

export const productDetailsBlueprint: SurfaceBlueprint = {
  id: COMMERCE_BLUEPRINT_IDS.productDetails,
  name: 'Product details',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Product page with stock-aware add-to-cart and age-gating.',
  description:
    'Standard PDP. Customers view a product, pick a quantity, and add it to the cart. Out-of-stock and age-restricted products are blocked at the rule layer.',
  platforms: ['web', 'mobile'],
  tags: ['product', 'pdp', 'add-to-cart', 'stock'],
  siblings: [COMMERCE_BLUEPRINT_IDS.catalog, COMMERCE_BLUEPRINT_IDS.cart],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const productsResourceId = asResourceId('library-commerce-res-products');
    const cartResourceId = asResourceId('library-commerce-res-cart');

    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog)!,
        label: 'Back to catalog'
      },
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart)!,
        label: 'Go to cart'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Product details',
        type: 'screen',
        description:
          'Detail page for a single product. Shows price, stock, add-to-cart button.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('product.viewing'),
            type: 'string',
            defaultValue: '',
            description: 'ID of the product currently displayed. Bound from "productId".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('product.stock'),
            type: 'number',
            defaultValue: 12,
            description: 'Stock count for the focused product.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('product.price'),
            type: 'number',
            defaultValue: 1999,
            description: 'Unit price in cents.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('product.ageRestricted'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.age'),
            type: 'number',
            defaultValue: 30
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('cart.itemCount'),
            type: 'number',
            defaultValue: 0
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.suspended'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'product.stock is non-negative',
            condition: {
              left: asStatePath('product.stock'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Stock must never go below zero.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'View product',
            intent: 'Open the product detail page.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'productId',
                type: 'string',
                required: true,
                description: 'ID of the product to display. Bound to product.viewing.',
                resourceId: productsResourceId,
                bindToStatePath: asStatePath('product.viewing'),
                validations: [{ type: 'non_empty' }, { type: 'slug' }]
              }
            ],
            requiredStates: [asStatePath('product.viewing'), asStatePath('product.ageRestricted')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('product.viewing'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'No product selected.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: {
                  left: asStatePath('user.age'),
                  operator: 'lower_than',
                  right: 18
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'You must be 18+ to view this product.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('product.viewed')
              }
            ],
            emittedEvents: [asEventName('product.viewed')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Underage on age-restricted',
                description: 'Under-18 user views an age-gated product. Block fires.',
                stateOverrides: [
                  { path: asStatePath('user.age'), value: 14 },
                  { path: asStatePath('product.ageRestricted'), value: true }
                ],
                parameterOverrides: [{ parameterName: 'productId', value: 'knife-set-pro' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Standard product',
                description: 'Adult user views a regular product. No rules block.',
                stateOverrides: [
                  { path: asStatePath('user.age'), value: 30 },
                  { path: asStatePath('product.ageRestricted'), value: false }
                ],
                parameterOverrides: [{ parameterName: 'productId', value: 'kindle-paperwhite' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Add to cart',
            intent: 'Add the focused product to the cart with the chosen quantity.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'quantity',
                type: 'number',
                required: true,
                defaultValue: 1,
                description: 'How many units to add.',
                resourceId: cartResourceId,
                validations: [{ type: 'min', value: 1 }, { type: 'integer' }]
              }
            ],
            requiredStates: [asStatePath('product.stock'), asStatePath('cart.itemCount')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.suspended'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Account is suspended. Cannot add to cart.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('product.stock'),
                  operator: 'lower_than',
                  right: 1
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Out of stock.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('product.viewing'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'No product selected.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('cart.itemCount'),
                value: 1
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('cart.item.added')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Added to cart.',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('cart.item.added')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Out of stock',
                description: 'Product has zero stock. Block fires.',
                stateOverrides: [{ path: asStatePath('product.stock'), value: 0 }],
                parameterOverrides: [{ parameterName: 'quantity', value: 1 }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Stock available, valid product. Action succeeds.',
                stateOverrides: [
                  { path: asStatePath('product.stock'), value: 10 },
                  { path: asStatePath('product.viewing'), value: 'kindle-paperwhite' }
                ],
                parameterOverrides: [{ parameterName: 'quantity', value: 1 }]
              }
            ]
          }
        ]
      },
      resources: commerceResources
    };
  }
};
