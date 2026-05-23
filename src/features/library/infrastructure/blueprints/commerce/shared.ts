import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import { asResourceId } from '$features/behavior-model/domain/value-objects/ids';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

export const COMMERCE_BLUEPRINT_IDS = {
  catalog: asBlueprintId('library.commerce.catalog'),
  productDetails: asBlueprintId('library.commerce.product_details'),
  cart: asBlueprintId('library.commerce.cart'),
  checkout: asBlueprintId('library.commerce.checkout'),
  orderConfirmation: asBlueprintId('library.commerce.order_confirmation')
} as const;

export const commerceResources: readonly Resource[] = [
  {
    id: asResourceId('library-commerce-res-products'),
    name: 'Product catalog',
    description: 'Catalog of products with prices, stock, and metadata.',
    kind: 'document_db',
    provider: 'MongoDB Atlas',
    scope: 'cloud',
    location: 'multi-region',
    database: 'commerce',
    container: 'products',
    field: undefined,
    sensitivity: 'public',
    containsPii: false,
    complianceTags: [],
    accessMode: 'read',
    authentication: 'service_account',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: 'indefinite',
    owner: 'catalog-team'
  },
  {
    id: asResourceId('library-commerce-res-cart'),
    name: 'Cart (browser)',
    description: 'Per-device cart, synced to server when authenticated.',
    kind: 'browser_storage',
    provider: 'IndexedDB',
    scope: 'local',
    location: "User's browser",
    database: 'shop',
    container: 'cart',
    field: undefined,
    sensitivity: 'internal',
    containsPii: false,
    complianceTags: [],
    accessMode: 'read_write',
    authentication: 'none',
    encryptionAtRest: false,
    encryptionInTransit: false,
    retention: 'until browser data is cleared',
    owner: 'web-team'
  },
  {
    id: asResourceId('library-commerce-res-orders'),
    name: 'Orders (Postgres)',
    description: 'Order ledger. Source of truth for fulfillment and finance.',
    kind: 'relational_db',
    provider: 'PostgreSQL',
    scope: 'cloud',
    location: 'eu-west (configurable)',
    database: 'commerce',
    container: 'orders',
    field: undefined,
    sensitivity: 'confidential',
    containsPii: true,
    complianceTags: ['gdpr', 'sox'],
    accessMode: 'read_write',
    authentication: 'iam_role',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: '7 years (tax compliance)',
    owner: 'orders-team'
  },
  {
    id: asResourceId('library-commerce-res-payments'),
    name: 'Payments API',
    description: 'External payment processor. Card details never touch our servers.',
    kind: 'http_api',
    provider: 'Stripe',
    scope: 'external',
    location: 'us-east',
    database: 'https://api.stripe.com',
    container: '/v1/payment_intents',
    field: undefined,
    sensitivity: 'restricted',
    containsPii: true,
    complianceTags: ['pci_dss'],
    accessMode: 'read_write',
    authentication: 'api_key',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: 'managed by provider',
    owner: 'payments-team'
  }
];
