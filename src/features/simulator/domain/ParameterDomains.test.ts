import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asRuleId
} from '$features/behavior-model/domain/value-objects/ids';
import type { RuleCondition } from '$features/behavior-model/domain/value-objects/RuleCondition';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { DEFAULT_MAX_COMBOS, parameterCombinations } from './ParameterDomains';

const action = (parameters: readonly Parameter[], rules: readonly Rule[] = []): Action => ({
  id: asActionId('a'),
  name: 'A',
  intent: 'x',
  parameters,
  requiredStates: [],
  rules,
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
});

const param = (over: Partial<Parameter> & Pick<Parameter, 'name' | 'type'>): Parameter => ({
  id: asParameterId(over.name),
  required: false,
  ...over
});

const blockEffect: Effect = { id: asEffectId('e'), type: 'block_action', reason: 'no' };

const rule = (condition: RuleCondition): Rule => ({
  id: asRuleId('r'),
  category: 'business',
  condition,
  effect: blockEffect
});

const invariant = (condition: RuleCondition): Invariant => ({
  id: asInvariantId('i'),
  name: 'inv',
  condition,
  message: 'violated'
});

const numbers = (result: ReturnType<typeof parameterCombinations>, name: string): number[] =>
  result.combos.map((c) => c[name] as number).sort((x, y) => x - y);

describe('parameterCombinations', () => {
  it('enumerates a required enum parameter instead of skipping it', () => {
    const result = parameterCombinations(
      action([param({ name: 'role', type: 'enum', required: true, enumValues: ['viewer', 'editor'] })]),
      []
    );
    expect(result.explorable).toBe(true);
    expect(result.combos.map((c) => c.role as string).sort()).toEqual(['editor', 'viewer']);
  });

  it('enumerates both booleans', () => {
    const result = parameterCombinations(
      action([param({ name: 'flag', type: 'boolean', required: true })]),
      []
    );
    expect(result.combos.map((c) => c.flag as boolean).sort()).toEqual([false, true]);
  });

  it('uses a number parameter min/max bounds as boundary values', () => {
    const result = parameterCombinations(
      action([
        param({
          name: 'n',
          type: 'number',
          required: true,
          validations: [
            { type: 'min', value: 1 },
            { type: 'max', value: 9 }
          ]
        })
      ]),
      []
    );
    expect(result.combos.map((c) => c.n as number).sort((x, y) => x - y)).toEqual([1, 9]);
  });

  it('is not explorable for a required free-form string with no default', () => {
    const result = parameterCombinations(
      action([param({ name: 's', type: 'string', required: true })]),
      []
    );
    expect(result.explorable).toBe(false);
    expect(result.combos).toEqual([]);
  });

  it('caps the cartesian product and flags it truncated', () => {
    const params = Array.from({ length: 5 }, (_, i) =>
      param({ name: `b${i}`, type: 'boolean', required: true })
    );
    const result = parameterCombinations(action(params), [], 12);
    expect(result.capped).toBe(true);
    expect(result.combos.length).toBeLessThanOrEqual(12);
  });

  it('mines boundary values from an action rule gating the parameter bound state path', () => {
    // A required number with no default and no min/max would normally be
    // unexplorable, but a rule compares the path it binds to against 500.
    const amount = param({
      name: 'amount',
      type: 'number',
      required: true,
      bindToStatePath: asStatePath('order.total')
    });
    const gate = rule({ left: asStatePath('order.total'), operator: 'greater_or_equal', right: 500 });
    const result = parameterCombinations(action([amount], [gate]), []);
    expect(result.explorable).toBe(true);
    const values = numbers(result, 'amount');
    expect(values.some((v) => v < 500)).toBe(true);
    expect(values.some((v) => v >= 500)).toBe(true);
    expect(values).toContain(499);
    expect(values).toContain(500);
  });

  it('mines a boundary from a param-left action rule', () => {
    const amount = param({ name: 'amount', type: 'number', required: true });
    const gate = rule({ left: { kind: 'param', name: 'amount' }, operator: 'greater_than', right: 10 });
    const result = parameterCombinations(action([amount], [gate]), []);
    expect(result.explorable).toBe(true);
    expect(numbers(result, 'amount')).toEqual([9, 10, 11]);
  });

  it('treats a literal-expression right as a threshold', () => {
    const amount = param({
      name: 'amount',
      type: 'number',
      required: true,
      bindToStatePath: asStatePath('order.total')
    });
    const gate = rule({
      left: asStatePath('order.total'),
      operator: 'greater_or_equal',
      right: { kind: 'literal', value: 500 }
    });
    const result = parameterCombinations(action([amount], [gate]), []);
    expect(numbers(result, 'amount')).toEqual([499, 500, 501]);
  });

  it('mines a boundary from a feature invariant on the bound state path', () => {
    const amount = param({
      name: 'amount',
      type: 'number',
      required: true,
      bindToStatePath: asStatePath('order.total')
    });
    const inv = invariant({ left: asStatePath('order.total'), operator: 'lower_or_equal', right: 5000 });
    const result = parameterCombinations(action([amount]), [], DEFAULT_MAX_COMBOS, {
      featureInvariants: [inv]
    });
    expect(result.explorable).toBe(true);
    expect(numbers(result, 'amount')).toEqual([4999, 5000, 5001]);
  });

  it('mines a boundary from a surface rule and surface invariant on the bound state path', () => {
    const amount = param({
      name: 'amount',
      type: 'number',
      required: true,
      bindToStatePath: asStatePath('order.total')
    });
    const surfaceRule = rule({ left: asStatePath('order.total'), operator: 'greater_than', right: 100 });
    const surfaceInv = invariant({
      left: asStatePath('order.total'),
      operator: 'lower_than',
      right: 200
    });
    const result = parameterCombinations(action([amount]), [], DEFAULT_MAX_COMBOS, {
      surfaceRules: [surfaceRule],
      surfaceInvariants: [surfaceInv]
    });
    expect(result.explorable).toBe(true);
    expect(numbers(result, 'amount')).toEqual([99, 100, 101, 199, 200, 201]);
  });

  it('stays not explorable for a required number that no condition references', () => {
    const amount = param({
      name: 'amount',
      type: 'number',
      required: true,
      bindToStatePath: asStatePath('order.total')
    });
    // A rule exists, but it references a different path — no threshold to mine.
    const unrelated = rule({ left: asStatePath('other.value'), operator: 'greater_than', right: 3 });
    const result = parameterCombinations(action([amount], [unrelated]), []);
    expect(result.explorable).toBe(false);
    expect(result.combos).toEqual([]);
  });
});
