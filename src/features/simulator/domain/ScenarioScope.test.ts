import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { scenarioExercises, scenarioScopeOfChange } from './ScenarioScope';

const scenario = (id: string, extra: Partial<Scenario> = {}): Scenario => ({
  id: asScenarioId(id),
  name: id,
  stateOverrides: [],
  parameterOverrides: [],
  expectedStatus: 'success',
  ...extra
});

const action = (id: string, extra: Partial<Action> = {}): Action => ({
  id: asActionId(id),
  name: id,
  intent: `Do ${id}`,
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [
    {
      id: asEffectId(`eff-${id}`),
      type: 'set_state',
      path: asStatePath('count'),
      value: { kind: 'literal', value: 1 }
    }
  ],
  emittedEvents: [],
  transitions: [],
  scenarios: [scenario(`sc-${id}`)],
  ...extra
});

const surface = (actions: readonly Action[], extra: Partial<Surface> = {}): Surface => ({
  id: asSurfaceId('s1'),
  name: 'Screen',
  type: 'screen',
  stateDefinitions: [
    { id: asStateDefinitionId('sd1'), path: asStatePath('count'), type: 'number', defaultValue: 0 }
  ],
  actions,
  rules: [],
  invariants: [],
  transitions: [],
  ...extra
});

const feature = (surfaces: readonly Surface[], extra: Partial<Feature> = {}): Feature => ({
  id: asFeatureId('f1'),
  name: 'Test',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
  ...extra
});

const touchedIds = (before: Feature, after: Feature): readonly string[] => {
  const scope = scenarioScopeOfChange(before, after);
  if (scope.scope !== 'touched') throw new Error(`expected a touched scope, got ${scope.scope}`);
  return [...scope.actionIds].sort();
};

describe('scenarioScopeOfChange', () => {
  it('names only the action whose own content changed', () => {
    const before = feature([surface([action('a'), action('b')])]);
    const after = feature([
      surface([action('a', { intent: 'Do a differently' }), action('b')])
    ]);
    expect(touchedIds(before, after)).toEqual(['a']);
  });

  it('counts a new action, and a change to anything an action owns, order included', () => {
    const blockRule = (id: string) => ({
      id: asRuleId(id),
      category: 'validation' as const,
      condition: { left: asStatePath('count'), operator: 'equals' as const, right: 99 },
      effect: { id: asEffectId(`e-${id}`), type: 'block_action' as const, reason: id }
    });
    const before = feature([
      surface([action('a', { rules: [blockRule('r1'), blockRule('r2')] }), action('b')])
    ]);
    const after = feature([
      surface([
        action('a', { rules: [blockRule('r2'), blockRule('r1')] }),
        action('b', { scenarios: [scenario('sc-b'), scenario('sc-b2')] }),
        action('c')
      ])
    ]);
    expect(touchedIds(before, after)).toEqual(['a', 'b', 'c']);
  });

  it('touches nothing when only prose or organisation moved', () => {
    const before = feature([surface([action('a')])]);
    const after = feature([surface([action('a')], { name: 'Renamed', description: 'Prose.' })], {
      name: 'Renamed feature',
      acceptanceCriteria: [],
      nonGoals: ['No auth']
    });
    expect(touchedIds(before, after)).toEqual([]);
  });

  it('does not widen for an empty surface added next to the others', () => {
    const before = feature([surface([action('a')])]);
    const after = feature([
      surface([action('a')]),
      surface([action('z')], { id: asSurfaceId('s2'), stateDefinitions: [] })
    ]);
    expect(touchedIds(before, after)).toEqual(['z']);
  });

  it.each([
    [
      'a state definition',
      (f: Feature): Feature =>
        feature([
          {
            ...f.surfaces[0]!,
            stateDefinitions: [{ ...f.surfaces[0]!.stateDefinitions[0]!, defaultValue: 5 }]
          }
        ])
    ],
    [
      'a constant',
      (f: Feature): Feature => ({
        ...f,
        constants: [{ id: 'k1', name: 'LIMIT', value: 3 }] as unknown as Feature['constants']
      })
    ],
    [
      'a feature invariant',
      (f: Feature): Feature => ({
        ...f,
        featureInvariants: [
          {
            id: 'inv1',
            name: 'count stays small',
            condition: { left: asStatePath('count'), operator: 'lower_than', right: 10 }
          }
        ] as unknown as Feature['featureInvariants']
      })
    ]
  ])('widens to the feature when the batch touched %s', (_label, change) => {
    const before = feature([surface([action('a'), action('b')])]);
    expect(scenarioScopeOfChange(before, change(before))).toEqual({ scope: 'feature' });
  });

  it('widens to the feature when an event handler is touched, added or removed', () => {
    const handler = action('h', { triggeredByEvent: asEventName('count.changed') });
    const before = feature([surface([action('a'), handler])]);
    const edited = feature([surface([action('a'), { ...handler, intent: 'React differently' }])]);
    const removed = feature([surface([action('a')])]);
    expect(scenarioScopeOfChange(before, edited)).toEqual({ scope: 'feature' });
    expect(scenarioScopeOfChange(before, removed)).toEqual({ scope: 'feature' });
    expect(scenarioScopeOfChange(removed, before)).toEqual({ scope: 'feature' });
  });
});

describe('scenarioExercises', () => {
  it('selects the scenarios testing a touched action and the ones replaying it as a step', () => {
    const a = action('a');
    const b = action('b', {
      scenarios: [
        scenario('sc-b-alone'),
        scenario('sc-b-after-a', {
          steps: [{ actionId: asActionId('a'), parameterOverrides: [] }]
        })
      ]
    });
    const touched = new Set(['a']);
    expect(scenarioExercises(touched, a, a.scenarios![0]!)).toBe(true);
    expect(scenarioExercises(touched, b, b.scenarios![0]!)).toBe(false);
    expect(scenarioExercises(touched, b, b.scenarios![1]!)).toBe(true);
  });
});

describe('runScenariosUseCase with a scope', () => {
  const run = runScenariosUseCase();

  it('runs only the scenarios exercising the named actions', () => {
    const f = feature([surface([action('a'), action('b'), action('c')])]);
    const out = run({ feature: f, exercisingActionIds: new Set(['b']) });
    expect(out.results.map((r) => String(r.scenarioId))).toEqual(['sc-b']);
    expect(out.truncated).toBeUndefined();
  });

  it('runs nothing for an empty set, which is not the same as no filter', () => {
    const f = feature([surface([action('a'), action('b')])]);
    expect(run({ feature: f, exercisingActionIds: new Set() }).total).toBe(0);
    expect(run({ feature: f }).total).toBe(2);
  });

  it('stops at the limit in model order and says so', () => {
    const f = feature([surface([action('a'), action('b'), action('c')])]);
    const out = run({ feature: f, limit: 2 });
    expect(out.results.map((r) => String(r.scenarioId))).toEqual(['sc-a', 'sc-b']);
    expect(out.total).toBe(2);
    expect(out.truncated).toBe(true);
    expect(run({ feature: f, limit: 3 }).truncated).toBeUndefined();
  });
});
