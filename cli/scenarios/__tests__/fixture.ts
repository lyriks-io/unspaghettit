import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';

/**
 * Minimal synthetic feature used by the codegen test suite. Three scenarios
 * exercise: (1) defaulted-state happy path, (2) state-override happy path,
 * (3) authored-blocked path. Enough to verify the wedge end-to-end without
 * dragging in the eshop samples.
 */
export const COUNTER_FEATURE: Feature = {
  id: 'counter' as Feature['id'],
  name: 'Counter',
  description: 'A counter with one action and three scenarios.',
  surfaces: [
    {
      id: 'counter-surface' as never,
      name: 'Counter',
      type: 'screen',
      stateDefinitions: [
        {
          id: 'sd-value' as never,
          path: 'counter.value' as never,
          type: 'number',
          defaultValue: 0,
          description: 'Current counter value.'
        }
      ],
      actions: [
        {
          id: 'add' as never,
          name: 'Add',
          intent: 'Add a positive integer to the counter; reject zero or negative.',
          parameters: [
            {
              id: 'p-by' as never,
              name: 'by',
              type: 'number',
              required: true,
              description: 'Amount to add. Must be positive.'
            }
          ],
          requiredStates: [],
          rules: [
            {
              id: 'r-positive' as never,
              category: 'business',
              description: 'Add when the parameter is positive.',
              condition: {
                left: { kind: 'param', name: 'by' },
                operator: 'greater_than',
                right: 0
              },
              effect: {
                id: 'e-add' as never,
                type: 'set_state',
                path: 'counter.value' as never,
                value: {
                  kind: 'add',
                  left: { kind: 'state', path: 'counter.value' as never },
                  right: { kind: 'param', name: 'by' }
                }
              }
            },
            {
              id: 'r-nonpositive' as never,
              category: 'validation',
              description: 'Block when the parameter is zero or negative.',
              condition: {
                kind: 'not',
                condition: {
                  left: { kind: 'param', name: 'by' },
                  operator: 'greater_than',
                  right: 0
                }
              },
              effect: {
                id: 'e-block' as never,
                type: 'block_action',
                reason: 'Add only accepts positive integers.'
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
              id: 'sc-add-1' as never,
              name: 'Add 1 to a fresh counter',
              description: 'Starts at 0, adds 1, ends at 1.',
              stateOverrides: [],
              parameterOverrides: [{ parameterName: 'by', value: 1 }],
              expectedStatus: 'success',
              expectedAssertions: [
                {
                  path: 'counter.value' as never,
                  operator: 'equals',
                  value: 1,
                  description: '0 + 1 = 1'
                }
              ]
            },
            {
              id: 'sc-add-5-from-10' as never,
              name: 'Add 5 to a counter already at 10',
              stateOverrides: [
                { path: 'counter.value' as never, value: 10 }
              ],
              parameterOverrides: [{ parameterName: 'by', value: 5 }],
              expectedStatus: 'success',
              expectedAssertions: [
                {
                  path: 'counter.value' as never,
                  operator: 'equals',
                  value: 15
                }
              ]
            },
            {
              id: 'sc-add-zero-blocked' as never,
              name: 'Add 0 is blocked',
              description: 'Zero is not a positive integer; the rule blocks.',
              stateOverrides: [],
              parameterOverrides: [{ parameterName: 'by', value: 0 }],
              expectedStatus: 'blocked'
            }
          ]
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-26T00:00:00.000Z',
  updatedAt: '2026-05-26T00:00:00.000Z'
};
