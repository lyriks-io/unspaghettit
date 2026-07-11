import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import { asActionId, asParameterId } from '$features/behavior-model/domain/value-objects/ids';
import { parameterCombinations } from './ParameterDomains';

const action = (parameters: readonly Parameter[]): Action => ({
  id: asActionId('a'),
  name: 'A',
  intent: 'x',
  parameters,
  requiredStates: [],
  rules: [],
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
});
