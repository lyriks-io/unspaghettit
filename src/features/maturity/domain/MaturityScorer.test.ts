import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asEventDefinitionId,
  asFeatureId,
  asParameterId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import {
  scoreCapability,
  scoreFeature,
  scoreFeatureBreakdown,
  scoreSurface,
  scoreSurfaceBreakdown
} from './MaturityScorer';

const baseCapability: Action = {
  id: asActionId('c'),
  name: 'Do thing',
  intent: '',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
};

const dummySurface: Surface = {
  id: asSurfaceId('s'),
  name: 'Surf',
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
};

describe('MaturityScorer', () => {
  it('flags missing intent and missing effects as critical', () => {
    const report = scoreCapability(dummySurface, baseCapability);
    const critical = report.criticalIssues.map((i) => i.area);
    expect(critical).toContain('intent');
    expect(critical).toContain('effects');
  });

  it('does not flag effects when at least a rule exists', () => {
    const cap: Action = {
      ...baseCapability,
      intent: 'do',
      rules: [
        {
          id: 'r' as never,
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'exists' },
          effect: { id: asEffectId('e'), type: 'allow_action' }
        }
      ]
    };
    const report = scoreCapability(dummySurface, cap);
    const critical = report.criticalIssues.map((i) => i.area);
    expect(critical).not.toContain('effects');
  });

  it('skips the validation check when all parameters are booleans or enums', () => {
    const cap: Action = {
      ...baseCapability,
      intent: 'do',
      parameters: [
        { id: asParameterId('p1'), name: 'flag', type: 'boolean', required: false },
        {
          id: asParameterId('p2'),
          name: 'mode',
          type: 'enum',
          enumValues: ['a', 'b'],
          required: true
        }
      ]
    };
    const report = scoreCapability(dummySurface, cap);
    const recommended = report.recommendedIssues.map((i) => i.area);
    expect(recommended).not.toContain('validation');
  });

  it('credits parameter validations toward the validation check', () => {
    const cap: Action = {
      ...baseCapability,
      intent: 'do',
      parameters: [
        {
          id: asParameterId('p'),
          name: 'email',
          type: 'string',
          required: true,
          validations: [{ type: 'email' }]
        }
      ]
    };
    const report = scoreCapability(dummySurface, cap);
    const recommended = report.recommendedIssues.map((i) => i.area);
    expect(recommended).not.toContain('validation');
  });

  it('flags mutating actions without permission rules', () => {
    const cap: Action = {
      ...baseCapability,
      intent: 'do',
      effects: [
        {
          id: asEffectId('e'),
          type: 'set_state',
          path: asStatePath('x.y'),
          value: 1
        }
      ]
    };
    const report = scoreCapability(dummySurface, cap);
    const critical = report.criticalIssues.map((i) => i.area);
    expect(critical).toContain('permissions');
  });

  it('scoreSurfaceBreakdown exposes action-first rollup', () => {
    const surface: Surface = {
      ...dummySurface,
      stateDefinitions: [],
      actions: [{ ...baseCapability, intent: 'do' }]
    };
    const breakdown = scoreSurfaceBreakdown(surface);
    expect(breakdown.perAction).toHaveLength(1);
    expect(breakdown.surfaceLevel.maxScore).toBeGreaterThan(0);
    // Aggregate combines surface-level + every action:
    expect(breakdown.aggregate.maxScore).toBe(
      breakdown.surfaceLevel.maxScore + breakdown.perAction[0]!.report.maxScore
    );
  });

  it('scoreFeatureBreakdown carries the per-action data', () => {
    const surface: Surface = {
      ...dummySurface,
      actions: [{ ...baseCapability, intent: 'do' }]
    };
    const feature: Feature = {
      id: asFeatureId('e'),
      name: 'Exp',
      surfaces: [surface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };
    const breakdown = scoreFeatureBreakdown(feature);
    expect(breakdown.perSurface[0]?.perAction).toHaveLength(1);
    expect(breakdown.perSurface[0]?.surfaceLevel.maxScore).toBeGreaterThan(0);
  });

  it('an empty feature scores 0% — not 50% from the vacuous "has a name" pass', () => {
    const feature: Feature = {
      id: asFeatureId('blank'),
      name: 'Blank',
      surfaces: [],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z'
    };
    const report = scoreFeature(feature);
    // Empty features are pinned to 0% — the user has built nothing, the
    // score should reflect that. The "surfaces" critical issue is the
    // single actionable signal (add a surface to start scoring).
    expect(report.percentage).toBe(0);
    expect(report.score).toBe(0);
    expect(report.maxScore).toBe(2);
    const criticalAreas = report.criticalIssues.map((i) => i.area);
    expect(criticalAreas).toEqual(['surfaces']);
    expect(report.recommendedIssues).toEqual([]);
    // No "passed checks" noise either — a vacuous "has a name" pass on
    // an unbuilt feature would make the report look richer than it is.
    expect(report.passedChecks).toEqual([]);
  });

  it('aggregates scores up to the feature', () => {
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'Surf',
      type: 'screen',
      stateDefinitions: [],
      actions: [baseCapability],
      rules: [],
      invariants: [],
      transitions: []
    };
    const feature: Feature = {
      id: asFeatureId('e'),
      name: 'Exp',
      surfaces: [surface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z'
    };
    const report = scoreFeature(feature);
    expect(report.maxScore).toBeGreaterThan(0);
    expect(report.percentage).toBeLessThan(100);
  });

  it('flags malformed newer options when they are used', () => {
    const surface: Surface = {
      ...dummySurface,
      stateDefinitions: [
        {
          id: asStateDefinitionId('state'),
          path: asStatePath('order.status'),
          type: 'enum',
          defaultValue: 'draft'
        }
      ],
      actions: [
        {
          ...baseCapability,
          intent: 'place order',
          effects: [
            {
              id: asEffectId('event-effect'),
              type: 'emit_event',
              event: asEventName('order.placed')
            },
            {
              id: asEffectId('transition-effect'),
              type: 'transition_surface',
              target: asSurfaceId('target')
            }
          ]
        }
      ]
    };
    const feature: Feature = {
      id: asFeatureId('exp'),
      name: 'Shop',
      surfaces: [surface],
      personas: [],
      resources: [],
      entities: [],
      events: [
        {
          id: asEventDefinitionId('evt'),
          name: asEventName('order.cancelled')
        }
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };

    const report = scoreFeature(feature);
    const areas = report.recommendedIssues.map((issue) => issue.area);
    expect(areas).toContain('state metadata');
    expect(areas).toContain('event declarations');
    expect(areas).toContain('events registry');
    expect(areas).toContain('transitions');
  });

  it('does not crash on malformed Expression children (raw scalar where Expression node expected)', () => {
    // Reproduces a crash observed in a BrewQ audit run: an invariant condition
    // shaped as `discount < add(state(subtotal), 1)` where the `1` is a raw
    // number rather than `{kind:"literal",value:1}`. The TS type forbids this,
    // but JSON authoring slipped it past the boundary and the scorer's
    // recursive walker fell through the switch and returned undefined, then
    // spread-undefined threw "is not a function or its return value is not
    // iterable". Defensive guards in expressionStateReads must short-circuit
    // non-Expression inputs as zero-state-read leaves.
    const malformedInvariant = {
      id: 'inv' as never,
      name: 'Discount within bounds',
      condition: {
        left: asStatePath('cart.discount'),
        operator: 'lower_than' as const,
        right: {
          kind: 'add' as const,
          left: { kind: 'state' as const, path: asStatePath('cart.subtotal') },
          right: 1 // â† malformed: should be {kind:"literal",value:1}
        }
      },
      message: 'Discount cannot exceed subtotal.'
    };
    const surface: Surface = {
      ...dummySurface,
      actions: [
        {
          ...baseCapability,
          intent: 'apply discount',
          invariants: [malformedInvariant as never]
        }
      ]
    };
    const feature: Feature = {
      id: asFeatureId('exp'),
      name: 'Crash repro',
      surfaces: [surface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };
    // Must NOT throw.
    expect(() => scoreFeature(feature)).not.toThrow();
  });

  it('credits the richer modeling options when they are complete', () => {
    const action: Action = {
      ...baseCapability,
      intent: 'increment',
      requiredStates: [asStatePath('counter.value')],
      parameters: [
        {
          id: asParameterId('amount'),
          name: 'amount',
          type: 'number',
          required: false,
          defaultValue: 1,
          validations: [{ type: 'positive' }]
        }
      ],
      effects: [
        {
          id: asEffectId('set'),
          type: 'set_state',
          path: asStatePath('counter.value'),
          value: {
            kind: 'add',
            left: { kind: 'state', path: asStatePath('counter.value') },
            right: { kind: 'param', name: 'amount' }
          }
        },
        {
          id: asEffectId('emit'),
          type: 'emit_event',
          event: asEventName('counter.incremented')
        }
      ],
      emittedEvents: [asEventName('counter.incremented')],
      rules: [
        {
          id: 'rule' as never,
          category: 'permissions',
          condition: { left: asStatePath('user.canEdit'), operator: 'equals', right: true },
          effect: { id: asEffectId('block'), type: 'block_action', reason: 'No access' }
        }
      ],
      scenarios: [
        {
          id: 'scenario' as never,
          name: 'increments',
          stateOverrides: [],
          parameterOverrides: [],
          expectedStatus: 'success'
        }
      ]
    };
    const surface: Surface = {
      ...dummySurface,
      stateDefinitions: [
        {
          id: asStateDefinitionId('counter'),
          path: asStatePath('counter.value'),
          type: 'number',
          defaultValue: 0,
          description: 'Current counter value'
        },
        {
          id: asStateDefinitionId('can-edit'),
          path: asStatePath('user.canEdit'),
          type: 'boolean',
          defaultValue: true,
          description: 'Whether the user can edit'
        }
      ],
      actions: [action],
      invariants: [
        {
          id: 'inv' as never,
          name: 'non-negative',
          condition: {
            left: asStatePath('counter.value'),
            operator: 'greater_than',
            right: -1
          },
          message: 'Counter cannot be negative'
        }
      ]
    };

    const report = scoreSurface(surface);
    expect(report.recommendedIssues.map((issue) => issue.area)).not.toContain('parameters');
    expect(report.recommendedIssues.map((issue) => issue.area)).not.toContain('required states');
    expect(report.recommendedIssues.map((issue) => issue.area)).not.toContain('event declarations');
    expect(report.passedChecks.map((check) => check.area)).toContain('expressions');
  });
});
