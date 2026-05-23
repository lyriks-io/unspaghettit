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
import { AUTH_BLUEPRINT_IDS } from '../auth/shared';

export const cartBlueprint: SurfaceBlueprint = {
  id: COMMERCE_BLUEPRINT_IDS.cart,
  name: 'Cart',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Shopping cart with quantity edits, auth gate, and checkout entry.',
  description:
    'Cart review surface. Edits quantities, gates checkout on authentication, and emits navigation events. Cross-links to the auth library when both bundles are present (sign-in gate).',
  platforms: ['web', 'mobile'],
  tags: ['cart', 'checkout-gate', 'quantity'],
  siblings: [
    COMMERCE_BLUEPRINT_IDS.catalog,
    COMMERCE_BLUEPRINT_IDS.checkout,
    AUTH_BLUEPRINT_IDS.signIn
  ],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const cartResourceId = asResourceId('library-commerce-res-cart');

    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog)!,
        label: 'Continue shopping'
      },
      linkTargets.get(AUTH_BLUEPRINT_IDS.signIn) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.signIn)!,
        label: 'Sign in to checkout'
      },
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.checkout) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.checkout)!,
        label: 'Checkout'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Cart',
        type: 'screen',
        description:
          'Cart review with quantity edits, auth gate, and checkout entry. Empty-cart hint blocks navigation onward.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('cart.itemCount'),
            type: 'number',
            defaultValue: 0
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('cart.subtotal'),
            type: 'number',
            defaultValue: 0,
            description: 'Subtotal in cents.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'cart.itemCount ≥ 0',
            condition: {
              left: asStatePath('cart.itemCount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Cart count must be ≥ 0.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Update quantity',
            intent: 'Change the quantity of an item already in the cart.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'newQuantity',
                type: 'number',
                required: true,
                description: 'New quantity for the line item. Bound to cart.itemCount.',
                resourceId: cartResourceId,
                bindToStatePath: asStatePath('cart.itemCount'),
                validations: [{ type: 'min', value: 0 }, { type: 'integer' }]
              }
            ],
            requiredStates: [asStatePath('cart.itemCount')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('cart.itemCount'), operator: 'lower_than', right: 0 },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Quantity cannot be negative.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('cart.quantity.updated')
              }
            ],
            emittedEvents: [asEventName('cart.quantity.updated')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Proceed to checkout',
            intent: 'Move from the cart to checkout, gated on authentication.',
            parameters: [],
            requiredStates: [
              asStatePath('cart.itemCount'),
              asStatePath('user.authenticated')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: { left: asStatePath('cart.itemCount'), operator: 'equals', right: 0 },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Add something to your cart first.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in to continue to checkout.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('checkout.started')
              },
              ...(linkTargets.get(COMMERCE_BLUEPRINT_IDS.checkout)
                ? [
                    {
                      id: asEffectId(ids()),
                      type: 'transition_surface' as const,
                      target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.checkout)!
                    }
                  ]
                : [])
            ],
            emittedEvents: [asEventName('checkout.started')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Guest with items',
                description: 'Cart has items but the user is not signed in. Auth rule blocks.',
                stateOverrides: [
                  { path: asStatePath('cart.itemCount'), value: 2 },
                  { path: asStatePath('user.authenticated'), value: false }
                ],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Signed-in with items',
                description: 'Authenticated user with a non-empty cart. Checkout proceeds.',
                stateOverrides: [
                  { path: asStatePath('cart.itemCount'), value: 2 },
                  { path: asStatePath('user.authenticated'), value: true }
                ],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Empty cart',
                description: 'No items. Empty-cart rule blocks.',
                stateOverrides: [{ path: asStatePath('cart.itemCount'), value: 0 }],
                parameterOverrides: []
              }
            ]
          }
        ]
      },
      resources: commerceResources
    };
  }
};
