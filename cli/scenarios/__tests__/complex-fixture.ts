import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';

/**
 * Stress fixture for the codegen. Picks every code path that the simple
 * Counter fixture doesn't:
 *
 * - Two surfaces, multiple actions on each.
 * - Composite rule conditions (`all` + `not`) — simulator handles, codegen
 *   passes through.
 * - Personas attached to scenarios — exercises the persona-merge branch in
 *   resolveScenario.
 * - Eight different operators across assertions (equals, not_equals,
 *   greater_than, lower_than, is_true, is_false, exists, does_not_exist) so
 *   every emitter switch arm is hit.
 * - A blocked scenario whose author also wrote `expectedAssertions` —
 *   codegen MUST skip those (they're meaningless when no effects ran).
 * - An Expression-valued assertion — codegen MUST emit a [skipped] comment
 *   because the wedge doesn't ship an expression evaluator.
 * - A drift scenario (author says success, simulator predicts blocked) —
 *   codegen MUST emit the test as authored, surface the drift in the report,
 *   and the resulting test will fail against any honest implementation.
 *
 * Banking domain because "transfer money" hits every aspect cleanly:
 * preconditions (frozen, balance), composite blocking, side-effect state
 * mutation (balance + timestamp), persona-as-baseline (premium/frozen).
 */
export const BANKING_FEATURE: Feature = {
  id: 'banking' as Feature['id'],
  name: 'Banking',
  description: 'Stress fixture for the scenarios-export codegen.',
  surfaces: [
    {
      id: 'account-surface' as never,
      name: 'Account',
      type: 'screen',
      stateDefinitions: [
        {
          id: 'sd-balance' as never,
          path: 'account.balance' as never,
          type: 'number',
          defaultValue: 1000,
          description: 'Cents.'
        },
        {
          id: 'sd-frozen' as never,
          path: 'account.frozen' as never,
          type: 'boolean',
          defaultValue: false
        },
        {
          id: 'sd-tier' as never,
          path: 'account.tier' as never,
          type: 'string',
          defaultValue: 'standard'
        },
        {
          id: 'sd-last' as never,
          path: 'account.lastTransferAt' as never,
          type: 'string',
          defaultValue: ''
        }
      ],
      actions: [
        {
          id: 'transfer' as never,
          name: 'Transfer',
          intent: 'Move money out of the account if the account is healthy.',
          parameters: [
            {
              id: 'p-amount' as never,
              name: 'amount',
              type: 'number',
              required: true
            },
            {
              id: 'p-recipient' as never,
              name: 'recipient',
              type: 'string',
              required: true
            }
          ],
          requiredStates: [],
          rules: [
            {
              id: 'r-frozen' as never,
              category: 'security',
              description: 'Frozen accounts cannot transfer.',
              condition: {
                left: 'account.frozen' as never,
                operator: 'is_true'
              },
              effect: {
                id: 'e-block-frozen' as never,
                type: 'block_action',
                reason: 'Account is frozen.'
              }
            },
            {
              id: 'r-non-positive' as never,
              category: 'validation',
              description: 'Block non-positive amounts (composite NOT).',
              condition: {
                kind: 'not',
                condition: {
                  left: { kind: 'param', name: 'amount' },
                  operator: 'greater_than',
                  right: 0
                }
              },
              effect: {
                id: 'e-block-nonpos' as never,
                type: 'block_action',
                reason: 'Amount must be positive.'
              }
            },
            {
              id: 'r-insufficient' as never,
              category: 'business',
              description: 'Block when amount exceeds balance (composite ALL).',
              condition: {
                kind: 'all',
                conditions: [
                  {
                    left: { kind: 'param', name: 'amount' },
                    operator: 'greater_than',
                    right: 0
                  },
                  {
                    // amount > balance ⇒ block. Expressed as: NOT (amount <= balance).
                    // We have `greater_than` only, so flip via "balance lower_than amount".
                    left: 'account.balance' as never,
                    operator: 'lower_than',
                    right: { kind: 'param', name: 'amount' }
                  }
                ]
              },
              effect: {
                id: 'e-block-funds' as never,
                type: 'block_action',
                reason: 'Insufficient funds.'
              }
            },
            {
              id: 'r-apply' as never,
              category: 'business',
              description: 'On success, debit balance and stamp the timestamp.',
              condition: {
                kind: 'all',
                conditions: [
                  {
                    left: 'account.frozen' as never,
                    operator: 'is_false'
                  },
                  {
                    left: { kind: 'param', name: 'amount' },
                    operator: 'greater_than',
                    right: 0
                  },
                  {
                    left: 'account.balance' as never,
                    operator: 'greater_than',
                    right: { kind: 'param', name: 'amount' }
                  }
                ]
              },
              effect: {
                id: 'e-debit' as never,
                type: 'set_state',
                path: 'account.balance' as never,
                value: {
                  kind: 'sub',
                  left: { kind: 'state', path: 'account.balance' as never },
                  right: { kind: 'param', name: 'amount' }
                }
              }
            },
            {
              id: 'r-stamp' as never,
              category: 'audit',
              description: 'Stamp the transfer date on success.',
              condition: {
                kind: 'all',
                conditions: [
                  {
                    left: 'account.frozen' as never,
                    operator: 'is_false'
                  },
                  {
                    left: { kind: 'param', name: 'amount' },
                    operator: 'greater_than',
                    right: 0
                  },
                  {
                    left: 'account.balance' as never,
                    operator: 'greater_than',
                    right: { kind: 'param', name: 'amount' }
                  }
                ]
              },
              effect: {
                id: 'e-stamp' as never,
                type: 'set_state',
                path: 'account.lastTransferAt' as never,
                value: '2026-05-26'
              }
            }
          ],
          effects: [],
          invariants: [],
          onBlockedEffects: [],
          emittedEvents: [],
          transitions: [],
          scenarios: [
            {
              id: 'sc-premium-ok' as never,
              name: 'Premium user transfers 100 successfully',
              description: 'Persona-driven baseline + multi-assertion success.',
              personaId: 'persona-premium' as never,
              stateOverrides: [],
              parameterOverrides: [
                { parameterName: 'amount', value: 100 },
                { parameterName: 'recipient', value: 'alice' }
              ],
              expectedStatus: 'success',
              expectedAssertions: [
                {
                  path: 'account.balance' as never,
                  operator: 'equals',
                  value: 900,
                  description: '1000 - 100 via sub Expression.'
                },
                {
                  path: 'account.lastTransferAt' as never,
                  operator: 'not_equals',
                  value: ''
                },
                {
                  path: 'account.frozen' as never,
                  operator: 'is_false'
                },
                {
                  path: 'account.balance' as never,
                  operator: 'greater_than',
                  value: 800
                },
                {
                  path: 'account.balance' as never,
                  operator: 'lower_than',
                  value: 1000
                },
                {
                  path: 'account.tier' as never,
                  operator: 'exists'
                },
                {
                  path: 'account.deletedAt' as never,
                  operator: 'does_not_exist'
                }
              ]
            },
            {
              id: 'sc-frozen-blocked' as never,
              name: 'Frozen account cannot transfer',
              description: 'Blocked-by-persona; assertions on the right HAND must be skipped by the codegen.',
              personaId: 'persona-frozen' as never,
              stateOverrides: [],
              parameterOverrides: [
                { parameterName: 'amount', value: 100 },
                { parameterName: 'recipient', value: 'alice' }
              ],
              expectedStatus: 'blocked',
              // These were authored as success-shaped assertions but the action
              // gets blocked. The codegen MUST drop them so the generated test
              // doesn't silently pass against unchanged-state.
              expectedAssertions: [
                {
                  path: 'account.balance' as never,
                  operator: 'equals',
                  value: 1000
                }
              ]
            },
            {
              id: 'sc-negative-blocked' as never,
              name: 'Negative amount blocked',
              stateOverrides: [],
              parameterOverrides: [
                { parameterName: 'amount', value: -50 },
                { parameterName: 'recipient', value: 'alice' }
              ],
              expectedStatus: 'blocked'
            },
            {
              id: 'sc-drift-success-vs-blocked' as never,
              name: 'DRIFT: author claims success on overdraft',
              description: 'Author claims this should succeed, simulator predicts blocked (insufficient funds). Codegen must emit, report drift, and the test must fail against a faithful adapter.',
              stateOverrides: [],
              parameterOverrides: [
                { parameterName: 'amount', value: 5000 },
                { parameterName: 'recipient', value: 'alice' }
              ],
              expectedStatus: 'success'
            },
            {
              id: 'sc-expression-assertion' as never,
              name: 'Expression-valued assertion gets skipped at codegen',
              stateOverrides: [],
              parameterOverrides: [
                { parameterName: 'amount', value: 50 },
                { parameterName: 'recipient', value: 'bob' }
              ],
              expectedStatus: 'success',
              expectedAssertions: [
                {
                  // Literal — should be emitted.
                  path: 'account.balance' as never,
                  operator: 'equals',
                  value: 950
                },
                {
                  // Expression-valued: balance < (initial 1000). The wedge
                  // does not ship an expression evaluator into the test, so
                  // this MUST come out as a [skipped] comment.
                  path: 'account.balance' as never,
                  operator: 'lower_than',
                  value: {
                    kind: 'literal',
                    value: 1000
                  }
                }
              ]
            }
          ]
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    },
    {
      id: 'tier-surface' as never,
      name: 'Tier',
      type: 'screen',
      stateDefinitions: [
        {
          id: 'sd-tier-2' as never,
          path: 'account.tier' as never,
          type: 'string',
          defaultValue: 'standard',
          sharedWith: ['account-surface' as never]
        }
      ],
      actions: [
        {
          id: 'promote' as never,
          name: 'Promote to gold',
          intent: 'Unconditional promotion.',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: 'r-promote' as never,
              category: 'business',
              effect: {
                id: 'e-promote' as never,
                type: 'set_state',
                path: 'account.tier' as never,
                value: 'gold'
              }
            }
          ],
          effects: [],
          invariants: [],
          onBlockedEffects: [],
          emittedEvents: [],
          transitions: [],
          scenarios: [
            {
              id: 'sc-promote' as never,
              name: 'Promote sets tier to gold',
              stateOverrides: [],
              parameterOverrides: [],
              expectedStatus: 'success',
              expectedAssertions: [
                {
                  path: 'account.tier' as never,
                  operator: 'equals',
                  value: 'gold'
                },
                {
                  path: 'account.tier' as never,
                  operator: 'not_equals',
                  value: 'standard'
                }
              ]
            }
          ]
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [
    {
      id: 'persona-premium' as never,
      name: 'Premium user',
      description: 'Healthy account, premium tier, never frozen.',
      stateOverrides: [
        { path: 'account.tier' as never, value: 'premium' },
        { path: 'account.frozen' as never, value: false }
      ],
      parameterOverrides: []
    },
    {
      id: 'persona-frozen' as never,
      name: 'Frozen user',
      description: 'Account explicitly frozen.',
      stateOverrides: [{ path: 'account.frozen' as never, value: true }],
      parameterOverrides: []
    }
  ],
  resources: [],
  entities: [],
  createdAt: '2026-05-26T00:00:00.000Z',
  updatedAt: '2026-05-26T00:00:00.000Z'
};
