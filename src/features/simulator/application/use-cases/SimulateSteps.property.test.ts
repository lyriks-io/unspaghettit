import { describe, expect, it } from 'vitest';
import { forAll, type Rng } from '$shared/__tests__/property';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import { checkInvariants } from '$features/behavior-model/domain/services/InvariantChecker';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import { buildInitialSnapshot } from '$features/behavior-model/domain/services/StateSnapshot';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import type { Expression } from '$features/behavior-model/domain/value-objects/Expression';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { RuleCondition } from '$features/behavior-model/domain/value-objects/RuleCondition';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import { simulateSteps, type WalkInput, type WalkResult } from './SimulateSteps';

/**
 * The step-by-step walk on random small features (two counters and a flag,
 * a few guarded actions, sometimes an invariant) and random walks through
 * them. Whatever the feature, a walk is deterministic, a refused step leaves
 * the state as it was, every state a walk reaches keeps the invariants, and
 * the changes it reports chain from one step to the next.
 */

const PATHS = ['c.x', 'c.y'] as const;

const genValue = (rng: Rng): Expression => {
  const path = rng.pick(PATHS);
  const roll = rng.next();
  if (roll < 0.4) return { kind: 'add', left: { kind: 'state', path: asStatePath(path) }, right: { kind: 'literal', value: rng.int(-2, 2) } };
  if (roll < 0.7) return { kind: 'literal', value: rng.int(-2, 4) };
  return { kind: rng.pick(['min', 'max', 'sub'] as const), left: { kind: 'state', path: asStatePath('c.x') }, right: { kind: 'state', path: asStatePath('c.y') } };
};

const genCondition = (rng: Rng): RuleCondition =>
  rng.chance(0.2)
    ? { left: asStatePath('c.on'), operator: rng.pick(['is_true', 'is_false'] as const) }
    : {
        left: asStatePath(rng.pick(PATHS)),
        operator: rng.pick(['greater_than', 'lower_than', 'equals', 'greater_or_equal'] as const),
        right: rng.chance(0.7) ? rng.int(-1, 3) : { kind: 'state', path: asStatePath(rng.pick(PATHS)) }
      };

const genAction = (rng: Rng, index: number): Action => {
  const effects: Effect[] = Array.from({ length: rng.int(1, 2) }, (_, i) => ({
    id: asEffectId(`e${index}-${i}`),
    type: 'set_state' as const,
    path: asStatePath(rng.pick(PATHS)),
    value: genValue(rng)
  }));
  if (rng.chance(0.3)) {
    effects.push({ id: asEffectId(`e${index}-flag`), type: 'set_state', path: asStatePath('c.on'), value: { kind: 'not', operand: { kind: 'state', path: asStatePath('c.on') } } });
  }
  return {
    id: asActionId(`a${index}`),
    name: `Action ${index}`,
    intent: 'x',
    parameters: [],
    requiredStates: [],
    rules: Array.from({ length: rng.int(0, 2) }, (_, i) => ({
      id: asRuleId(`r${index}-${i}`),
      category: 'validation' as const,
      condition: genCondition(rng),
      effect: { id: asEffectId(`b${index}-${i}`), type: 'block_action' as const, reason: `Refused by rule ${i} of action ${index}.` }
    })),
    invariants: [],
    effects,
    emittedEvents: [],
    transitions: []
  };
};

const genFeature = (rng: Rng): Feature => {
  const invariants: Invariant[] = rng.chance(0.6)
    ? [
        {
          id: asInvariantId('inv'),
          name: 'Bounded',
          condition: { left: asStatePath(rng.pick(PATHS)), operator: rng.pick(['lower_or_equal', 'greater_or_equal'] as const), right: rng.int(-1, 4) },
          message: 'Out of bounds.'
        }
      ]
    : [];
  // A start that keeps the invariant, as an authored feature's does.
  const start = (path: string, value: number): number => {
    const leaf = invariants[0]?.condition as { left: string; operator: string; right: number } | undefined;
    if (!leaf || leaf.left !== path) return value;
    return leaf.operator === 'lower_or_equal' ? Math.min(value, leaf.right) : Math.max(value, leaf.right);
  };
  return {
    id: asFeatureId('random'),
    name: 'Random',
    surfaces: [
      {
        id: asSurfaceId('s'),
        name: 'Screen',
        type: 'screen',
        stateDefinitions: [
          { id: asStateDefinitionId('dx'), path: asStatePath('c.x'), type: 'number', defaultValue: start('c.x', rng.int(0, 3)) },
          { id: asStateDefinitionId('dy'), path: asStatePath('c.y'), type: 'number', defaultValue: start('c.y', rng.int(0, 3)) },
          { id: asStateDefinitionId('don'), path: asStatePath('c.on'), type: 'boolean', defaultValue: rng.chance(0.5) }
        ],
        actions: Array.from({ length: rng.int(2, 4) }, (_, i) => genAction(rng, i)),
        rules: [],
        invariants: [],
        transitions: []
      }
    ],
    personas: [],
    resources: [],
    entities: [],
    featureInvariants: invariants,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  };
};

// The walk starts from the declared defaults, given whole: a walk whose
// steps are all refused answers the snapshot it was given as its final state.
const genWalk = (rng: Rng, size: number): WalkInput => {
  const feature = genFeature(rng);
  const actions = feature.surfaces[0]!.actions;
  return {
    feature,
    snapshot: buildInitialSnapshot(feature.surfaces[0]!.stateDefinitions),
    steps: Array.from({ length: rng.int(1, size + 1) }, () => ({ actionId: String(rng.pick(actions).id) }))
  };
};

const RUNS = { runs: 250, maxSize: 6 };
const read = (state: unknown, path: string): StateValue | undefined =>
  path.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], state) as StateValue | undefined;

describe('simulateSteps on random features', () => {
  it('walks the same way twice', () => {
    forAll({ seed: 7, ...RUNS }, genWalk, (input) => {
      expect(simulateSteps(input)).toEqual(simulateSteps(input));
    });
  });

  it('ends where the walk of its accepted steps alone ends: a refused step changes nothing', () => {
    forAll({ seed: 8, ...RUNS }, genWalk, (input) => {
      const walk = simulateSteps(input);
      const accepted = input.steps.filter((_, i) => walk.steps[i]!.status === 'success');
      const alone: WalkResult = simulateSteps({ ...input, steps: accepted });
      expect(alone.finalState).toEqual(walk.finalState);
      expect(alone.steps.every((s) => s.status === 'success')).toBe(true);
      for (const step of walk.steps) if (step.status === 'blocked') expect(step.changes).toEqual([]);
    });
  });

  it('refuses a step exactly when one of its rules holds before it (naming its reason) or when it would break an invariant', () => {
    forAll({ seed: 11, ...RUNS }, genWalk, (input) => {
      const walk = simulateSteps(input);
      const actions = input.feature.surfaces[0]!.actions;
      walk.steps.forEach((step, k) => {
        const before = simulateSteps({ ...input, steps: input.steps.slice(0, k) }).finalState;
        const action = actions.find((a) => String(a.id) === step.actionId)!;
        const holding = action.rules.filter((rule) => evaluateCondition(rule.condition, before));
        const reasons = holding.map((rule) => (rule.effect as { reason: string }).reason);
        if (holding.length > 0) {
          expect(step.status).toBe('blocked');
          expect(step.refusedBecause).toEqual(reasons);
        } else if (step.status === 'blocked') {
          expect(step.refusedBecause).toEqual(['Bounded: Out of bounds.']);
        }
      });
    });
  });

  it('keeps the feature invariants in every state a walk reaches', () => {
    forAll({ seed: 9, ...RUNS }, genWalk, (input) => {
      for (let k = 1; k <= input.steps.length; k += 1) {
        const reached = simulateSteps({ ...input, steps: input.steps.slice(0, k) }).finalState;
        expect(checkInvariants(input.feature.featureInvariants ?? [], reached)).toEqual([]);
      }
    });
  });

  it('reports changes that chain: each one starts where the last change of that path ended', () => {
    forAll({ seed: 10, ...RUNS }, genWalk, (input) => {
      const walk = simulateSteps(input);
      const defaults = new Map(input.feature.surfaces[0]!.stateDefinitions.map((d) => [String(d.path), d.defaultValue]));
      const current = new Map(defaults);
      for (const step of walk.steps) {
        for (const change of step.changes) {
          expect(change.before).toEqual(current.get(change.path));
          expect(change.after).not.toEqual(change.before);
          current.set(change.path, change.after as StateValue);
        }
      }
      for (const [path, value] of current) expect(read(walk.finalState, path)).toEqual(value);
    });
  });
});
