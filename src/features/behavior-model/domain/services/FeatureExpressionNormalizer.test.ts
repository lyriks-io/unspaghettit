import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Invariant } from '../entities/Invariant';
import type { Expression } from '../value-objects/Expression';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';
import { asStatePath } from '../value-objects/StatePath';
import { normalizeFeatureExpressions } from './FeatureExpressionNormalizer';

const P = asStatePath('cart.items');

/**
 * What JSON authoring lets through: an arithmetic node whose child is a raw
 * number instead of an Expression. The types forbid it, which is the point.
 */
const authored = (n: number): Expression =>
  ({ kind: 'add', left: { kind: 'state', path: P }, right: n }) as unknown as Expression;
const wellFormed = (n: number): Expression => ({
  kind: 'add',
  left: { kind: 'state', path: P },
  right: { kind: 'literal', value: n }
});

/** A feature carrying the expression `e(n)` in every slot that can hold one. */
const featureWith = (e: (n: number) => Expression): Feature => {
  const leaf = (n: number): RuleCondition => ({ left: P, operator: 'lower_than', right: e(n) });
  const invariant = (n: number): Invariant => ({
    id: asInvariantId(`i${n}`),
    name: 'Holds',
    condition: {
      kind: 'all',
      conditions: [
        leaf(n),
        { kind: 'not', condition: leaf(n + 1) },
        { kind: 'all_match', overPath: asStatePath('cart.lines'), as: 'line', where: leaf(n + 2) }
      ]
    },
    message: 'Broken.'
  });
  return {
    id: asFeatureId('f'),
    name: 'Cart',
    surfaces: [
      {
        id: asSurfaceId('s'),
        name: 'Cart',
        type: 'screen',
        stateDefinitions: [
          { id: asStateDefinitionId('d1'), path: P, type: 'number', defaultValue: 0 },
          { id: asStateDefinitionId('d2'), path: asStatePath('cart.next'), type: 'number', defaultValue: 0, derived: e(1) }
        ],
        rules: [
          {
            id: asRuleId('sr'),
            category: 'validation',
            condition: { kind: 'any', conditions: [leaf(10), leaf(11)] },
            effect: { id: asEffectId('sre'), type: 'set_state', path: P, value: e(12) }
          }
        ],
        invariants: [invariant(20)],
        transitions: [],
        actions: [
          {
            id: asActionId('a'),
            name: 'Add',
            intent: 'Add.',
            parameters: [],
            requiredStates: [],
            rules: [
              {
                id: asRuleId('ar'),
                category: 'validation',
                condition: leaf(30),
                effect: { id: asEffectId('are'), type: 'block_action', reason: 'No.' }
              },
              // An unconditional rule keeps having no condition.
              { id: asRuleId('ar2'), category: 'business', effect: { id: asEffectId('ok'), type: 'set_state', path: P, value: e(31) } }
            ],
            invariants: [invariant(40)],
            effects: [
              { id: asEffectId('e1'), type: 'set_state', path: P, value: e(50) },
              { id: asEffectId('e2'), type: 'append_to_list', path: asStatePath('cart.lines'), item: e(51) },
              {
                id: asEffectId('e3'),
                type: 'remove_from_list',
                path: asStatePath('cart.lines'),
                where: { field: 'qty', equals: e(52) },
                value: e(53)
              },
              {
                id: asEffectId('e4'),
                type: 'update_list_item',
                path: asStatePath('cart.lines'),
                where: { field: 'qty', equals: e(54) },
                field: 'qty',
                value: e(55)
              },
              { id: asEffectId('e5'), type: 'advance_time', by: e(56) },
              { id: asEffectId('e6'), type: 'show_message', message: 'Added.' }
            ],
            onBlockedEffects: [{ id: asEffectId('e7'), type: 'set_state', path: P, value: e(60) }],
            emittedEvents: [],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId('sc'),
                name: 'Adds',
                stateOverrides: [],
                parameterOverrides: [],
                expectedAssertions: [
                  { path: P, operator: 'equals', value: e(70) },
                  { path: P, operator: 'exists' }
                ]
              },
              { id: asScenarioId('sc2'), name: 'Bare', stateOverrides: [], parameterOverrides: [] }
            ]
          }
        ]
      }
    ],
    personas: [],
    resources: [],
    entities: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  };
};

describe('normalizeFeatureExpressions', () => {
  it('wraps a raw value buried in an expression as a literal, in every slot of the feature', () => {
    expect(normalizeFeatureExpressions(featureWith(authored))).toEqual(featureWith(wellFormed));
  });

  it('changes nothing on a feature already well formed, and gives the same result twice', () => {
    const once = normalizeFeatureExpressions(featureWith(authored));
    expect(normalizeFeatureExpressions(once)).toEqual(once);
    expect(normalizeFeatureExpressions(featureWith(wellFormed))).toEqual(featureWith(wellFormed));
  });

  it('keeps a raw value in an outer slot, where a value is allowed', () => {
    const outer = featureWith(() => 5 as unknown as Expression);
    expect(normalizeFeatureExpressions(outer)).toEqual(outer);
  });

  it('passes a missing condition through instead of throwing, so the feature can still be read', () => {
    const f = featureWith(wellFormed);
    const surface = f.surfaces[0]!;
    const broken: Feature = {
      ...f,
      surfaces: [{ ...surface, invariants: [{ ...surface.invariants[0]!, condition: undefined as unknown as RuleCondition }] }]
    };
    expect(normalizeFeatureExpressions(broken).surfaces[0]!.invariants[0]!.condition).toBeUndefined();
  });
});
