import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asReachabilityGoalId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { exploreStateSpace } from './StateExplorer';

const featureWith = (surface: Surface): Feature => ({
  id: asFeatureId('f'),
  name: 'Explore Demo',
  surfaces: [surface],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

const countSurface = (actions: readonly Action[], invariants: Surface['invariants']): Surface => ({
  id: asSurfaceId('s'),
  name: 'Counter',
  type: 'screen',
  stateDefinitions: [
    {
      id: asStateDefinitionId('d-count'),
      path: asStatePath('count'),
      type: 'number',
      defaultValue: 0
    }
  ],
  actions,
  rules: [],
  invariants,
  transitions: []
});

const incr: Action = {
  id: asActionId('incr'),
  name: 'incr',
  intent: 'increment the counter',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [
    {
      id: asEffectId('e-incr'),
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
  transitions: []
};

describe('exploreStateSpace', () => {
  it('finds an invariant counterexample with the shortest action path', () => {
    // Invariant: count < 3. incr from 0 → 1 → 2, then incr at 2 makes 3, which
    // violates. The explorer should surface that with path [incr, incr, incr].
    const feature = featureWith(
      countSurface(
        [incr],
        [
          {
            id: asInvariantId('cap'),
            name: 'count < 3',
            condition: { left: asStatePath('count'), operator: 'lower_than', right: 3 },
            message: 'count exceeded 3'
          }
        ]
      )
    );
    const report = exploreStateSpace(feature, { maxDepth: 8 });
    expect(report.invariantViolations).toHaveLength(1);
    const v = report.invariantViolations[0]!;
    expect(v.invariantName).toBe('count < 3');
    expect(v.actionName).toBe('incr');
    expect(v.path).toEqual(['incr', 'incr', 'incr']);
    // count=2 is a dead-end: its only move violates the invariant.
    expect(report.deadlockStates).toBe(1);
    expect(report.truncated).toBe(false);
  });

  it('reports an action that can never fire as dead', () => {
    const blocked: Action = {
      id: asActionId('locked'),
      name: 'locked',
      intent: 'an action that is always blocked',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('always-block'),
          category: 'business',
          // unconditional rule → always blocks
          effect: { id: asEffectId('e-blk'), type: 'block_action', reason: 'never allowed' }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: []
    };
    const feature = featureWith(countSurface([incr, blocked], []));
    const report = exploreStateSpace(feature, { maxDepth: 3 });
    expect(report.deadActions.map((a) => a.actionName)).toContain('locked');
    expect(report.deadActions.map((a) => a.actionName)).not.toContain('incr');
  });

  it('skips (does not run) an action whose required parameter has no default', () => {
    const needsParam: Action = {
      id: asActionId('needs-param'),
      name: 'needs-param',
      intent: 'requires an un-defaulted parameter',
      parameters: [
        {
          id: asParameterId('p'),
          name: 'amount',
          type: 'number',
          required: true,
          description: 'no default provided'
        }
      ],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: []
    };
    const feature = featureWith(countSurface([incr, needsParam], []));
    const report = exploreStateSpace(feature, { maxDepth: 3 });
    expect(report.skippedActions.map((a) => a.actionName)).toEqual(['needs-param']);
    // It must NOT show up as dead — it was never explored, not proven unreachable.
    expect(report.deadActions.map((a) => a.actionName)).not.toContain('needs-param');
  });

  it('marks the report truncated when the state cap is hit', () => {
    // No invariant ceiling → incr grows count without bound; the state cap stops it.
    const feature = featureWith(countSurface([incr], []));
    const report = exploreStateSpace(feature, { maxDepth: 1000, maxStates: 5 });
    expect(report.truncated).toBe(true);
    expect(report.statesExplored).toBeLessThanOrEqual(5);
  });

  it('has no goalResults when no goals are declared', () => {
    const feature = featureWith(countSurface([incr], []));
    expect(exploreStateSpace(feature, { maxDepth: 3 }).goalResults).toEqual([]);
  });

  it('explores an action across a required enum parameter domain instead of skipping it', () => {
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'Chooser',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('d-chosen'),
          path: asStatePath('chosen'),
          type: 'enum',
          enumValues: ['none', 'a', 'b'],
          defaultValue: 'none'
        }
      ],
      rules: [],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId('choose'),
          name: 'choose',
          intent: 'pick a mode',
          parameters: [
            {
              id: asParameterId('mode'),
              name: 'mode',
              type: 'enum',
              required: true,
              enumValues: ['a', 'b'],
              bindToStatePath: asStatePath('chosen')
            }
          ],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ]
    };
    const report = exploreStateSpace(featureWith(surface), { maxDepth: 3 });
    // Not skipped (enum is enumerable) and not dead (it fired).
    expect(report.skippedActions).toEqual([]);
    expect(report.deadActions).toEqual([]);
    // Both enum branches reached: initial (none) + chosen=a + chosen=b.
    expect(report.statesExplored).toBeGreaterThanOrEqual(3);
  });
});

describe('exploreStateSpace: dead versus unreached actions', () => {
  const locked: Action = {
    id: asActionId('locked'),
    name: 'locked',
    intent: 'an action that is always blocked',
    parameters: [],
    requiredStates: [],
    rules: [
      {
        id: asRuleId('always-block'),
        category: 'business',
        effect: { id: asEffectId('e-blk'), type: 'block_action', reason: 'never allowed' }
      }
    ],
    invariants: [],
    effects: [],
    emittedEvents: [],
    transitions: []
  };

  it('calls nothing dead when the state cap cut the search, and says which bound hit', () => {
    // `locked` IS dead, but a search stopped at 5 states is in no position to say so.
    const feature = featureWith(countSurface([incr, locked], []));
    const report = exploreStateSpace(feature, { maxDepth: 1000, maxStates: 5 });

    expect(report.truncated).toBe(true);
    expect(report.deadActions).toEqual([]);
    expect(report.unreachedActions).toEqual([
      {
        surfaceId: 's',
        actionId: 'locked',
        actionName: 'locked',
        reason: 'exploration stopped at 5 states (depth 4 of 1000)'
      }
    ]);
  });

  it('keeps unreached empty when the search was not truncated', () => {
    const feature = featureWith(countSurface([incr, locked], []));
    const report = exploreStateSpace(feature, { maxDepth: 3 });

    expect(report.truncated).toBe(false);
    expect(report.deadActions.map((a) => a.actionName)).toEqual(['locked']);
    expect(report.unreachedActions).toEqual([]);
    expect(report.sampledActions).toEqual([]);
  });

  // The field case. `Save draft` takes seven required parameters (864
  // combinations) and writes each to state; `Review` and `Publish` are guarded
  // by what it writes. The old prefix sample pinned `company` to -1, the blocked
  // side of its own rule, so all three read as dead.
  const kinds = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];
  const flags = ['f0', 'f1', 'f2', 'f3', 'f4'];
  const written = ['company', ...flags, 'kind'];

  const follow = (id: string, guard: Action['rules'][number]['condition'], marks: string): Action => ({
    id: asActionId(id),
    name: id,
    intent: `${id} the saved draft`,
    parameters: [],
    requiredStates: [],
    rules: [
      {
        id: asRuleId(`${id}-guard`),
        category: 'business',
        condition: guard,
        effect: { id: asEffectId(`${id}-blk`), type: 'block_action', reason: 'nothing saved yet' }
      }
    ],
    invariants: [],
    effects: [
      { id: asEffectId(`${id}-mark`), type: 'set_state', path: asStatePath(marks), value: true }
    ],
    emittedEvents: [],
    transitions: []
  });

  const draftSurface = (saveRules: Action['rules']): Surface => ({
    id: asSurfaceId('s'),
    name: 'Draft',
    type: 'screen',
    stateDefinitions: [
      { id: asStateDefinitionId('d-company'), path: asStatePath('draft.company'), type: 'number', defaultValue: -1 },
      ...flags.map((flag) => ({
        id: asStateDefinitionId(`d-${flag}`),
        path: asStatePath(`draft.${flag}`),
        type: 'boolean' as const,
        defaultValue: false
      })),
      {
        id: asStateDefinitionId('d-kind'),
        path: asStatePath('draft.kind'),
        type: 'enum',
        enumValues: ['none', ...kinds],
        defaultValue: 'none'
      },
      { id: asStateDefinitionId('d-reviewed'), path: asStatePath('draft.reviewed'), type: 'boolean', defaultValue: false },
      { id: asStateDefinitionId('d-published'), path: asStatePath('draft.published'), type: 'boolean', defaultValue: false }
    ],
    rules: [],
    invariants: [],
    transitions: [],
    actions: [
      {
        id: asActionId('save'),
        name: 'save',
        intent: 'save the draft from the form',
        parameters: [
          { id: asParameterId('company'), name: 'company', type: 'number', required: true },
          ...flags.map((flag) => ({
            id: asParameterId(flag),
            name: flag,
            type: 'boolean' as const,
            required: true
          })),
          { id: asParameterId('kind'), name: 'kind', type: 'enum', required: true, enumValues: kinds }
        ],
        requiredStates: [],
        rules: saveRules,
        invariants: [],
        effects: written.map((name) => ({
          id: asEffectId(`e-${name}`),
          type: 'set_state' as const,
          path: asStatePath(`draft.${name}`),
          value: { kind: 'param' as const, name }
        })),
        emittedEvents: [],
        transitions: []
      },
      follow('review', { left: asStatePath('draft.company'), operator: 'lower_than', right: 0 }, 'draft.reviewed'),
      follow('publish', { left: asStatePath('draft.kind'), operator: 'equals', right: 'none' }, 'draft.published')
    ]
  });

  const companyFloor: Action['rules'][number] = {
    id: asRuleId('company-floor'),
    category: 'business',
    condition: { left: { kind: 'param', name: 'company' }, operator: 'lower_than', right: 0 },
    effect: { id: asEffectId('e-floor'), type: 'block_action', reason: 'company must not be negative' }
  };

  it('fires a wide action and the actions that depend on what it writes', () => {
    const report = exploreStateSpace(featureWith(draftSurface([companyFloor])));

    expect(report.deadActions).toEqual([]);
    expect(report.unreachedActions).toEqual([]);
    // Honest about the sample: the run is bounded, and says by how much.
    expect(report.truncated).toBe(true);
    expect(report.sampledActions).toEqual([
      { surfaceId: 's', actionId: 'save', actionName: 'save', fullGridSize: 864, sampled: 16 }
    ]);
  });

  it('tells a sampled action that never fired how little of its grid was tried', () => {
    const alwaysBlocked: Action['rules'][number] = {
      id: asRuleId('never'),
      category: 'business',
      effect: { id: asEffectId('e-never'), type: 'block_action', reason: 'never allowed' }
    };
    const report = exploreStateSpace(featureWith(draftSurface([companyFloor, alwaysBlocked])));

    expect(report.deadActions).toEqual([]);
    const reasons = new Map(report.unreachedActions.map((a) => [a.actionName, a.reason]));
    expect(reasons.get('save')).toBe('only 16 of its 864 parameter combinations were tried');
    expect(reasons.get('review')).toBe('another action ran on a sampled parameter grid');
    expect(reasons.get('publish')).toBe('another action ran on a sampled parameter grid');
  });
});

describe('exploreStateSpace — reachability goals', () => {
  const withGoals = (goals: NonNullable<Feature['reachabilityGoals']>): Feature => ({
    ...featureWith(countSurface([incr], [])),
    reachabilityGoals: goals
  });

  it("satisfies a 'reachable' goal that some state meets", () => {
    // incr: 0 → 1 → 2 … so count > 1 is reachable.
    const report = exploreStateSpace(
      withGoals([
        {
          id: asReachabilityGoalId('g-reach'),
          name: 'count reaches 2',
          kind: 'reachable',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: 1 },
          description: 'the counter can climb past one'
        }
      ]),
      { maxDepth: 4 }
    );
    expect(report.goalResults).toHaveLength(1);
    expect(report.goalResults[0]!.satisfied).toBe(true);
  });

  it("fails a 'reachable' goal no state meets within bounds", () => {
    const report = exploreStateSpace(
      withGoals([
        {
          id: asReachabilityGoalId('g-far'),
          name: 'count reaches 100',
          kind: 'reachable',
          condition: { left: asStatePath('count'), operator: 'greater_than', right: 100 },
          description: 'unreachable within the depth bound'
        }
      ]),
      { maxDepth: 4 }
    );
    expect(report.goalResults[0]!.satisfied).toBe(false);
    expect(report.goalResults[0]!.counterexamplePath).toBeUndefined();
  });

  it("detects a trap for an 'always_reachable' goal with a counterexample path", () => {
    // Goal: count == 0. The only action increments, so once incr fires the
    // model can never return to 0 — every count>0 state is a trap.
    const report = exploreStateSpace(
      withGoals([
        {
          id: asReachabilityGoalId('g-zero'),
          name: 'count can always return to 0',
          kind: 'always_reachable',
          condition: { left: asStatePath('count'), operator: 'equals', right: 0 },
          description: 'zero stays reachable from anywhere'
        }
      ]),
      { maxDepth: 4 }
    );
    expect(report.goalResults[0]!.satisfied).toBe(false);
    // Shortest path to a trap is a single incr (count 0 → 1).
    expect(report.goalResults[0]!.counterexamplePath).toEqual(['incr']);
  });
});
