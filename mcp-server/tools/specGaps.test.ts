import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
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
