import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';

const now = '2026-05-08T12:00:00.000Z';

const CATALOG_ID = asSurfaceId('seed-shop-catalog');
const CART_ID = asSurfaceId('seed-shop-cart');
const CHECKOUT_ID = asSurfaceId('seed-shop-checkout');
const ORDER_ID = asSurfaceId('seed-shop-order');

const withDescription = <T extends { readonly id?: string; readonly name?: string; readonly description?: string }>(
  value: T,
  fallback: string
): T =>
  value.description?.trim()
    ? value
    : {
        ...value,
        description: fallback
      };

const withRequiredDescriptions = (feature: Feature): Feature =>
  withDescription(
    {
      ...feature,
      surfaces: feature.surfaces.map((surface) =>
        withDescription(
          {
            ...surface,
            stateDefinitions: surface.stateDefinitions.map((state) =>
              withDescription(state, `State value for ${state.path}.`)
            ),
            rules: surface.rules.map((rule) =>
              withDescription(
                {
                  ...rule,
                  effect: withDescription(rule.effect, `Effect for surface rule ${rule.id}.`)
                },
                `Surface rule ${rule.id} on ${surface.name}.`
              )
            ),
            invariants: surface.invariants.map((invariant) =>
              withDescription(invariant, `Invariant "${invariant.name}" on ${surface.name}.`)
            ),
            transitions: surface.transitions.map((transition) =>
              withDescription(
                transition,
                `Navigation from ${surface.name} to ${transition.target}.`
              )
            ),
            actions: surface.actions.map((action) => ({
              ...action,
              parameters: action.parameters.map((parameter) =>
                withDescription(parameter, `Input parameter "${parameter.name}".`)
              ),
              rules: action.rules.map((rule) =>
                withDescription(
                  {
                    ...rule,
                    effect: withDescription(rule.effect, `Effect for rule ${rule.id}.`)
                  },
                  `Rule ${rule.id} for action "${action.name}".`
                )
              ),
              effects: action.effects.map((effect) =>
                withDescription(effect, `Effect for action "${action.name}".`)
              ),
              onBlockedEffects: action.onBlockedEffects?.map((effect) =>
                withDescription(effect, `Blocked-action effect for "${action.name}".`)
              ),
              invariants: action.invariants.map((invariant) =>
                withDescription(invariant, `Invariant "${invariant.name}" for ${action.name}.`)
              ),
              scenarios: action.scenarios?.map((scenario) =>
                withDescription(
                  {
                    ...scenario,
                    expectedAssertions: scenario.expectedAssertions?.map((assertion) =>
                      withDescription(assertion, `Expected assertion for ${assertion.path}.`)
                    )
                  },
                  `Scenario "${scenario.name}" for ${action.name}.`
                )
              )
            }))
          },
          `Surface "${surface.name}" in the storefront sample.`
        )
      ),
      personas: feature.personas.map((persona) =>
        withDescription(persona, `Persona "${persona.name}" for the storefront sample.`)
      ),
      resources: feature.resources.map((resource) =>
        withDescription(resource, `Resource "${resource.name}" for the storefront sample.`)
      ),
      entities: feature.entities.map((entity) =>
        withDescription(
          {
            ...entity,
            fields: entity.fields.map((field) =>
              withDescription(field, `Field "${field.name}" in ${entity.namespace}.`)
            )
          },
          `Entity "${entity.namespace}" for the storefront sample.`
        )
      ),
      events: feature.events?.map((event) =>
        withDescription(
          {
            ...event,
            payloadSchema: event.payloadSchema?.map((field) =>
              withDescription(field, `Payload field "${field.name}" for ${event.name}.`)
            )
          },
          `Event "${event.name}" in the storefront sample.`
        )
      )
    },
    'Sample e-commerce storefront behavior model.'
  );

const storefrontFeatureData: Feature = {
  id: asFeatureId('seed-shop'),
  name: 'E-commerce storefront',
  description:
    'Amazon-like online store. Demonstrates a full multi-surface flow with catalog, cart, checkout, and order confirmation. Covers stock validation, authentication gates, coupon logic, free-shipping thresholds, fraud limits, cancellation policy, and surface transitions.',
  createdAt: now,
  updatedAt: now,
  personas: [],
  resources: [],
  entities: [],
  surfaces: [
    // ── Catalog ────────────────────────────────────────────────────────────
    {
      id: CATALOG_ID,
      name: 'Catalog',
      type: 'screen',
      description: 'Browse and search products. Add items directly to the cart.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('seed-shop-catalog-state-query'),
          path: asStatePath('search.query'),
          type: 'string',
          defaultValue: '',
          description: 'Active search query.'
        },
        {
          id: asStateDefinitionId('seed-shop-catalog-state-results'),
          path: asStatePath('search.resultCount'),
          type: 'number',
          defaultValue: 0,
          description: 'Number of products returned by the current query.'
        },
        {
          id: asStateDefinitionId('seed-shop-catalog-state-stock'),
          path: asStatePath('product.stock'),
          type: 'number',
          defaultValue: 12,
          description: 'Available stock for the focused product.'
        },
        {
          id: asStateDefinitionId('seed-shop-catalog-state-price'),
          path: asStatePath('product.price'),
          type: 'number',
          defaultValue: 1999,
          description: 'Unit price of the focused product, in cents.'
        },
        {
          id: asStateDefinitionId('seed-shop-catalog-state-cart-count'),
          path: asStatePath('cart.itemCount'),
          type: 'number',
          defaultValue: 0
        },
        {
          id: asStateDefinitionId('seed-shop-catalog-state-cart-subtotal'),
          path: asStatePath('cart.subtotal'),
          type: 'number',
          defaultValue: 0,
          description: 'Cart subtotal in cents.'
        }
      ],
      rules: [],
      invariants: [
        {
          id: asInvariantId('seed-shop-catalog-invariant-stock-non-negative'),
          name: 'product.stock is non-negative',
          condition: {
            left: asStatePath('product.stock'),
            operator: 'greater_than',
            right: -1
          },
          message: 'Stock must never go below zero.'
        }
      ],
      transitions: [
        {
          id: asEffectId('seed-shop-catalog-transition-cart') as never,
          target: CART_ID,
          label: 'View cart'
        }
      ],
      actions: [
        {
          id: asActionId('seed-shop-cap-search'),
          name: 'Search products',
          intent: 'Run a keyword search and update the visible result list.',
          parameters: [
            {
              id: asParameterId('seed-shop-param-query'),
              name: 'query',
              type: 'string',
              required: true,
              description: 'The search keywords typed by the user.'
            }
          ],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-set-query'),
              type: 'set_state',
              path: asStatePath('search.query'),
              value: 'placeholder'
            },
            {
              id: asEffectId('seed-shop-effect-emit-search'),
              type: 'emit_event',
              event: asEventName('catalog.search.executed')
            }
          ],
          emittedEvents: [asEventName('catalog.search.executed')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-add-to-cart'),
          name: 'Add to cart',
          intent:
            'Add the focused product to the cart, validating stock and updating cart counters.',
          parameters: [
            {
              id: asParameterId('seed-shop-param-quantity'),
              name: 'quantity',
              type: 'number',
              required: true,
              defaultValue: 1,
              description: 'Number of units to add (1–10).'
            }
          ],
          requiredStates: [
            asStatePath('product.stock'),
            asStatePath('cart.itemCount'),
            asStatePath('cart.subtotal')
          ],
          rules: [
            {
              id: asRuleId('seed-shop-rule-out-of-stock'),
              category: 'business',
              condition: {
                left: asStatePath('product.stock'),
                operator: 'lower_than',
                right: 1
              },
              effect: {
                id: asEffectId('seed-shop-effect-out-of-stock'),
                type: 'block_action',
                reason: 'Out of stock'
              }
            },
            {
              id: asRuleId('seed-shop-rule-quantity-bound'),
              category: 'validation',
              condition: {
                left: asStatePath('product.stock'),
                operator: 'lower_than',
                right: 1
              },
              effect: {
                id: asEffectId('seed-shop-effect-quantity-bound'),
                type: 'show_message',
                message: 'Cannot add more than the available stock.',
                tone: 'warning'
              },
              description:
                'In a real system the quantity would be compared to product.stock. This rule keeps it simple.'
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-inc-cart-count'),
              type: 'set_state',
              path: asStatePath('cart.itemCount'),
              value: 1
            },
            {
              id: asEffectId('seed-shop-effect-decrement-stock'),
              type: 'set_state',
              path: asStatePath('product.stock'),
              value: 11
            },
            {
              id: asEffectId('seed-shop-effect-add-subtotal'),
              type: 'set_state',
              path: asStatePath('cart.subtotal'),
              value: 1999
            },
            {
              id: asEffectId('seed-shop-effect-emit-added'),
              type: 'emit_event',
              event: asEventName('cart.item.added')
            },
            {
              id: asEffectId('seed-shop-effect-message-added'),
              type: 'show_message',
              message: 'Added to cart',
              tone: 'success'
            }
          ],
          emittedEvents: [asEventName('cart.item.added')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-go-to-cart'),
          name: 'Go to cart',
          intent: 'Navigate from the catalog to the cart surface.',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId('seed-shop-rule-empty-cart-block-nav'),
              category: 'ux_feedback',
              condition: {
                left: asStatePath('cart.itemCount'),
                operator: 'equals',
                right: 0
              },
              effect: {
                id: asEffectId('seed-shop-effect-empty-cart-block'),
                type: 'block_action',
                reason: 'Your cart is empty'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-transition-cart'),
              type: 'transition_surface',
              target: CART_ID
            }
          ],
          emittedEvents: [asEventName('navigation.cart.opened')],
          transitions: [
            {
              id: asEffectId('seed-shop-catalog-trans-2') as never,
              target: CART_ID
            }
          ]
        }
      ]
    },

    // ── Cart ───────────────────────────────────────────────────────────────
    {
      id: CART_ID,
      name: 'Cart',
      type: 'screen',
      description: 'Review items, change quantities, apply a coupon, and proceed to checkout.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('seed-shop-cart-state-count'),
          path: asStatePath('cart.itemCount'),
          type: 'number',
          defaultValue: 2
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-subtotal'),
          path: asStatePath('cart.subtotal'),
          type: 'number',
          defaultValue: 4598,
          description: 'Subtotal in cents.'
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-shipping'),
          path: asStatePath('cart.shipping'),
          type: 'number',
          defaultValue: 599
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-total'),
          path: asStatePath('cart.total'),
          type: 'number',
          defaultValue: 5197
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-coupon'),
          path: asStatePath('coupon.code'),
          type: 'string',
          defaultValue: '',
          description: 'Applied coupon code, empty when none.'
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-coupon-valid'),
          path: asStatePath('coupon.applied'),
          type: 'boolean',
          defaultValue: false
        },
        {
          id: asStateDefinitionId('seed-shop-cart-state-user-auth'),
          path: asStatePath('user.authenticated'),
          type: 'boolean',
          defaultValue: false
        }
      ],
      rules: [],
      invariants: [
        {
          id: asInvariantId('seed-shop-cart-invariant-count-non-negative'),
          name: 'cart.itemCount is non-negative',
          condition: {
            left: asStatePath('cart.itemCount'),
            operator: 'greater_than',
            right: -1
          },
          message: 'Cart count must be ≥ 0.'
        },
        {
          id: asInvariantId('seed-shop-cart-invariant-subtotal-non-negative'),
          name: 'cart.subtotal is non-negative',
          condition: {
            left: asStatePath('cart.subtotal'),
            operator: 'greater_than',
            right: -1
          },
          message: 'Subtotal must be ≥ 0.'
        }
      ],
      transitions: [
        { id: asEffectId('seed-shop-cart-trans-back') as never, target: CATALOG_ID, label: 'Back to catalog' },
        { id: asEffectId('seed-shop-cart-trans-checkout') as never, target: CHECKOUT_ID, label: 'Checkout' }
      ],
      actions: [
        {
          id: asActionId('seed-shop-cap-remove-item'),
          name: 'Remove item',
          intent: 'Remove an item from the cart and update totals.',
          parameters: [],
          requiredStates: [asStatePath('cart.itemCount')],
          rules: [
            {
              id: asRuleId('seed-shop-rule-empty-remove'),
              category: 'ux_feedback',
              condition: {
                left: asStatePath('cart.itemCount'),
                operator: 'equals',
                right: 0
              },
              effect: {
                id: asEffectId('seed-shop-effect-empty-remove'),
                type: 'block_action',
                reason: 'Cart is already empty'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-dec-count'),
              type: 'set_state',
              path: asStatePath('cart.itemCount'),
              value: 1
            },
            {
              id: asEffectId('seed-shop-effect-dec-subtotal'),
              type: 'set_state',
              path: asStatePath('cart.subtotal'),
              value: 2299
            },
            {
              id: asEffectId('seed-shop-effect-emit-removed'),
              type: 'emit_event',
              event: asEventName('cart.item.removed')
            }
          ],
          emittedEvents: [asEventName('cart.item.removed')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-apply-coupon'),
          name: 'Apply coupon',
          intent: 'Validate and apply a discount coupon to the cart.',
          parameters: [
            {
              id: asParameterId('seed-shop-param-coupon'),
              name: 'code',
              type: 'string',
              required: true,
              description: 'Coupon code to validate.'
            }
          ],
          requiredStates: [asStatePath('coupon.applied'), asStatePath('cart.subtotal')],
          rules: [
            {
              id: asRuleId('seed-shop-rule-coupon-already-applied'),
              category: 'business',
              condition: {
                left: asStatePath('coupon.applied'),
                operator: 'is_true'
              },
              effect: {
                id: asEffectId('seed-shop-effect-coupon-already-applied'),
                type: 'block_action',
                reason: 'A coupon is already applied. Remove it first.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-coupon-min-cart'),
              category: 'business',
              condition: {
                left: asStatePath('cart.subtotal'),
                operator: 'lower_than',
                right: 1500
              },
              effect: {
                id: asEffectId('seed-shop-effect-coupon-min-cart'),
                type: 'block_action',
                reason: 'Coupons require a $15 minimum cart total.'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-set-coupon'),
              type: 'set_state',
              path: asStatePath('coupon.code'),
              value: 'SAVE10'
            },
            {
              id: asEffectId('seed-shop-effect-mark-coupon-applied'),
              type: 'set_state',
              path: asStatePath('coupon.applied'),
              value: true
            },
            {
              id: asEffectId('seed-shop-effect-emit-coupon'),
              type: 'emit_event',
              event: asEventName('cart.coupon.applied')
            },
            {
              id: asEffectId('seed-shop-effect-coupon-message'),
              type: 'show_message',
              message: 'Coupon applied. 10% off',
              tone: 'success'
            }
          ],
          emittedEvents: [asEventName('cart.coupon.applied')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-checkout'),
          name: 'Proceed to checkout',
          intent: 'Move from the cart to the checkout flow.',
          parameters: [],
          requiredStates: [
            asStatePath('cart.itemCount'),
            asStatePath('user.authenticated')
          ],
          rules: [
            {
              id: asRuleId('seed-shop-rule-empty-cart-checkout'),
              category: 'business',
              condition: {
                left: asStatePath('cart.itemCount'),
                operator: 'equals',
                right: 0
              },
              effect: {
                id: asEffectId('seed-shop-effect-empty-cart-checkout'),
                type: 'block_action',
                reason: 'Add something to your cart before checking out.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-not-authenticated'),
              category: 'permissions',
              condition: {
                left: asStatePath('user.authenticated'),
                operator: 'is_false'
              },
              effect: {
                id: asEffectId('seed-shop-effect-must-login'),
                type: 'block_action',
                reason: 'Sign in to continue to checkout.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-free-shipping'),
              category: 'ux_feedback',
              condition: {
                left: asStatePath('cart.subtotal'),
                operator: 'greater_than',
                right: 3499
              },
              effect: {
                id: asEffectId('seed-shop-effect-free-shipping'),
                type: 'show_message',
                message: 'You qualify for free shipping.',
                tone: 'info'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-transition-checkout'),
              type: 'transition_surface',
              target: CHECKOUT_ID
            },
            {
              id: asEffectId('seed-shop-effect-emit-checkout-started'),
              type: 'emit_event',
              event: asEventName('checkout.started')
            }
          ],
          emittedEvents: [asEventName('checkout.started')],
          transitions: []
        }
      ]
    },

    // ── Checkout ───────────────────────────────────────────────────────────
    {
      id: CHECKOUT_ID,
      name: 'Checkout',
      type: 'workflow',
      description: 'Multi-step checkout: shipping address → payment method → place order.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('seed-shop-checkout-state-step'),
          path: asStatePath('checkout.step'),
          type: 'enum',
          enumValues: ['address', 'payment', 'review'],
          defaultValue: 'address'
        },
        {
          id: asStateDefinitionId('seed-shop-checkout-state-address'),
          path: asStatePath('shipping.addressProvided'),
          type: 'boolean',
          defaultValue: false
        },
        {
          id: asStateDefinitionId('seed-shop-checkout-state-payment'),
          path: asStatePath('payment.method'),
          type: 'enum',
          enumValues: ['none', 'card', 'paypal', 'gift_card'],
          defaultValue: 'none'
        },
        {
          id: asStateDefinitionId('seed-shop-checkout-state-amount'),
          path: asStatePath('order.amount'),
          type: 'number',
          defaultValue: 5197,
          description: 'Final order amount in cents.'
        },
        {
          id: asStateDefinitionId('seed-shop-checkout-state-fraud-flag'),
          path: asStatePath('fraud.flagged'),
          type: 'boolean',
          defaultValue: false
        },
        {
          id: asStateDefinitionId('seed-shop-checkout-state-user-auth'),
          path: asStatePath('user.authenticated'),
          type: 'boolean',
          defaultValue: true
        }
      ],
      // Surface-level guard: must be authenticated to do anything in checkout.
      rules: [
        {
          id: asRuleId('seed-shop-checkout-surface-rule-auth'),
          category: 'security',
          condition: {
            left: asStatePath('user.authenticated'),
            operator: 'is_false'
          },
          effect: {
            id: asEffectId('seed-shop-checkout-effect-must-auth'),
            type: 'block_action',
            reason: 'Sign in required to access checkout.'
          },
          description: 'Cross-cutting: every action on this surface requires an authenticated user.'
        }
      ],
      invariants: [
        {
          id: asInvariantId('seed-shop-checkout-invariant-amount-positive'),
          name: 'order.amount is positive',
          condition: {
            left: asStatePath('order.amount'),
            operator: 'greater_than',
            right: 0
          },
          message: 'Order amount must be > 0.'
        }
      ],
      transitions: [
        { id: asEffectId('seed-shop-checkout-trans-back') as never, target: CART_ID, label: 'Back to cart' },
        { id: asEffectId('seed-shop-checkout-trans-order') as never, target: ORDER_ID, label: 'Order confirmation' }
      ],
      actions: [
        {
          id: asActionId('seed-shop-cap-confirm-address'),
          name: 'Confirm shipping address',
          intent: 'Persist the shipping address and advance to payment.',
          parameters: [
            {
              id: asParameterId('seed-shop-param-postal-code'),
              name: 'postalCode',
              type: 'string',
              required: true
            }
          ],
          requiredStates: [asStatePath('checkout.step')],
          rules: [
            {
              id: asRuleId('seed-shop-rule-wrong-step-address'),
              category: 'business',
              condition: {
                left: asStatePath('checkout.step'),
                operator: 'not_equals',
                right: 'address'
              },
              effect: {
                id: asEffectId('seed-shop-effect-wrong-step-address'),
                type: 'block_action',
                reason: 'You already passed the address step.'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-mark-address-provided'),
              type: 'set_state',
              path: asStatePath('shipping.addressProvided'),
              value: true
            },
            {
              id: asEffectId('seed-shop-effect-advance-payment'),
              type: 'set_state',
              path: asStatePath('checkout.step'),
              value: 'payment'
            },
            {
              id: asEffectId('seed-shop-effect-emit-address'),
              type: 'emit_event',
              event: asEventName('checkout.address.confirmed')
            }
          ],
          emittedEvents: [asEventName('checkout.address.confirmed')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-select-payment'),
          name: 'Select payment method',
          intent: 'Pick a payment method and advance to the review step.',
          parameters: [
            {
              id: asParameterId('seed-shop-param-payment'),
              name: 'method',
              type: 'enum',
              required: true,
              enumValues: ['card', 'paypal', 'gift_card']
            }
          ],
          requiredStates: [
            asStatePath('checkout.step'),
            asStatePath('shipping.addressProvided')
          ],
          rules: [
            {
              id: asRuleId('seed-shop-rule-no-address'),
              category: 'business',
              condition: {
                left: asStatePath('shipping.addressProvided'),
                operator: 'is_false'
              },
              effect: {
                id: asEffectId('seed-shop-effect-no-address'),
                type: 'block_action',
                reason: 'Confirm a shipping address first.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-wrong-step-payment'),
              category: 'business',
              condition: {
                left: asStatePath('checkout.step'),
                operator: 'not_equals',
                right: 'payment'
              },
              effect: {
                id: asEffectId('seed-shop-effect-wrong-step-payment'),
                type: 'block_action',
                reason: 'You are not on the payment step.'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-set-payment'),
              type: 'set_state',
              path: asStatePath('payment.method'),
              value: 'card'
            },
            {
              id: asEffectId('seed-shop-effect-advance-review'),
              type: 'set_state',
              path: asStatePath('checkout.step'),
              value: 'review'
            },
            {
              id: asEffectId('seed-shop-effect-emit-payment'),
              type: 'emit_event',
              event: asEventName('checkout.payment.selected')
            }
          ],
          emittedEvents: [asEventName('checkout.payment.selected')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-place-order'),
          name: 'Place order',
          intent:
            'Finalize the order, run fraud checks, and transition to the confirmation surface.',
          parameters: [],
          requiredStates: [
            asStatePath('checkout.step'),
            asStatePath('payment.method'),
            asStatePath('order.amount')
          ],
          rules: [
            {
              id: asRuleId('seed-shop-rule-not-on-review'),
              category: 'business',
              condition: {
                left: asStatePath('checkout.step'),
                operator: 'not_equals',
                right: 'review'
              },
              effect: {
                id: asEffectId('seed-shop-effect-not-on-review'),
                type: 'block_action',
                reason: 'Complete the previous steps first.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-no-payment'),
              category: 'validation',
              condition: {
                left: asStatePath('payment.method'),
                operator: 'equals',
                right: 'none'
              },
              effect: {
                id: asEffectId('seed-shop-effect-no-payment'),
                type: 'block_action',
                reason: 'Select a payment method before placing the order.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-fraud-amount'),
              category: 'compliance',
              condition: {
                left: asStatePath('order.amount'),
                operator: 'greater_than',
                right: 100000
              },
              effect: {
                id: asEffectId('seed-shop-effect-fraud-flag'),
                type: 'block_action',
                reason: 'Orders over $1,000 require manual review.'
              },
              description: 'Compliance gate triggered for high-value orders.'
            },
            {
              id: asRuleId('seed-shop-rule-fraud-flagged'),
              category: 'security',
              condition: {
                left: asStatePath('fraud.flagged'),
                operator: 'is_true'
              },
              effect: {
                id: asEffectId('seed-shop-effect-fraud-flagged'),
                type: 'block_action',
                reason: 'Account flagged for fraud review.'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-emit-placed'),
              type: 'emit_event',
              event: asEventName('order.placed')
            },
            {
              id: asEffectId('seed-shop-effect-message-placed'),
              type: 'show_message',
              message: 'Order placed!',
              tone: 'success'
            },
            {
              id: asEffectId('seed-shop-effect-transition-order'),
              type: 'transition_surface',
              target: ORDER_ID
            }
          ],
          emittedEvents: [asEventName('order.placed')],
          transitions: []
        }
      ]
    },

    // ── Order ──────────────────────────────────────────────────────────────
    {
      id: ORDER_ID,
      name: 'Order confirmation',
      type: 'screen',
      description:
        'Post-purchase view. Order can be cancelled while in preparation, but not after shipping.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('seed-shop-order-state-status'),
          path: asStatePath('order.status'),
          type: 'enum',
          enumValues: ['placed', 'preparing', 'shipped', 'delivered', 'cancelled'],
          defaultValue: 'preparing'
        },
        {
          id: asStateDefinitionId('seed-shop-order-state-id'),
          path: asStatePath('order.id'),
          type: 'string',
          defaultValue: 'ORD-1042'
        },
        {
          id: asStateDefinitionId('seed-shop-order-state-amount'),
          path: asStatePath('order.amount'),
          type: 'number',
          defaultValue: 5197
        }
      ],
      rules: [],
      invariants: [],
      transitions: [
        { id: asEffectId('seed-shop-order-trans-back') as never, target: CATALOG_ID, label: 'Continue shopping' }
      ],
      actions: [
        {
          id: asActionId('seed-shop-cap-cancel-order'),
          name: 'Cancel order',
          intent: 'Cancel an order before it ships.',
          parameters: [],
          requiredStates: [asStatePath('order.status')],
          rules: [
            {
              id: asRuleId('seed-shop-rule-cancel-shipped'),
              category: 'business',
              condition: {
                left: asStatePath('order.status'),
                operator: 'equals',
                right: 'shipped'
              },
              effect: {
                id: asEffectId('seed-shop-effect-cancel-shipped'),
                type: 'block_action',
                reason: 'Cannot cancel. Already shipped.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-cancel-delivered'),
              category: 'business',
              condition: {
                left: asStatePath('order.status'),
                operator: 'equals',
                right: 'delivered'
              },
              effect: {
                id: asEffectId('seed-shop-effect-cancel-delivered'),
                type: 'block_action',
                reason: 'Order already delivered. Use the return flow instead.'
              }
            },
            {
              id: asRuleId('seed-shop-rule-cancel-already-cancelled'),
              category: 'business',
              condition: {
                left: asStatePath('order.status'),
                operator: 'equals',
                right: 'cancelled'
              },
              effect: {
                id: asEffectId('seed-shop-effect-cancel-already-cancelled'),
                type: 'block_action',
                reason: 'Order is already cancelled.'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-set-cancelled'),
              type: 'set_state',
              path: asStatePath('order.status'),
              value: 'cancelled'
            },
            {
              id: asEffectId('seed-shop-effect-emit-cancelled'),
              type: 'emit_event',
              event: asEventName('order.cancelled')
            },
            {
              id: asEffectId('seed-shop-effect-cancel-message'),
              type: 'show_message',
              message: 'Order cancelled. Refund is on its way.',
              tone: 'success'
            }
          ],
          emittedEvents: [asEventName('order.cancelled')],
          transitions: []
        },
        {
          id: asActionId('seed-shop-cap-track-order'),
          name: 'Track shipment',
          intent: 'Open the shipment tracker (no-op in MVP).',
          parameters: [],
          requiredStates: [asStatePath('order.status')],
          rules: [
            {
              id: asRuleId('seed-shop-rule-track-not-shippable'),
              category: 'ux_feedback',
              condition: {
                left: asStatePath('order.status'),
                operator: 'equals',
                right: 'preparing'
              },
              effect: {
                id: asEffectId('seed-shop-effect-track-not-shippable'),
                type: 'show_message',
                message: 'Tracking not yet available. Order still being prepared.',
                tone: 'info'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('seed-shop-effect-emit-track'),
              type: 'emit_event',
              event: asEventName('order.track.opened')
            }
          ],
          emittedEvents: [asEventName('order.track.opened')],
          transitions: []
        }
      ]
    }
  ]
};

export const storefrontFeature: Feature = withRequiredDescriptions(storefrontFeatureData);
