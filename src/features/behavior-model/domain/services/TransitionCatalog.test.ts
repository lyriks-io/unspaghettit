import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId,
  asTransitionId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { buildTransitionCatalog, groupTransitionCatalog } from './TransitionCatalog';

const blankSurface = (id: string, name: string): Surface => ({
  id: asSurfaceId(id),
  name,
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

const exp = (surfaces: Surface[]): Feature => ({
  id: asFeatureId('e'),
  name: 'E',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
});

describe('TransitionCatalog', () => {
  it('collapses multiple sources for the same edge into one entry', () => {
    const a = blankSurface('a', 'A');
    const b = blankSurface('b', 'B');
    const aWithEdges: Surface = {
      ...a,
      transitions: [{ id: asTransitionId('t1'), target: asSurfaceId('b'), label: 'go' }],
      actions: [
        {
          id: asActionId('c'),
          name: 'Cap',
          intent: '',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId('r1'),
              category: 'business',
              condition: { left: asStatePath('s.x'), operator: 'is_true' },
              effect: {
                id: asEffectId('e1'),
                type: 'transition_surface',
                target: asSurfaceId('b')
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId('e2'),
              type: 'transition_surface',
              target: asSurfaceId('b')
            }
          ],
          emittedEvents: [],
          transitions: []
        }
      ]
    };
    const entries = buildTransitionCatalog(exp([aWithEdges, b]));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fromSurfaceName).toBe('A');
    expect(entries[0]?.toSurfaceName).toBe('B');
    expect(entries[0]?.sources.map((s) => s.origin)).toEqual([
      'declared',
      'action_effect',
      'action_rule_effect'
    ]);
  });

  it('skips edges that point to a surface not in the feature', () => {
    const a: Surface = {
      ...blankSurface('a', 'A'),
      transitions: [
        { id: asTransitionId('t1'), target: asSurfaceId('does-not-exist'), label: 'nope' }
      ]
    };
    expect(buildTransitionCatalog(exp([a]))).toHaveLength(0);
  });

  it('groups by source surface', () => {
    const a: Surface = {
      ...blankSurface('a', 'A'),
      transitions: [{ id: asTransitionId('ta'), target: asSurfaceId('b') }]
    };
    const b: Surface = {
      ...blankSurface('b', 'B'),
      transitions: [{ id: asTransitionId('tb'), target: asSurfaceId('a') }]
    };
    const groups = groupTransitionCatalog(buildTransitionCatalog(exp([a, b])));
    expect(groups.map((g) => g.fromSurfaceName)).toEqual(['A', 'B']);
  });
});
