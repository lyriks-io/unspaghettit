import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';
import { COMMERCE_BLUEPRINT_IDS } from './shared';

/** Commerce bricks that wire into the existing catalog / cart / checkout set. */

const wishlist = defineBrick({
  id: 'library.commerce.wishlist',
  name: 'Wishlist',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Saved-for-later list with add and move-to-cart.',
  description:
    'A saved items list. Adding validates the product id; moving to the cart is blocked when the wishlist is empty.',
  surfaceName: 'Wishlist',
  surfaceDescription: 'Save products for later and move them into the cart.',
  tags: ['commerce', 'wishlist', 'saved', 'favorites'],
  siblings: [
    { id: COMMERCE_BLUEPRINT_IDS.catalog, label: 'Continue shopping' },
    { id: COMMERCE_BLUEPRINT_IDS.cart, label: 'Cart' }
  ],
  states: [
    { path: 'wishlist.itemCount', type: 'number', default: 0, description: 'Saved items.' }
  ],
  invariants: [
    { name: 'Item count is non-negative', path: 'wishlist.itemCount', op: 'greater_than', value: -1, message: 'Wishlist count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add to wishlist',
      intent: 'Save a product for later.',
      emits: 'wishlist.item.added',
      roles: ['primary'],
      params: [
        { name: 'productId', type: 'string', description: 'Product id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'business', description: 'Count the saved item.', set: { path: 'wishlist.itemCount', value: 1 } }]
    },
    {
      name: 'Move to cart',
      intent: 'Move a saved item into the cart.',
      emits: 'wishlist.item.moved_to_cart',
      roles: ['primary'],
      requiredStates: ['wishlist.itemCount'],
      params: [
        { name: 'productId', type: 'string', description: 'Product id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'wishlist.itemCount', op: 'equals', value: 0 }, block: 'Your wishlist is empty.' }
      ]
    }
  ]
});

const coupon = defineBrick({
  id: 'library.commerce.coupon',
  name: 'Coupon',
  category: 'commerce',
  surfaceType: 'dialog_area',
  summary: 'Apply and remove a promo code with a single-coupon guard.',
  description:
    'A discount-code entry. Applying is blocked when a coupon is already active; removing is blocked when none is applied.',
  surfaceName: 'Promo code',
  surfaceDescription: 'Enter or clear a discount code at checkout.',
  tags: ['commerce', 'coupon', 'promo', 'discount'],
  siblings: [{ id: COMMERCE_BLUEPRINT_IDS.checkout, label: 'Checkout' }],
  states: [
    { path: 'coupon.applied', type: 'boolean', default: false, description: 'Whether a coupon is active.' },
    { path: 'coupon.code', type: 'string', default: '', description: 'Applied code.' },
    { path: 'coupon.discountPercent', type: 'number', default: 0, description: 'Discount as a percentage.' }
  ],
  invariants: [
    { name: 'Discount is non-negative', path: 'coupon.discountPercent', op: 'greater_than', value: -1, message: 'Discount percent can never be negative.' }
  ],
  actions: [
    {
      name: 'Apply coupon',
      intent: 'Apply a promo code.',
      emits: 'coupon.applied',
      roles: ['primary'],
      requiredStates: ['coupon.applied'],
      params: [
        { name: 'code', type: 'string', description: 'Promo code.', bindTo: 'coupon.code', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 32 }, { type: 'no_whitespace' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'coupon.applied', op: 'is_true' }, block: 'A coupon is already applied.' },
        { category: 'business', description: 'Mark a coupon as active.', set: { path: 'coupon.applied', value: true } }
      ]
    },
    {
      name: 'Remove coupon',
      intent: 'Clear the applied promo code.',
      emits: 'coupon.removed',
      roles: ['primary'],
      requiredStates: ['coupon.applied'],
      rules: [
        { category: 'business', when: { path: 'coupon.applied', op: 'is_false' }, block: 'There is no coupon to remove.' },
        { category: 'business', description: 'Clear the coupon.', set: { path: 'coupon.applied', value: false } }
      ]
    }
  ]
});

const addressBook = defineBrick({
  id: 'library.commerce.address_book',
  name: 'Address book',
  category: 'commerce',
  surfaceType: 'screen',
  summary: 'Saved shipping addresses with add and set-default.',
  description:
    'Stored delivery addresses. Adding validates the required fields; a default can only be chosen once at least one address exists.',
  surfaceName: 'Addresses',
  surfaceDescription: 'Manage saved shipping addresses.',
  tags: ['commerce', 'address', 'shipping', 'checkout'],
  siblings: [{ id: COMMERCE_BLUEPRINT_IDS.checkout, label: 'Checkout' }],
  states: [
    { path: 'address.count', type: 'number', default: 0, description: 'Saved addresses.' },
    { path: 'address.defaultSet', type: 'boolean', default: false, description: 'Whether a default is chosen.' }
  ],
  invariants: [
    { name: 'Address count is non-negative', path: 'address.count', op: 'greater_than', value: -1, message: 'The address count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add address',
      intent: 'Save a new shipping address.',
      emits: 'address.added',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'line1', type: 'string', description: 'Street address.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 120 }] },
        { name: 'city', type: 'string', description: 'City.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'postalCode', type: 'string', description: 'Postal code.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 12 }] },
        { name: 'country', type: 'enum', description: 'Country.', enumValues: ['US', 'GB', 'FR', 'DE', 'JP'] }
      ],
      rules: [{ category: 'business', description: 'Count the new address.', set: { path: 'address.count', value: 1 } }]
    },
    {
      name: 'Set default',
      intent: 'Choose the default shipping address.',
      emits: 'address.default.changed',
      roles: ['primary'],
      requiredStates: ['address.count'],
      params: [
        { name: 'addressId', type: 'string', description: 'Address id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'address.count', op: 'equals', value: 0 }, block: 'Add an address first.' },
        { category: 'business', description: 'Record that a default exists.', set: { path: 'address.defaultSet', value: true } }
      ]
    }
  ]
});

export const commerceExtraBlueprints: readonly SurfaceBlueprint[] = [wishlist, coupon, addressBook];
