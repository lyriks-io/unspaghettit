import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { normalizeFeatureSharedState } from './FeatureSharedStateNormalizer';

const wrap = (surfaces: readonly Surface[]): Feature => ({
  id: asFeatureId('f'),
  name: 'F',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z'
});

describe('normalizeFeatureSharedState', () => {
  it('auto-adds a reader surface to the owner state def sharedWith', () => {
    const owner: Surface = {
      id: asSurfaceId('owner'),
      name: 'Owner',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd'),
          path: asStatePath('shared.value'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const reader: Surface = {
      id: asSurfaceId('reader'),
      name: 'Reader',
      type: 'screen',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('a'),
          name: 'Use',
          intent: '',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId('r'),
              category: 'business',
              condition: { left: asStatePath('shared.value'), operator: 'greater_than', right: 0 },
              effect: { id: asEffectId('e'), type: 'allow_action' }
            }
          ],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const out = normalizeFeatureSharedState(wrap([owner, reader]));
    expect(out.surfaces[0]!.stateDefinitions[0]!.sharedWith).toEqual([asSurfaceId('reader')]);
  });

  it('is a no-op when state is local to the surface that reads it', () => {
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd'),
          path: asStatePath('local.x'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [
        {
          id: asActionId('a'),
          name: 'A',
          intent: '',
          parameters: [],
          requiredStates: [asStatePath('local.x')],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const f = wrap([surface]);
    expect(normalizeFeatureSharedState(f)).toBe(f);
  });

  it('does not duplicate when reader is already in sharedWith', () => {
    const owner: Surface = {
      id: asSurfaceId('owner'),
      name: 'O',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd'),
          path: asStatePath('shared.x'),
          type: 'number',
          defaultValue: 0,
          sharedWith: [asSurfaceId('reader')]
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const reader: Surface = {
      id: asSurfaceId('reader'),
      name: 'R',
      type: 'screen',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('a'),
          name: 'A',
          intent: '',
          parameters: [],
          requiredStates: [asStatePath('shared.x')],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const f = wrap([owner, reader]);
    const out = normalizeFeatureSharedState(f);
    expect(out.surfaces[0]!.stateDefinitions[0]!.sharedWith).toEqual([asSurfaceId('reader')]);
    expect(out).toBe(f); // no change
  });

  it('is idempotent', () => {
    const owner: Surface = {
      id: asSurfaceId('o'),
      name: 'O',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd'),
          path: asStatePath('shared.x'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const reader: Surface = {
      id: asSurfaceId('r'),
      name: 'R',
      type: 'screen',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('a'),
          name: 'A',
          intent: '',
          parameters: [],
          requiredStates: [asStatePath('shared.x')],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const first = normalizeFeatureSharedState(wrap([owner, reader]));
    const second = normalizeFeatureSharedState(first);
    expect(second.surfaces[0]!.stateDefinitions[0]!.sharedWith).toEqual([asSurfaceId('r')]);
  });
});
