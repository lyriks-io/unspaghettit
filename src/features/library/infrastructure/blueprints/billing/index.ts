import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const BILLING_IDS = {
  plans: 'library.billing.plans',
  invoices: 'library.billing.invoices',
  paymentMethods: 'library.billing.payment_methods'
} as const;

const plans = defineBrick({
  id: BILLING_IDS.plans,
  name: 'Subscription plans',
  category: 'billing',
  surfaceType: 'screen',
  summary: 'Change plan and seat count, restricted to the workspace owner.',
  description:
    'The plan picker. Plan and seat changes are owner-only and seats are validated as a positive integer, so billing can never be set to zero seats.',
  surfaceName: 'Plan',
  surfaceDescription: 'Choose a subscription tier and seat count.',
  tags: ['billing', 'subscription', 'plans', 'seats'],
  siblings: [{ id: BILLING_IDS.invoices, label: 'Invoices' }],
  states: [
    { path: 'billing.plan', type: 'enum', default: 'free', description: 'Active plan.', enumValues: ['free', 'pro', 'enterprise'] },
    { path: 'billing.seats', type: 'number', default: 1, description: 'Licensed seats.' },
    { path: 'session.role', type: 'enum', default: 'owner', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'At least one seat', path: 'billing.seats', op: 'greater_than', value: 0, message: 'A subscription always has at least one seat.' }
  ],
  actions: [
    {
      name: 'Change plan',
      intent: 'Switch to a different subscription tier.',
      emits: 'billing.plan.changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'plan', type: 'enum', description: 'Target plan.', enumValues: ['free', 'pro', 'enterprise'], bindTo: 'billing.plan' }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'not_equals', value: 'owner' }, block: 'Only the owner can change the plan.' }
      ]
    },
    {
      name: 'Update seats',
      intent: 'Change the number of licensed seats.',
      emits: 'billing.seats.changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'seats', type: 'number', description: 'Seat count.', bindTo: 'billing.seats', validations: [{ type: 'min', value: 1 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'not_equals', value: 'owner' }, block: 'Only the owner can change seats.' }
      ]
    }
  ]
});

const invoices = defineBrick({
  id: BILLING_IDS.invoices,
  name: 'Invoices',
  category: 'billing',
  surfaceType: 'screen',
  summary: 'List, download, and pay invoices with an outstanding-balance guard.',
  description:
    'The invoice history. Downloads validate the invoice id; paying is blocked when nothing is outstanding, avoiding double charges.',
  surfaceName: 'Invoices',
  surfaceDescription: 'Review, download, and settle invoices.',
  tags: ['billing', 'invoices', 'payments', 'receipts'],
  siblings: [{ id: BILLING_IDS.paymentMethods, label: 'Payment methods' }],
  states: [
    { path: 'invoices.count', type: 'number', default: 0, description: 'Total invoices.' },
    { path: 'invoices.unpaid', type: 'number', default: 0, description: 'Outstanding invoices.' }
  ],
  invariants: [
    { name: 'Unpaid count is non-negative', path: 'invoices.unpaid', op: 'greater_than', value: -1, message: 'The unpaid count can never be negative.' }
  ],
  actions: [
    {
      name: 'Download invoice',
      intent: 'Download an invoice PDF.',
      emits: 'invoice.downloaded',
      roles: ['async'],
      params: [
        { name: 'invoiceId', type: 'string', description: 'Invoice id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Preparing your download.', tone: 'info' } }]
    },
    {
      name: 'Pay invoice',
      intent: 'Settle an outstanding invoice.',
      emits: 'invoice.paid',
      roles: ['primary'],
      requiredStates: ['invoices.unpaid'],
      params: [
        { name: 'invoiceId', type: 'string', description: 'Invoice id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'invoices.unpaid', op: 'equals', value: 0 }, block: 'There are no outstanding invoices.' },
        { category: 'billing_quota', description: 'Clear the outstanding balance.', set: { path: 'invoices.unpaid', value: 0 } }
      ]
    }
  ]
});

const paymentMethods = defineBrick({
  id: BILLING_IDS.paymentMethods,
  name: 'Payment methods',
  category: 'billing',
  surfaceType: 'screen',
  summary: 'Add cards and set a default, with a default-requires-a-method guard.',
  description:
    'Stored payment methods. Card fields are validated and the surface notes that the PAN is tokenized; a default can only be set once a method exists.',
  surfaceName: 'Payment methods',
  surfaceDescription: 'Manage the cards on file and choose a default.',
  tags: ['billing', 'payment', 'cards', 'pci'],
  states: [
    { path: 'payment.methodCount', type: 'number', default: 0, description: 'Stored methods.' },
    { path: 'payment.defaultSet', type: 'boolean', default: false, description: 'Whether a default method exists.' }
  ],
  invariants: [
    { name: 'Method count is non-negative', path: 'payment.methodCount', op: 'greater_than', value: -1, message: 'The method count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add card',
      intent: 'Store a new payment card.',
      emits: 'payment.method.added',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'cardholderName', type: 'string', description: 'Name on the card.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'last4', type: 'string', description: 'Last four digits.', validations: [{ type: 'length', value: 4 }, { type: 'no_whitespace' }] },
        { name: 'expiry', type: 'string', description: 'Expiry MM/YY.', validations: [{ type: 'non_empty' }, { type: 'pattern', value: '^\\d{2}/\\d{2}$' }] }
      ],
      rules: [
        { category: 'security', description: 'Card numbers are tokenized by the processor and never stored on our servers.', message: { text: 'Card securely tokenized.', tone: 'success' } },
        { category: 'billing_quota', description: 'Count the stored method.', set: { path: 'payment.methodCount', value: 1 } }
      ]
    },
    {
      name: 'Set default',
      intent: 'Mark a stored method as the default.',
      emits: 'payment.default.changed',
      roles: ['primary'],
      requiredStates: ['payment.methodCount'],
      params: [
        { name: 'methodId', type: 'string', description: 'Method id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'payment.methodCount', op: 'equals', value: 0 }, block: 'Add a payment method first.' },
        { category: 'business', description: 'Record that a default now exists.', set: { path: 'payment.defaultSet', value: true } }
      ]
    }
  ]
});

export const billingBlueprints: readonly SurfaceBlueprint[] = [plans, invoices, paymentMethods];
