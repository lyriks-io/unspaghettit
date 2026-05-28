import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asParameterId,
  asPersonaId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { runScenariosUseCase } from './RunScenarios';

const makeFeature = (action: Action, personas: readonly Persona[] = []): Feature => {
  const surface: Surface = {
    id: asSurfaceId('s1'),
    name: 'Screen',
    type: 'screen',
    stateDefinitions: [
      {
        id: asStateDefinitionId('sd1'),
        path: asStatePath('count'),
        type: 'number',
        defaultValue: 0
      }
    ],
    actions: [action],
    rules: [],
    invariants: [],
    transitions: []
  };
  return {
    id: asFeatureId('e1'),
    name: 'Test',
    surfaces: [surface],
    personas,
    resources: [],
    entities: [],
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z'
  };
};

describe('runScenariosUseCase', () => {
  it('reports a pass when expectedStatus and assertions hold', () => {
    const action: Action = {
      id: asActionId('c1'),
      name: 'Increment',
      intent: 'Add one to count',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('eff1'),
          type: 'set_state',
          path: asStatePath('count'),
          value: {
            kind: 'add',
            left: { kind: 'state', path: asStatePath('count') },
            right: { kind: 'literal', value: 1 }
          }
        }
      ],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'count starts at 4, ends at 5',
          stateOverrides: [{ path: asStatePath('count'), value: 4 }],
          parameterOverrides: [],
          expectedStatus: 'success',
          expectedAssertions: [
            { path: asStatePath('count'), operator: 'equals', value: 5 }
          ]
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.total).toBe(1);
    expect(out.passed).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.results[0]?.pass).toBe(true);
  });

  it('applies a scenario persona before scenario overrides', () => {
    const persona: Persona = {
      id: asPersonaId('p1'),
      name: 'Premium user',
      description: 'A signed-in premium customer baseline for scenario runs.',
      stateOverrides: [{ path: asStatePath('count'), value: 10 }],
      parameterOverrides: [{ parameterName: 'amount', value: 2 }]
    };
    const action: Action = {
      id: asActionId('c1'),
      name: 'Add amount',
      intent: 'Add the requested amount to count',
      parameters: [
        {
          id: asParameterId('param1'),
          name: 'amount',
          type: 'number',
          required: true,
          description: 'Amount added to the count.'
        }
      ],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('eff1'),
          type: 'set_state',
          path: asStatePath('count'),
          value: {
            kind: 'add',
            left: { kind: 'state', path: asStatePath('count') },
            right: { kind: 'param', name: 'amount' }
          }
        }
      ],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'premium baseline increments by persona amount',
          description: 'Uses persona state and scenario parameter overrides in run_all_scenarios.',
          personaId: persona.id,
          stateOverrides: [],
          parameterOverrides: [{ parameterName: 'amount', value: 5 }],
          expectedStatus: 'success',
          expectedAssertions: [
            {
              path: asStatePath('count'),
              operator: 'equals',
              value: 15,
              description: 'Persona count 10 plus scenario amount 5 is persisted.'
            }
          ]
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action, [persona]) });
    expect(out.passed).toBe(1);
    expect(out.results[0]?.personaId).toBe('p1');
    expect(out.results[0]?.personaName).toBe('Premium user');
  });

  it('reports a fail when an assertion does not hold', () => {
    const action: Action = {
      id: asActionId('c1'),
      name: 'Increment',
      intent: 'Add one to count',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('eff1'),
          type: 'set_state',
          path: asStatePath('count'),
          value: 99
        }
      ],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'expected 5 but spec writes 99',
          stateOverrides: [],
          parameterOverrides: [],
          expectedAssertions: [
            { path: asStatePath('count'), operator: 'equals', value: 5 }
          ]
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.passed).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.results[0]?.pass).toBe(false);
    expect(out.results[0]?.assertions[0]?.held).toBe(false);
  });

  it('marks expected-success assertions as skipped when the action is blocked', () => {
    // Reproduces the audit case: a scenario expects success and authors
    // post-state assertions, but a rule (perhaps unintentionally) blocks the
    // action. Old behaviour evaluated the assertion against the untouched
    // snapshot, producing a confusing "held: true" alongside a "fail" verdict
    // when the spec also still satisfied the assertion by coincidence. New
    // behaviour skips assertions when blocked so the only failure signal is
    // the status mismatch.
    const action: Action = {
      id: asActionId('c1'),
      name: 'Always blocked',
      intent: 'never lets the user proceed',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: -1 },
          effect: { id: asEffectId('eff1'), type: 'block_action', reason: 'always' }
        }
      ],
      invariants: [],
      effects: [
        {
          id: asEffectId('eff2'),
          type: 'set_state',
          path: asStatePath('count'),
          value: 5
        }
      ],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'expected success with post-state assertion',
          stateOverrides: [],
          parameterOverrides: [],
          expectedStatus: 'success',
          expectedAssertions: [
            { path: asStatePath('count'), operator: 'equals', value: 5 }
          ]
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.results[0]?.actualStatus).toBe('blocked');
    expect(out.results[0]?.assertions[0]?.held).toBeNull();
    expect(out.results[0]?.assertions[0]?.skipped).toBe(true);
    expect(out.results[0]?.pass).toBe(false); // fails on status only
    expect(out.results[0]?.summary).toContain('blocked');
  });

  it('passes when expectedTransition matches the actual transition target', () => {
    const action: Action = {
      id: asActionId('c1'),
      name: 'Submit',
      intent: 'route',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: 0 },
          effect: {
            id: asEffectId('eff1'),
            type: 'transition_surface',
            target: asSurfaceId('s1')
          }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc-pass'),
          name: 'routes to s1 when count > 0',
          stateOverrides: [{ path: asStatePath('count'), value: 1 }],
          parameterOverrides: [],
          expectedStatus: 'success',
          expectedTransition: asSurfaceId('s1')
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.passed).toBe(1);
    expect(out.results[0]?.transitionCheck?.matches).toBe(true);
    expect(out.results[0]?.transitionCheck?.actual).toBe('s1');
  });

  it('fails when actual transition diverges from expectedTransition', () => {
    const action: Action = {
      id: asActionId('c1'),
      name: 'Submit',
      intent: 'route',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('eff1'),
          type: 'transition_surface',
          target: asSurfaceId('success')
        }
      ],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc-fail'),
          name: 'expected to route to auth but always lands at success',
          stateOverrides: [],
          parameterOverrides: [],
          expectedStatus: 'success',
          expectedTransition: asSurfaceId('auth')
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.passed).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.results[0]?.transitionCheck?.matches).toBe(false);
    expect(out.results[0]?.summary).toContain('transition');
  });

  it('reports a fail when actual status diverges from expectedStatus', () => {
    const action: Action = {
      id: asActionId('c1'),
      name: 'Always blocked',
      intent: 'never lets the user proceed',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'security',
          condition: {
            left: asStatePath('count'),
            operator: 'greater_than',
            right: -1
          },
          effect: {
            id: asEffectId('eff1'),
            type: 'block_action',
            reason: 'always'
          }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'optimistic spec expected success',
          stateOverrides: [],
          parameterOverrides: [],
          expectedStatus: 'success'
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.failed).toBe(1);
    expect(out.results[0]?.actualStatus).toBe('blocked');
    expect(out.results[0]?.statusMatches).toBe(false);
  });

  it('fails a scenario that authored assertions but had them all skipped (silent-skip guard)', () => {
    // Regression: a scenario with expectedAssertions but expectedStatus
    // omitted used to silently "pass" when the action got blocked because
    // every assertion would skip and `every(skipped || held)` was vacuously
    // true. Authoring slip: typo'd parameterName, missed required
    // parameter, unintentionally permissive rule. Now we fail loudly so
    // the spec test catches the missing coverage.
    const action: Action = {
      id: asActionId('c1'),
      name: 'Always blocked',
      intent: 'never lets the user proceed',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: -1 },
          effect: { id: asEffectId('eff1'), type: 'block_action', reason: 'always' }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'author forgot expectedStatus and the action blocked',
          stateOverrides: [],
          parameterOverrides: [],
          // expectedStatus deliberately omitted
          expectedAssertions: [
            { path: asStatePath('count'), operator: 'equals', value: 5 }
          ]
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.failed).toBe(1);
    expect(out.results[0]?.pass).toBe(false);
    expect(out.results[0]?.summary).toContain('all 1 assertion skipped');
  });

  it('still passes a deliberately-blocked scenario that authored expectedStatus:"blocked"', () => {
    // The silent-skip guard should NOT fire when the author opted into the
    // blocked outcome. Common pattern: "guard rule should refuse this input".
    const action: Action = {
      id: asActionId('c1'),
      name: 'Always blocked',
      intent: 'never lets the user proceed',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: -1 },
          effect: { id: asEffectId('eff1'), type: 'block_action', reason: 'always' }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'intentional block',
          stateOverrides: [],
          parameterOverrides: [],
          expectedStatus: 'blocked'
        }
      ]
    };
    const run = runScenariosUseCase();
    const out = run({ feature: makeFeature(action) });
    expect(out.passed).toBe(1);
    expect(out.results[0]?.pass).toBe(true);
  });
});

// ─── Multi-step scenarios ─────────────────────────────────────────────────

const makeMultiFeature = (actions: readonly Action[]): Feature => ({
  id: asFeatureId('e1'),
  name: 'Test',
  surfaces: [
    {
      id: asSurfaceId('s1'),
      name: 'Screen',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd1'),
          path: asStatePath('count'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [...actions],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z'
});

const incrAction = (id: string, scenarios?: Action['scenarios']): Action => ({
  id: asActionId(id),
  name: 'Increment',
  intent: 'Add one to count',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [
    {
      id: asEffectId(`${id}-eff`),
      type: 'set_state',
      path: asStatePath('count'),
      value: {
        kind: 'add',
        left: { kind: 'state', path: asStatePath('count') },
        right: { kind: 'literal', value: 1 }
      }
    }
  ],
  emittedEvents: [],
  transitions: [],
  ...(scenarios ? { scenarios } : {})
});

// Increment that always blocks (a guard rule that's always true). Used to
// prove a blocked setup step fails the flow, and that expectedStatus:"blocked"
// on a step is honoured.
const blockedIncrAction = (id: string): Action => ({
  ...incrAction(id),
  name: 'Blocked increment',
  intent: 'Always refuses',
  rules: [
    {
      id: asRuleId(`${id}-r`),
      category: 'business',
      condition: { left: asStatePath('count'), operator: 'greater_than', right: -1 },
      effect: { id: asEffectId(`${id}-block`), type: 'block_action', reason: 'always' }
    }
  ]
});

const doubleAction = (id: string, scenarios: Action['scenarios']): Action => ({
  id: asActionId(id),
  name: 'Double',
  intent: 'Double the count',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [
    {
      id: asEffectId(`${id}-eff`),
      type: 'set_state',
      path: asStatePath('count'),
      value: {
        kind: 'mul',
        left: { kind: 'state', path: asStatePath('count') },
        right: { kind: 'literal', value: 2 }
      }
    }
  ],
  emittedEvents: [],
  transitions: [],
  scenarios
});

describe('runScenariosUseCase — multi-step scenarios', () => {
  it('passes a multi-step scenario that replays preceding actions', () => {
    // count 0 → +1 → +1 → ×2 = 4. The two increments are real simulate()
    // calls threaded into the subject (double).
    const scenario: Scenario = {
      id: asScenarioId('sc1'),
      name: 'two increments then double',
      description: 'count 0 incremented twice then doubled equals 4',
      stateOverrides: [{ path: asStatePath('count'), value: 0 }],
      parameterOverrides: [],
      expectedStatus: 'success',
      steps: [
        { actionId: asActionId('c1'), parameterOverrides: [] },
        { actionId: asActionId('c1'), parameterOverrides: [] }
      ],
      expectedAssertions: [{ path: asStatePath('count'), operator: 'equals', value: 4 }]
    };
    const feature = makeMultiFeature([incrAction('c1'), doubleAction('c2', [scenario])]);
    const out = runScenariosUseCase()({ feature });
    expect(out.total).toBe(1);
    expect(out.passed).toBe(1);
    const r = out.results[0];
    expect(r?.steps).toHaveLength(2);
    expect(r?.steps.every((s) => s.pass)).toBe(true);
    expect(r?.assertions[0]?.held).toBe(true);
    expect(r?.summary).toContain('2 steps ok');
  });

  it('fails the whole scenario when a setup step blocks unexpectedly', () => {
    const scenario: Scenario = {
      id: asScenarioId('sc1'),
      name: 'blocked setup step',
      description: 'the first step is refused, so the flow never reaches the subject',
      stateOverrides: [{ path: asStatePath('count'), value: 0 }],
      parameterOverrides: [],
      expectedStatus: 'success',
      steps: [{ actionId: asActionId('c1'), parameterOverrides: [] }],
      expectedAssertions: [
        { path: asStatePath('count'), operator: 'equals', value: 2, description: 'never reached' }
      ]
    };
    const feature = makeMultiFeature([blockedIncrAction('c1'), doubleAction('c2', [scenario])]);
    const out = runScenariosUseCase()({ feature });
    expect(out.failed).toBe(1);
    const r = out.results[0];
    expect(r?.pass).toBe(false);
    expect(r?.steps[0]?.pass).toBe(false);
    expect(r?.steps[0]?.actualStatus).toBe('blocked');
    expect(r?.summary).toContain('step 0');
  });

  it('checks per-step assertions against the threaded snapshot', () => {
    const scenario: Scenario = {
      id: asScenarioId('sc1'),
      name: 'step asserts the intermediate state',
      description: 'after the first increment count is 1, then double makes it 2',
      stateOverrides: [{ path: asStatePath('count'), value: 0 }],
      parameterOverrides: [],
      expectedStatus: 'success',
      steps: [
        {
          actionId: asActionId('c1'),
          parameterOverrides: [],
          expectedStatus: 'success',
          expectedAssertions: [
            {
              path: asStatePath('count'),
              operator: 'equals',
              value: 1,
              description: 'count is 1 after the first increment'
            }
          ]
        }
      ],
      expectedAssertions: [{ path: asStatePath('count'), operator: 'equals', value: 2 }]
    };
    const feature = makeMultiFeature([incrAction('c1'), doubleAction('c2', [scenario])]);
    const out = runScenariosUseCase()({ feature });
    expect(out.passed).toBe(1);
    const r = out.results[0];
    expect(r?.steps[0]?.assertions[0]?.held).toBe(true);
  });

  it('passes a step that is expected to block', () => {
    const scenario: Scenario = {
      id: asScenarioId('sc1'),
      name: 'guard step is expected to refuse',
      description: 'the setup step is meant to block; count stays 0 so double keeps it 0',
      stateOverrides: [{ path: asStatePath('count'), value: 0 }],
      parameterOverrides: [],
      expectedStatus: 'success',
      steps: [{ actionId: asActionId('c1'), parameterOverrides: [], expectedStatus: 'blocked' }],
      expectedAssertions: [{ path: asStatePath('count'), operator: 'equals', value: 0 }]
    };
    const feature = makeMultiFeature([blockedIncrAction('c1'), doubleAction('c2', [scenario])]);
    const out = runScenariosUseCase()({ feature });
    expect(out.passed).toBe(1);
    const r = out.results[0];
    expect(r?.steps[0]?.pass).toBe(true);
    expect(r?.steps[0]?.statusMatches).toBe(true);
  });
});
