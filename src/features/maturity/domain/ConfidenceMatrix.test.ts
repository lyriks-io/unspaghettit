import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { computeConfidence } from './ConfidenceMatrix';

const covered: Action = {
  id: asActionId('covered'),
  name: 'Save',
  intent: 'save',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [{ id: asEffectId('e'), type: 'set_state', path: asStatePath('a.b'), value: true }],
  emittedEvents: [],
  transitions: [],
  scenarios: [
    {
      id: 'sc' as never,
      name: 'saves',
      description: 'it saves',
      stateOverrides: [],
      parameterOverrides: []
    }
  ]
};

const contradictory: Action = {
  id: asActionId('bad'),
  name: 'Approve',
  intent: 'approve',
  parameters: [],
  requiredStates: [],
  rules: [
    {
      id: asRuleId('r1'),
      category: 'permissions',
      condition: { left: asStatePath('a.b'), operator: 'is_true' },
      effect: { id: asEffectId('e1'), type: 'allow_action' }
    },
    {
      id: asRuleId('r2'),
      category: 'permissions',
      condition: { left: asStatePath('a.b'), operator: 'is_true' },
      effect: { id: asEffectId('e2'), type: 'block_action', reason: 'no' }
    }
  ],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
};

const feature: Feature = {
  id: asFeatureId('f'),
  name: 'F',
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('d'),
          path: asStatePath('a.b'),
          type: 'boolean',
          defaultValue: false
        }
      ],
      actions: [covered, contradictory],
      rules: [],
      invariants: [], // no guardrails anywhere
      transitions: []
    } as Surface
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

describe('computeConfidence', () => {
  const matrix = computeConfidence(feature, { passed: 8, total: 10 });
  const dim = (key: string) => matrix.dimensions.find((d) => d.key === key)!;

  it('reports the weakest dimension as the honest overall, not an average', () => {
    // guardrails is 0 (no invariants), so overall must be 0 despite strong dims.
    expect(dim('guardrails').score).toBe(0);
    expect(matrix.overall).toBe(0);
    expect(matrix.weakest.key).toBe('guardrails');
  });

  it('derives each dimension from concrete, explained counts', () => {
    expect(dim('structural').score).toBe(80);
    expect(dim('structural').detail).toContain('8 of 10');
    // 1 of 2 non-trivial actions has a scenario.
    expect(dim('behavioral').score).toBe(50);
    // both actions run to an effect or rule.
    expect(dim('executability').score).toBe(100);
    // 1 of 2 actions has a contradictory rule set.
    expect(dim('consistency').score).toBe(50);
    expect(dim('consistency').detail).toContain('1 of 2');
  });

  it('excludes presentation surfaces from every dimension', () => {
    // A builder/navigation screen: unguarded, holding an action with an empty
    // body (would drag executability) and a contradictory one (would drag
    // behavioral coverage and consistency). Without the exclusion, the same
    // rule as MaturityScorer's rollup, these would skew every denominator.
    const emptyAction: Action = {
      id: asActionId('open'),
      name: 'Open',
      intent: 'open',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: []
    };
    const presentationSurface: Surface = {
      id: asSurfaceId('builder'),
      name: 'Builder screen',
      type: 'screen',
      presentation: true,
      stateDefinitions: [],
      actions: [emptyAction, { ...contradictory, id: asActionId('bad-presentation') }],
      rules: [],
      invariants: [],
      transitions: []
    };
    const withPresentation: Feature = {
      ...feature,
      surfaces: [...feature.surfaces, presentationSurface]
    };

    const a = computeConfidence(withPresentation, { passed: 8, total: 10 });
    const b = computeConfidence(feature, { passed: 8, total: 10 });
    expect(a).toEqual(b);

    const dimA = (key: string) => a.dimensions.find((d) => d.key === key)!;
    // Denominators count only the behavioral surface's 2 actions and 1 surface.
    expect(dimA('behavioral').total).toBe(2);
    expect(dimA('guardrails').total).toBe(1);
    expect(dimA('executability').total).toBe(2);
    expect(dimA('consistency').total).toBe(2);
  });
});
