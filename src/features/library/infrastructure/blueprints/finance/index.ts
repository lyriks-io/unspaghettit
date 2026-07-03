import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const FINANCE_IDS = {
  wallet: 'library.finance.wallet',
  transactions: 'library.finance.transactions',
  transfer: 'library.finance.transfer'
} as const;

const wallet = defineBrick({
  id: FINANCE_IDS.wallet,
  name: 'Wallet',
  category: 'finance',
  surfaceType: 'screen',
  summary: 'Balance view with add-funds (frozen-guarded) and a freeze switch.',
  description:
    'An account balance surface. Adding funds is blocked on a frozen wallet; freezing is a security action recorded on the wallet.',
  surfaceName: 'Wallet',
  surfaceDescription: 'Show the balance and let the holder add funds or freeze the wallet.',
  tags: ['finance', 'wallet', 'balance', 'funds'],
  siblings: [{ id: FINANCE_IDS.transactions, label: 'Transactions' }],
  states: [
    { path: 'wallet.balanceCents', type: 'number', default: 0, description: 'Balance in cents.' },
    { path: 'wallet.currency', type: 'enum', default: 'USD', description: 'Wallet currency.', enumValues: ['USD', 'EUR', 'GBP'] },
    { path: 'wallet.frozen', type: 'boolean', default: false, description: 'Whether the wallet is frozen.' }
  ],
  invariants: [
    { name: 'Balance is non-negative', path: 'wallet.balanceCents', op: 'greater_than', value: -1, message: 'The wallet balance can never be negative.' }
  ],
  actions: [
    {
      name: 'Add funds',
      intent: 'Top up the wallet balance.',
      emits: 'wallet.funds.added',
      roles: ['primary'],
      requiredStates: ['wallet.frozen'],
      params: [
        { name: 'amountCents', type: 'number', description: 'Amount to add, in cents.', validations: [{ type: 'min', value: 1 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'wallet.frozen', op: 'is_true' }, block: 'This wallet is frozen.' }
      ]
    },
    {
      name: 'Freeze wallet',
      intent: 'Freeze the wallet to block movements.',
      emits: 'wallet.frozen',
      roles: ['destructive'],
      rules: [
        { category: 'security', description: 'Freeze the wallet.', set: { path: 'wallet.frozen', value: true } }
      ]
    }
  ]
});

const transactions = defineBrick({
  id: FINANCE_IDS.transactions,
  name: 'Transactions',
  category: 'finance',
  surfaceType: 'screen',
  summary: 'Ledger with income/expense filtering and statement export.',
  description:
    'A transaction history. Filtering narrows by direction; exporting a statement is a compliance-flagged action.',
  surfaceName: 'Transactions',
  surfaceDescription: 'Review and export the transaction ledger.',
  tags: ['finance', 'transactions', 'ledger', 'statement'],
  states: [
    { path: 'txn.count', type: 'number', default: 0, description: 'Transactions in view.' },
    { path: 'txn.filter', type: 'enum', default: 'all', description: 'Direction filter.', enumValues: ['all', 'income', 'expense'] }
  ],
  invariants: [
    { name: 'Transaction count is non-negative', path: 'txn.count', op: 'greater_than', value: -1, message: 'Transaction count can never be negative.' }
  ],
  actions: [
    {
      name: 'Filter transactions',
      intent: 'Filter the ledger by direction.',
      emits: 'txn.filtered',
      roles: ['primary'],
      params: [
        { name: 'filter', type: 'enum', description: 'Direction.', enumValues: ['all', 'income', 'expense'], bindTo: 'txn.filter' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    },
    {
      name: 'Export statement',
      intent: 'Export the ledger as a statement.',
      emits: 'txn.statement.exported',
      roles: ['async'],
      params: [
        { name: 'format', type: 'enum', description: 'Statement format.', enumValues: ['csv', 'pdf', 'ofx'] }
      ],
      rules: [{ category: 'compliance', message: { text: 'Preparing your statement.', tone: 'info' } }]
    }
  ]
});

const transfer = defineBrick({
  id: FINANCE_IDS.transfer,
  name: 'Transfer money',
  category: 'finance',
  surfaceType: 'workflow',
  summary: 'Two-step transfer with a daily-limit guard and 2FA confirmation.',
  description:
    'A money-movement flow. The review step blocks amounts over the daily limit; confirmation requires a one-time code before the transfer is marked done.',
  surfaceName: 'Transfer',
  surfaceDescription: 'Review and confirm a money transfer.',
  tags: ['finance', 'transfer', 'payments', '2fa'],
  states: [
    { path: 'transfer.amountCents', type: 'number', default: 0, description: 'Transfer amount in cents.' },
    { path: 'transfer.confirmed', type: 'boolean', default: false, description: 'Whether the transfer is confirmed.' },
    { path: 'transfer.dailyLimitCents', type: 'number', default: 500000, description: 'Daily transfer cap in cents.' }
  ],
  invariants: [
    { name: 'Daily limit is positive', path: 'transfer.dailyLimitCents', op: 'greater_than', value: 0, message: 'The daily limit is always positive.' }
  ],
  actions: [
    {
      name: 'Review transfer',
      intent: 'Validate the transfer before confirmation.',
      emits: 'transfer.reviewed',
      roles: ['primary'],
      requiredStates: ['transfer.dailyLimitCents'],
      params: [
        { name: 'toAccount', type: 'string', description: 'Destination account.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 34 }] },
        { name: 'amountCents', type: 'number', description: 'Amount in cents.', bindTo: 'transfer.amountCents', validations: [{ type: 'min', value: 1 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'security', when: { path: 'transfer.amountCents', op: 'greater_than', value: 500000 }, block: 'Amount exceeds your daily transfer limit.' }
      ]
    },
    {
      name: 'Confirm transfer',
      intent: 'Confirm the transfer with a one-time code.',
      emits: 'transfer.confirmed',
      roles: ['primary'],
      params: [
        { name: 'twoFactorCode', type: 'string', description: 'One-time 2FA code.', validations: [{ type: 'non_empty' }, { type: 'length', value: 6 }, { type: 'no_whitespace' }] }
      ],
      rules: [
        { category: 'security', description: 'Mark the transfer confirmed after the code.', set: { path: 'transfer.confirmed', value: true } }
      ]
    }
  ]
});

export const financeBlueprints: readonly SurfaceBlueprint[] = [wallet, transactions, transfer];
