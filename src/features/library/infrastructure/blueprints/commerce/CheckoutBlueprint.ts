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

export const checkoutBlueprint: SurfaceBlueprint = {
  id: COMMERCE_BLUEPRINT_IDS.checkout,
  name: 'Checkout',
  category: 'commerce',
  surfaceType: 'workflow',
  summary: 'Multi-step checkout: address, payment, place order. PCI-aware.',
  description:
    'Multi-step purchase flow. Each step is gated by the previous one (address → payment → review → place). Place order runs fraud + compliance rules and emits the order.placed event.',
  platforms: ['web', 'mobile'],
  tags: ['checkout', 'payment', 'pci', 'fraud', 'compliance'],
  siblings: [COMMERCE_BLUEPRINT_IDS.cart, COMMERCE_BLUEPRINT_IDS.orderConfirmation],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const paymentsResourceId = asResourceId('library-commerce-res-payments');

    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart)!,
        label: 'Back to cart'
      },
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.orderConfirmation) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.orderConfirmation)!,
        label: 'Order confirmation'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Checkout',
        type: 'workflow',
        description:
          'Linear three-step checkout. State machine progresses through address → payment → review.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('checkout.step'),
            type: 'enum',
            enumValues: ['address', 'payment', 'review'],
            defaultValue: 'address',
            description: 'Active step in the checkout funnel.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('payment.method'),
            type: 'enum',
            enumValues: ['card', 'paypal', 'gift_card'],
            defaultValue: 'card'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('payment.cardValid'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('shipping.addressConfirmed'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('order.amount'),
            type: 'number',
            defaultValue: 0,
            description: 'Order total in cents.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('fraud.flagged'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [
          {
            id: asRuleId(ids()),
            category: 'security',
            condition: { left: asStatePath('fraud.flagged'), operator: 'is_true' },
            effect: {
              id: asEffectId(ids()),
              type: 'block_action',
              reason: 'This account is under review and cannot place orders.'
            },
            description:
              'Surface-level fraud gate. Blocks every action if the account is flagged.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'order.amount is non-negative',
            condition: {
              left: asStatePath('order.amount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Order total must be ≥ 0.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Select payment method',
            intent: 'Pick how the customer will pay and advance to review.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'method',
                type: 'enum',
                enumValues: ['card', 'paypal', 'gift_card'],
                required: true,
                description: 'Payment method picked. Bound to payment.method.',
                resourceId: paymentsResourceId,
                bindToStatePath: asStatePath('payment.method')
              }
            ],
            requiredStates: [
              asStatePath('checkout.step'),
              asStatePath('shipping.addressConfirmed'),
              asStatePath('payment.cardValid'),
              asStatePath('fraud.flagged')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: { left: asStatePath('fraud.flagged'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Account under review. Cannot select a payment method.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('checkout.step'),
                  operator: 'not_equals',
                  right: 'payment'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'You are not on the payment step.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('shipping.addressConfirmed'),
                  operator: 'is_false'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Confirm a shipping address first.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('payment.cardValid'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Card declined. Try a different payment method.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('checkout.step'),
                value: 'review'
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('checkout.payment.selected')
              }
            ],
            emittedEvents: [asEventName('checkout.payment.selected')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Place order',
            intent: 'Finalize the order, run fraud + compliance, advance to confirmation.',
            parameters: [],
            requiredStates: [
              asStatePath('checkout.step'),
              asStatePath('order.amount'),
              asStatePath('fraud.flagged')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('checkout.step'),
                  operator: 'not_equals',
                  right: 'review'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Complete the previous steps first.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: {
                  left: asStatePath('order.amount'),
                  operator: 'greater_than',
                  right: 200000
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'Large order. Additional review may apply.',
                  tone: 'warning'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('order.placed')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Order placed. Confirmation on its way.',
                tone: 'success'
              },
              ...(linkTargets.get(COMMERCE_BLUEPRINT_IDS.orderConfirmation)
                ? [
                    {
                      id: asEffectId(ids()),
                      type: 'transition_surface' as const,
                      target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.orderConfirmation)!
                    }
                  ]
                : [])
            ],
            emittedEvents: [asEventName('order.placed')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Wrong step',
                description: 'Customer is on the address step. Place order should block.',
                stateOverrides: [
                  { path: asStatePath('checkout.step'), value: 'address' },
                  { path: asStatePath('fraud.flagged'), value: false }
                ],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Fraud flagged',
                description: 'Account is flagged. Surface-level rule blocks.',
                stateOverrides: [{ path: asStatePath('fraud.flagged'), value: true }],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Large order',
                description: 'Order over $2,000. Compliance warning fires (non-blocking).',
                stateOverrides: [
                  { path: asStatePath('checkout.step'), value: 'review' },
                  { path: asStatePath('fraud.flagged'), value: false },
                  { path: asStatePath('order.amount'), value: 250000 }
                ],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Standard order. Action succeeds.',
                stateOverrides: [
                  { path: asStatePath('checkout.step'), value: 'review' },
                  { path: asStatePath('fraud.flagged'), value: false },
                  { path: asStatePath('order.amount'), value: 4598 }
                ],
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
