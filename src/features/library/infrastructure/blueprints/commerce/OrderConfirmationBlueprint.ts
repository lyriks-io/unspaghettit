import {
  asActionId,
  asEffectId,
  asInvariantId,
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

export const orderConfirmationBlueprint: SurfaceBlueprint = {
  id: COMMERCE_BLUEPRINT_IDS.orderConfirmation,
  name: 'Order confirmation',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Post-purchase confirmation with order summary and cancel option.',
  description:
    'Shows the customer their order id and total. Cancel-order action is gated on order status (cancellable until shipped).',
  platforms: ['web', 'mobile'],
  tags: ['order', 'confirmation', 'cancel'],
  siblings: [COMMERCE_BLUEPRINT_IDS.catalog],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.catalog)!,
        label: 'Continue shopping'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Order confirmation',
        type: 'screen',
        description: 'Order summary screen shown after a successful purchase.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('order.status'),
            type: 'enum',
            enumValues: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'],
            defaultValue: 'paid'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('order.amount'),
            type: 'number',
            defaultValue: 0
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('order.id'),
            type: 'string',
            defaultValue: ''
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'order.id is observable',
            condition: { left: asStatePath('order.id'), operator: 'exists' },
            message: 'Order id must always be present on the confirmation surface.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Cancel order',
            intent: 'Customer-initiated cancellation while the order is still cancellable.',
            parameters: [],
            requiredStates: [asStatePath('order.status')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('order.status'),
                  operator: 'equals',
                  right: 'shipped'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Order has shipped. Contact support for a return.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('order.status'),
                  operator: 'equals',
                  right: 'cancelled'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Order is already cancelled.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: {
                  left: asStatePath('order.status'),
                  operator: 'equals',
                  right: 'delivered'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Order has been delivered. Start a return instead.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('order.status'),
                value: 'cancelled'
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('order.cancelled')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Order cancelled. Refund on its way.',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('order.cancelled')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Already shipped',
                description: 'Order has shipped. Cancel blocks.',
                stateOverrides: [{ path: asStatePath('order.status'), value: 'shipped' }],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Pending cancel',
                description: 'Order is paid but not yet shipped. Cancel succeeds.',
                stateOverrides: [{ path: asStatePath('order.status'), value: 'paid' }],
                parameterOverrides: []
              }
            ]
          }
        ]
      },
      resources: [
        commerceResources.find(
          (r) => r.id === asResourceId('library-commerce-res-orders')
        )!
      ]
    };
  }
};
