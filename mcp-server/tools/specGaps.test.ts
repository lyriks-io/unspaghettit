import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { detectSpecGaps } from './specGaps';

const action = (over: Partial<Action> & Pick<Action, 'id' | 'name'>): Action => ({
  intent: 'does a thing',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [{ id: asEffectId('eff'), type: 'allow_action' }],
  emittedEvents: [],
  transitions: [],
  ...over
});

const feature = (actions: readonly Action[], over: Partial<Feature> = {}): Feature => {
  const surface: Surface = {
    id: asSurfaceId('surf'),
    name: 'Main',
    type: 'screen',
    description: 'main',
    stateDefinitions: [
      {
        id: asStateDefinitionId('sd'),
        path: asStatePath('a.b'),
        type: 'boolean',
        defaultValue: false,
        description: 'flag'
      }
    ],
    actions,
    rules: [],
    invariants: [],
    transitions: []
  };
  return {
    id: asFeatureId('feat'),
    name: 'Feat',
    description: 'a feature',
    surfaces: [surface],
    personas: [],
    resources: [],
    entities: [],
    events: [],
    ...over
  } as Feature;
};

describe('detectSpecGaps — Evolution proposals', () => {
  it('does not flag an Evolution proposal for missing effects or implementation', () => {
    const proposal = action({
      id: asActionId('evo'),
      name: 'Sign in with SSO',
      effects: [], // intentionally empty — would normally be a critical gap
      evolution: { rationale: 'Competitors offer it' }
    });
    const gaps = detectSpecGaps(feature([proposal]), new Set());
    expect(gaps.filter((g) => g.entityId === 'evo')).toEqual([]);
  });

  it('still flags committed actions normally', () => {
    const committed = action({ id: asActionId('real'), name: 'Save', effects: [] });
    const gaps = detectSpecGaps(feature([committed]), new Set());
    expect(gaps.some((g) => g.entityId === 'real' && g.reason.includes('no effects'))).toBe(true);
  });

  it('a proposal does not satisfy an expectedActions entry of the same name', () => {
    const proposal = action({
      id: asActionId('evo'),
      name: 'Export to CSV',
      evolution: { rationale: 'Users ask for it' }
    });
    const gaps = detectSpecGaps(
      feature([proposal], { expectedActions: ['Export to CSV'] }),
      new Set()
    );
    expect(
      gaps.some((g) => g.entityType === 'feature' && g.reason.includes('Export to CSV'))
    ).toBe(true);
  });
});

describe('detectSpecGaps — effect detection', () => {
  it('does not flag "no effects" when the effect lives inside a rule', () => {
    const tick = action({
      id: asActionId('tick'),
      name: 'Resolve Tick',
      effects: [], // the whole behavior is rule-carried
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: {
            id: asEffectId('e1'),
            type: 'set_state',
            path: asStatePath('a.b'),
            value: false
          }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([tick]), new Set([String(tick.id)]));
    expect(gaps.some((g) => g.entityId === 'tick' && g.reason.includes('no effects'))).toBe(false);
  });

  it('still flags an action with no effects anywhere (no direct, no rule, no onBlocked)', () => {
    const empty = action({ id: asActionId('empty'), name: 'Does Nothing', effects: [], rules: [] });
    const gaps = detectSpecGaps(feature([empty]), new Set([String(empty.id)]));
    expect(gaps.some((g) => g.entityId === 'empty' && g.reason.includes('no effects'))).toBe(true);
  });
});

describe('detectSpecGaps — emittedEvents consistency', () => {
  it('flags an emittedEvents declaration that no emit_event effect fires', () => {
    const declarer = action({
      id: asActionId('emit'),
      name: 'Step Epoch',
      emittedEvents: ['epoch.stepped'] as unknown as Action['emittedEvents'],
      effects: [{ id: asEffectId('e1'), type: 'allow_action' }] // no emit_event for it
    });
    const gaps = detectSpecGaps(feature([declarer]), new Set([String(declarer.id)]));
    expect(
      gaps.some((g) => g.entityId === 'emit' && g.reason.includes('epoch.stepped') && g.reason.includes('inert'))
    ).toBe(true);
  });

  it('does not flag a declared event that an emit_event effect actually fires', () => {
    const emitter = action({
      id: asActionId('emit'),
      name: 'Step Epoch',
      emittedEvents: ['epoch.stepped'] as unknown as Action['emittedEvents'],
      effects: [
        { id: asEffectId('e1'), type: 'emit_event', event: 'epoch.stepped' }
      ] as unknown as Action['effects']
    });
    const gaps = detectSpecGaps(feature([emitter]), new Set([String(emitter.id)]));
    expect(gaps.some((g) => g.entityId === 'emit' && g.reason.includes('inert'))).toBe(false);
  });
});

describe('detectSpecGaps — external dependencies', () => {
  it('flags an external operation with no timeout and no failure modes', () => {
    const withDep = feature([action({ id: asActionId('a'), name: 'A' })], {
      dependencies: [
        {
          id: 'dep' as never,
          name: 'Payments',
          kind: 'service',
          operations: [{ id: 'op' as never, name: 'charge' }]
        }
      ]
    });
    const gaps = detectSpecGaps(withDep, new Set(['a']));
    expect(
      gaps.some((g) => g.reason.includes('Payments.charge') && g.reason.includes('timeout'))
    ).toBe(true);
    expect(gaps.some((g) => g.reason.includes('failure modes'))).toBe(true);
  });
});

describe('detectSpecGaps — decision-table analysis', () => {
  it('surfaces two rules that disagree on the same condition as a critical gap', () => {
    const contradictory = action({
      id: asActionId('dec'),
      name: 'Approve',
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
          effect: { id: asEffectId('e2'), type: 'block_action', reason: 'nope' }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([contradictory]), new Set([String(contradictory.id)]));
    const gap = gaps.find((g) => g.entityId === 'dec' && g.reason.includes('disagree'));
    expect(gap?.severity).toBe('critical');
  });

  it('does not flag a clean, mutually-exclusive rule set', () => {
    const clean = action({
      id: asActionId('clean'),
      name: 'Route',
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e1'), type: 'allow_action' }
        },
        {
          id: asRuleId('r2'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_false' },
          effect: { id: asEffectId('e2'), type: 'block_action', reason: 'closed' }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([clean]), new Set([String(clean.id)]));
    expect(gaps.some((g) => g.entityId === 'clean' && g.reason.includes('disagree'))).toBe(false);
  });
});
