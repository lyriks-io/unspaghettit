import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Invariant } from '../entities/Invariant';
import type { Rule } from '../entities/Rule';
import type { Surface } from '../entities/Surface';
import type { Effect } from '../value-objects/Effect';
import type { Expression } from '../value-objects/Expression';
import {
  asActionId,
  asDependencyId,
  asEffectId,
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asOutcomeId,
  asPersonaId,
  asReachabilityGoalId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';
import { asStatePath } from '../value-objects/StatePath';
import {
  countStatePathReferences,
  formatReferenceBreakdown,
  totalReferences,
  type StatePathReferences
} from './StatePathReferences';

const ITEMS = asStatePath('cart.items');
const state = (path: string): Expression => ({ kind: 'state', path: asStatePath(path) });
const lit = (value: number): Expression => ({ kind: 'literal', value });

let seq = 0;
const next = (prefix: string) => `${prefix}-${seq++}`;

const action = (part: Partial<Action> = {}): Action => ({
  id: asActionId(next('a')),
  name: 'Act',
  intent: 'Do it.',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  ...part
});

const rule = (condition: RuleCondition | undefined, effect?: Effect): Rule => ({
  id: asRuleId(next('r')),
  category: 'validation',
  ...(condition ? { condition } : {}),
  effect: effect ?? { id: asEffectId(next('e')), type: 'block_action', reason: 'No.' }
});

const invariant = (condition: RuleCondition): Invariant => ({
  id: asInvariantId(next('i')),
  name: 'Holds',
  condition,
  message: 'Broken.'
});

const surface = (part: Partial<Surface> = {}): Surface => ({
  id: asSurfaceId(next('s')),
  name: 'Cart',
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: [],
  ...part
});

const feature = (part: Partial<Feature> = {}): Feature => ({
  id: asFeatureId('f'),
  name: 'Cart',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...part
});

const setState = (path: string, value: Expression | number): Effect => ({
  id: asEffectId(next('e')),
  type: 'set_state',
  path: asStatePath(path),
  value
});

/** Only the kinds a test names, every other kind at zero. */
const counted = (counts: Partial<Omit<StatePathReferences, 'path'>>): StatePathReferences => ({
  path: ITEMS,
  stateDefinitions: 0,
  parameterBindings: 0,
  parameterResources: 0,
  actionRequiredStates: 0,
  ruleConditions: 0,
  setStateEffects: 0,
  invariantConditions: 0,
  personaStateOverrides: 0,
  otherDataFields: 0,
  derivedStates: 0,
  goalConditions: 0,
  outcomeReferences: 0,
  scenarioReferences: 0,
  ...counts
});

describe('countStatePathReferences', () => {
  it('counts nothing on a feature that never names the path', () => {
    expect(countStatePathReferences(feature({ surfaces: [surface()] }), ITEMS)).toEqual(counted({}));
  });

  it('counts the declarations, requirements, bindings, overrides and entity fields that name the path', () => {
    const f = feature({
      surfaces: [
        surface({
          stateDefinitions: [
            { id: asStateDefinitionId('d1'), path: ITEMS, type: 'number', defaultValue: 0 },
            { id: asStateDefinitionId('d2'), path: asStatePath('cart.total'), type: 'number', defaultValue: 0 }
          ],
          actions: [
            action({
              requiredStates: [ITEMS, asStatePath('cart.total')],
              parameters: [
                { id: asParameterId('p1'), name: 'qty', type: 'number', required: true, bindToStatePath: ITEMS },
                { id: asParameterId('p2'), name: 'note', type: 'string', required: false }
              ]
            })
          ]
        }),
        // A second surface sharing the path counts again.
        surface({ stateDefinitions: [{ id: asStateDefinitionId('d3'), path: ITEMS, type: 'number', defaultValue: 0 }] })
      ],
      personas: [
        {
          id: asPersonaId('full'),
          name: 'Full cart',
          stateOverrides: [
            { path: ITEMS, value: 9 },
            { path: asStatePath('cart.total'), value: 90 }
          ],
          parameterOverrides: []
        }
      ],
      entities: [
        {
          id: asEntityId('cart'),
          namespace: 'cart',
          fields: [
            { id: asEntityFieldId('f1'), name: 'items', type: 'number', path: ITEMS },
            { id: asEntityFieldId('f2'), name: 'label', type: 'string' }
          ]
        }
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(
      counted({
        stateDefinitions: 2,
        actionRequiredStates: 1,
        parameterBindings: 1,
        personaStateOverrides: 1,
        otherDataFields: 1
      })
    );
  });

  it('matches the whole path, never a path that only starts or ends the same', () => {
    const f = feature({
      surfaces: [
        surface({
          stateDefinitions: [
            { id: asStateDefinitionId('d1'), path: asStatePath('cart.itemsCount'), type: 'number', defaultValue: 0 },
            { id: asStateDefinitionId('d2'), path: asStatePath('cart'), type: 'object', defaultValue: {} },
            { id: asStateDefinitionId('d3'), path: asStatePath('old.cart.items'), type: 'number', defaultValue: 0 }
          ],
          actions: [action({ effects: [setState('cart.itemsCount', state('cart.item'))] })]
        })
      ]
    });
    expect(totalReferences(countStatePathReferences(f, ITEMS))).toBe(0);
  });

  it('counts each leaf of a rule condition that reads the path, through all, any, not and a quantifier', () => {
    const condition: RuleCondition = {
      kind: 'all',
      conditions: [
        { left: ITEMS, operator: 'greater_than', right: 0 },
        {
          kind: 'any',
          conditions: [
            { kind: 'not', condition: { left: ITEMS, operator: 'equals', right: 3 } },
            // Read on the right side, buried in an expression.
            { left: asStatePath('cart.total'), operator: 'greater_than', right: { kind: 'mul', left: state('cart.items'), right: lit(2) } }
          ]
        },
        // A quantifier over the path reads it once, whatever its body says.
        { kind: 'any_match', overPath: ITEMS, as: 'item', where: { left: asStatePath('item.qty'), operator: 'greater_than', right: 0 } }
      ]
    };
    const f = feature({ surfaces: [surface({ actions: [action({ rules: [rule(condition)] })] })] });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ ruleConditions: 4 }));
  });

  it('counts an unconditional rule as no condition read, but what its effect writes', () => {
    const f = feature({
      surfaces: [
        surface({
          actions: [action({ rules: [rule(undefined, setState('cart.items', 0))] })],
          rules: [rule({ left: ITEMS, operator: 'exists' }, setState('cart.total', state('cart.items')))]
        })
      ]
    });
    // The action rule writes the path; the surface rule reads it and its effect reads it.
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ ruleConditions: 1, setStateEffects: 2 }));
  });

  it('counts the target of every state-writing effect and each read inside its expressions', () => {
    const where = { field: 'sku', equals: state('cart.items') };
    const effects: Effect[] = [
      // Writes the path and reads it: 2.
      setState('cart.items', { kind: 'add', left: state('cart.items'), right: lit(1) }),
      // Writes another path from a switch that reads it in a case, its result and its default: 3.
      setState('cart.total', {
        kind: 'switch',
        cases: [{ when: { left: ITEMS, operator: 'greater_than', right: 0 }, then: { kind: 'neg', operand: state('cart.items') } }],
        default: { kind: 'count_where', operand: state('cart.lines'), field: 'sku', equals: state('cart.items') }
      }),
      // Appends to the path: 1.
      { id: asEffectId('ap'), type: 'append_to_list', path: ITEMS, item: lit(1) },
      // Removes from another list, matching and valued on the path: 2.
      { id: asEffectId('rm'), type: 'remove_from_list', path: asStatePath('cart.lines'), where, value: state('cart.items') },
      // Updates an item of the path, matching on the path: 2.
      { id: asEffectId('up'), type: 'update_list_item', path: ITEMS, where, field: 'qty', value: lit(0) },
      // Moves the clock by the path: 1.
      { id: asEffectId('tm'), type: 'advance_time', by: state('cart.items') },
      // Writes its result to the path: 1.
      { id: asEffectId('op'), type: 'invoke_operation', dependencyId: asDependencyId('stock'), operation: 'reserve', resultPath: ITEMS, resultValue: lit(1) },
      // Says something: 0.
      { id: asEffectId('msg'), type: 'show_message', message: 'cart.items changed' }
    ];
    const f = feature({ surfaces: [surface({ actions: [action({ effects })] })] });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ setStateEffects: 12 }));
  });

  it('counts the effects that run when the action is refused, beside the ones that run when it succeeds', () => {
    const f = feature({
      surfaces: [
        surface({
          actions: [action({ effects: [setState('cart.items', 1)], onBlockedEffects: [setState('cart.items', 0)] })]
        })
      ]
    });
    expect(countStatePathReferences(f, ITEMS).setStateEffects).toBe(2);
  });

  it('counts the conditions of action and surface invariants', () => {
    const f = feature({
      surfaces: [
        surface({
          actions: [action({ invariants: [invariant({ left: ITEMS, operator: 'greater_or_equal', right: 0 })] })],
          invariants: [
            invariant({
              kind: 'all',
              conditions: [
                { left: ITEMS, operator: 'lower_or_equal', right: state('stock.left') },
                { left: asStatePath('stock.left'), operator: 'greater_or_equal', right: state('cart.items') }
              ]
            })
          ]
        })
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ invariantConditions: 3 }));
  });
});

describe('the places a rename or a removal reaches beyond rules and effects', () => {
  it('counts the conditions of feature invariants', () => {
    const f = feature({
      surfaces: [surface()],
      featureInvariants: [invariant({ left: ITEMS, operator: 'lower_or_equal', right: state('cart.items') })]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ invariantConditions: 2 }));
  });

  it('counts the conditions of reachability goals', () => {
    const f = feature({
      surfaces: [surface()],
      reachabilityGoals: [
        {
          id: asReachabilityGoalId('g1'),
          name: 'A full cart',
          kind: 'reachable',
          condition: { left: ITEMS, operator: 'greater_than', right: 0 }
        }
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ goalConditions: 1 }));
  });

  it('counts the derived expressions that read the path', () => {
    const f = feature({
      surfaces: [
        surface({
          stateDefinitions: [
            { id: asStateDefinitionId('d1'), path: asStatePath('cart.double'), type: 'number', defaultValue: 0, derived: { kind: 'mul', left: state('cart.items'), right: lit(2) } }
          ]
        })
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ stateDefinitions: 0, derivedStates: 1 }));
  });

  it('counts the outcome conditions and the outcome effects', () => {
    const f = feature({
      surfaces: [
        surface({
          actions: [
            action({
              outcomes: [
                {
                  id: asOutcomeId('o1'),
                  name: 'Full',
                  kind: 'success',
                  condition: { left: ITEMS, operator: 'greater_than', right: 0 },
                  effects: [setState('cart.total', state('cart.items'))]
                }
              ]
            })
          ]
        })
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ outcomeReferences: 2 }));
  });

  it('counts the scenario overrides and assertions, the steps included', () => {
    const f = feature({
      surfaces: [
        surface({
          actions: [
            action({
              scenarios: [
                {
                  id: asScenarioId('sc1'),
                  name: 'Two items',
                  stateOverrides: [{ path: ITEMS, value: 2 }],
                  parameterOverrides: [],
                  expectedAssertions: [{ path: ITEMS, operator: 'equals', value: 3 }],
                  steps: [
                    {
                      actionId: asActionId('a-other'),
                      parameterOverrides: [],
                      expectedAssertions: [{ path: ITEMS, operator: 'equals', value: 2 }]
                    }
                  ]
                }
              ]
            })
          ]
        })
      ]
    });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ scenarioReferences: 3 }));
  });

  it('counts an outer path a quantifier body reads, never the element it binds', () => {
    const condition: RuleCondition = {
      kind: 'all_match',
      overPath: asStatePath('cart.lines'),
      as: 'line',
      where: {
        kind: 'all',
        conditions: [
          { left: asStatePath('line.qty'), operator: 'lower_or_equal', right: state('cart.items') },
          { left: ITEMS, operator: 'greater_than', right: 0 }
        ]
      }
    };
    const f = feature({ surfaces: [surface({ actions: [action({ rules: [rule(condition)] })] })] });
    expect(countStatePathReferences(f, ITEMS)).toEqual(counted({ ruleConditions: 2 }));
  });
});

describe('totalReferences', () => {
  it('adds every kind of reference', () => {
    expect(
      totalReferences(
        counted({
          stateDefinitions: 1,
          parameterBindings: 2,
          parameterResources: 3,
          actionRequiredStates: 4,
          ruleConditions: 5,
          setStateEffects: 6,
          invariantConditions: 7,
          personaStateOverrides: 8,
          otherDataFields: 9
        })
      )
    ).toBe(45);
  });
});

describe('formatReferenceBreakdown', () => {
  it('names each kind that has references, singular for one and plural above', () => {
    expect(
      formatReferenceBreakdown(
        counted({ stateDefinitions: 1, ruleConditions: 2, setStateEffects: 1, invariantConditions: 3, otherDataFields: 2 })
      )
    ).toBe('1 state definition, 2 rule conditions, 1 set_state effect, 3 invariants, 2 data fields');
  });

  it('says nothing when the path is referenced nowhere', () => {
    expect(formatReferenceBreakdown(counted({}))).toBe('');
  });
});
