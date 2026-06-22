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
