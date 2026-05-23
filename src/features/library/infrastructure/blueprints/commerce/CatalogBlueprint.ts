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

export const catalogBlueprint: SurfaceBlueprint = {
  id: COMMERCE_BLUEPRINT_IDS.catalog,
  name: 'Catalog',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Browse and search products. Empty-query hints, navigation to product details and cart.',
  description:
    'Storefront catalog page. Customers can search by keyword, navigate to product details, or jump to their cart. Search query binds to state so filter / suggestion rules can react.',
  platforms: ['web', 'mobile'],
  tags: ['catalog', 'search', 'browse', 'storefront'],
  siblings: [COMMERCE_BLUEPRINT_IDS.productDetails, COMMERCE_BLUEPRINT_IDS.cart],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const productsResourceId = asResourceId('library-commerce-res-products');

    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.productDetails) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.productDetails)!,
        label: 'Open product'
      },
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart)!,
        label: 'View cart'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Catalog',
        type: 'screen',
        description:
          'Open browsing surface. Anonymous and authenticated users can search and add to a cart.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('search.query'),
            type: 'string',
            defaultValue: '',
            description: 'Active keyword query. Bound from the search input.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('search.resultCount'),
            type: 'number',
            defaultValue: 0,
            description: 'Number of products matching the active query.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('cart.itemCount'),
            type: 'number',
            defaultValue: 0
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'search.resultCount is non-negative',
            condition: {
              left: asStatePath('search.resultCount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Result count must be ≥ 0.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Search products',
            intent: 'Run a keyword search and update the catalog grid.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'query',
                type: 'string',
                required: true,
                description: 'Keyword(s) typed by the user. Bound to search.query.',
                resourceId: productsResourceId,
                bindToStatePath: asStatePath('search.query'),
                validations: [{ type: 'max_length', value: 200 }]
              }
            ],
            requiredStates: [asStatePath('search.query')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('search.query'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'Type something to start searching.',
                  tone: 'info'
                },
                description: 'Soft hint when the query is empty. Non-blocking.'
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('catalog.search.executed')
              }
            ],
            emittedEvents: [asEventName('catalog.search.executed')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Empty query',
                description: 'User submits an empty search. Soft hint fires.',
                stateOverrides: [{ path: asStatePath('search.query'), value: '' }],
                parameterOverrides: [{ parameterName: 'query', value: '' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Specific keyword',
                description: 'A focused query that should match products.',
                stateOverrides: [{ path: asStatePath('search.resultCount'), value: 12 }],
                parameterOverrides: [{ parameterName: 'query', value: 'kindle' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'View cart',
            intent: 'Navigate to the cart surface.',
            parameters: [],
            requiredStates: [asStatePath('cart.itemCount')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'ux_feedback',
                condition: { left: asStatePath('cart.itemCount'), operator: 'equals', right: 0 },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'Your cart is empty.',
                  tone: 'info'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('navigation.cart.opened')
              },
              ...(linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart)
                ? [
                    {
                      id: asEffectId(ids()),
                      type: 'transition_surface' as const,
                      target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.cart)!
                    }
                  ]
                : [])
            ],
            emittedEvents: [asEventName('navigation.cart.opened')],
            transitions: []
          }
        ]
      },
      resources: commerceResources
    };
  }
};
