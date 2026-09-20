import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import {
  MAX_RELATED_FEATURES_PER_PATH,
  MAX_RELATED_PATHS,
  MAX_RELATED_ROWS,
  relatedElsewhereOfChange,
  statePathsOfChange
} from './RelatedElsewhere';

const setState = (id: string, path: string, value: unknown = 1) =>
  ({
    id: asEffectId(id),
    type: 'set_state',
    path: asStatePath(path),
    value: { kind: 'literal', value }
  }) as unknown as Action['effects'][number];

const reads = (path: string) => ({
  left: asStatePath(path),
  operator: 'greater_than' as const,
  right: 0
});

const action = (id: string, extra: Partial<Action> = {}): Action =>
  ({
    id: asActionId(id),
    name: `Action ${id}`,
    intent: `Do ${id}`,
    parameters: [],
    requiredStates: [],
    rules: [],
    invariants: [],
    effects: [],
    emittedEvents: [],
    transitions: [],
    scenarios: [],
    ...extra
  }) as Action;

const surface = (id: string, extra: Partial<Surface> = {}): Surface =>
  ({
    id: asSurfaceId(id),
    name: `Surface ${id}`,
    type: 'screen',
    stateDefinitions: [],
    actions: [],
    rules: [],
    invariants: [],
    transitions: [],
    ...extra
  }) as Surface;

const feature = (id: string, surfaces: readonly Surface[], extra: Partial<Feature> = {}): Feature =>
  ({
    id: asFeatureId(id),
    name: `Feature ${id}`,
    description: id,
    surfaces,
    personas: [],
    resources: [],
    entities: [],
    events: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...extra
  }) as Feature;

const stateDef = (id: string, path: string, defaultValue: unknown = 0) =>
  ({
    id: asStateDefinitionId(id),
    path: asStatePath(path),
    type: 'number',
    defaultValue
  }) as unknown as Surface['stateDefinitions'][number];

describe('statePathsOfChange', () => {
  it('names the path of a state definition added, changed or removed', () => {
    const before = feature('f1', [
      surface('s1', { stateDefinitions: [stateDef('d1', 'species.mix'), stateDef('d2', 'gone.path')] })
    ]);
    const after = feature('f1', [
      surface('s1', {
        stateDefinitions: [stateDef('d1', 'species.mix', 5), stateDef('d3', 'new.path')]
      })
    ]);

    expect([...statePathsOfChange(before, after)].sort()).toEqual([
      'gone.path',
      'new.path',
      'species.mix'
    ]);
  });

  it('names what a touched action reads and writes, and nothing of an untouched one', () => {
    const touched = (extra: Partial<Action>) => action('a1', extra);
    const untouched = action('a2', {
      effects: [setState('e2', 'untouched.path')],
      requiredStates: [asStatePath('untouched.required')]
    });
    const before = feature('f1', [
      surface('s1', { actions: [touched({ effects: [setState('e1', 'species.mix')] }), untouched] })
    ]);
    const after = feature('f1', [
      surface('s1', {
        actions: [
          touched({
            effects: [setState('e1', 'species.count')],
            requiredStates: [asStatePath('season.current')],
            rules: [
              {
                id: asRuleId('r1'),
                category: 'validation',
                description: 'Only in season',
                condition: reads('season.open'),
                effect: setState('e3', 'audit.trail')
              } as unknown as Action['rules'][number]
            ]
          }),
          untouched
        ]
      })
    ]);

    const paths = statePathsOfChange(before, after);
    // What it writes now, what it required, what a rule reads and writes, and
    // what it used to write: a path a change STOPPED touching matters too.
    expect([...paths].sort()).toEqual([
      'audit.trail',
      'season.current',
      'season.open',
      'species.count',
      'species.mix'
    ]);
    expect(paths).not.toContain('untouched.path');
    expect(paths).not.toContain('untouched.required');
  });

  it('names the paths of a removed action, and answers nothing for an unchanged feature', () => {
    const doomed = action('a1', { effects: [setState('e1', 'species.mix')] });
    const before = feature('f1', [surface('s1', { actions: [doomed] })]);
    const after = feature('f1', [surface('s1', { actions: [] })]);

    expect(statePathsOfChange(before, after)).toEqual(['species.mix']);
    expect(statePathsOfChange(before, before)).toEqual([]);
  });
});

describe('relatedElsewhereOfChange', () => {
  const before = feature('f1', [
    surface('s1', { actions: [action('a1', { effects: [setState('e1', 'species.mix', 1)] })] })
  ]);
  const after = feature('f1', [
    surface('s1', { actions: [action('a1', { effects: [setState('e1', 'species.mix', 2)] })] })
  ]);

  const sibling = feature('f2', [
    surface('s2', {
      stateDefinitions: [stateDef('d2', 'species.mix')],
      actions: [
        action('a2', {
          name: 'Rebalance the reef',
          effects: [setState('e2', 'species.mix')]
        }),
        action('a3', { name: 'Read the mix', requiredStates: [asStatePath('species.mix')] })
      ],
      rules: [
        {
          id: asRuleId('r2'),
          category: 'validation',
          description: 'The mix stays whole',
          condition: reads('species.mix'),
          effect: setState('e4', 'mix.audit')
        } as unknown as Surface['rules'][number]
      ],
      invariants: [
        {
          id: asInvariantId('i2'),
          name: 'The mix is never empty',
          condition: reads('species.mix')
        } as unknown as Surface['invariants'][number]
      ]
    })
  ]);

  it('finds the features that declare, read or write a shared path', () => {
    const report = relatedElsewhereOfChange(before, after, [sibling])!;

    expect(report.truncated).toBeUndefined();
    expect(report.statePaths).toHaveLength(1);
    const [entry] = report.statePaths;
    expect(entry!.path).toBe('species.mix');
    expect(entry!.features).toHaveLength(1);
    expect(entry!.features[0]).toEqual({
      featureId: 'f2',
      featureName: 'Feature f2',
      declares: true,
      readBy: [
        { kind: 'action', id: 'a3', name: 'Read the mix' },
        { kind: 'surface_rule', id: 'r2', name: 'The mix stays whole' },
        { kind: 'surface_invariant', id: 'i2', name: 'The mix is never empty' }
      ],
      writtenBy: [{ kind: 'action', id: 'a2', name: 'Rebalance the reef' }]
    });
  });

  it('ignores a feature that shares no path, and answers null rather than an empty block', () => {
    const unrelated = feature('f3', [
      surface('s3', {
        stateDefinitions: [stateDef('d3', 'weather.wind')],
        actions: [action('a4', { effects: [setState('e5', 'weather.wind')] })]
      })
    ]);

    expect(relatedElsewhereOfChange(before, after, [unrelated])).toBeNull();
    // No siblings at all (a feature no project claims) reads the same way.
    expect(relatedElsewhereOfChange(before, after, [])).toBeNull();
    // A change that involves no path has nothing to relate.
    expect(relatedElsewhereOfChange(before, before, [sibling])).toBeNull();

    // The unrelated feature does not dilute a report that also holds a match.
    const report = relatedElsewhereOfChange(before, after, [unrelated, sibling])!;
    expect(report.statePaths[0]!.features.map((f) => f.featureId)).toEqual(['f2']);
  });

  it('carries a feature-level invariant that reads the path', () => {
    const withFeatureInvariant = feature('f4', [surface('s4')], {
      featureInvariants: [
        {
          id: asInvariantId('fi1'),
          name: 'Every reef keeps a mix',
          condition: reads('species.mix')
        }
      ]
    } as unknown as Partial<Feature>);

    const report = relatedElsewhereOfChange(before, after, [withFeatureInvariant])!;
    expect(report.statePaths[0]!.features[0]).toMatchObject({
      declares: false,
      readBy: [{ kind: 'invariant', id: 'fi1', name: 'Every reef keeps a mix' }],
      writtenBy: []
    });
  });

  it('caps paths, features per path and rows per list, and says it truncated', () => {
    const manyPaths = Array.from({ length: MAX_RELATED_PATHS + 5 }, (_, i) => `shared.p${i}`);
    const wideBefore = feature('f1', [
      surface('s1', {
        actions: [action('a1', { effects: manyPaths.map((p, i) => setState(`e${i}`, p, 1)) })]
      })
    ]);
    const wideAfter = feature('f1', [
      surface('s1', {
        actions: [action('a1', { effects: manyPaths.map((p, i) => setState(`e${i}`, p, 2)) })]
      })
    ]);
    // Every sibling declares every path, and the first one also reads it from
    // more actions than a list may carry.
    const crowd = Array.from({ length: MAX_RELATED_FEATURES_PER_PATH + 3 }, (_, f) =>
      feature(`sib${f}`, [
        surface(`ss${f}`, {
          stateDefinitions: manyPaths.map((p, i) => stateDef(`d${f}-${i}`, p)),
          actions:
            f === 0
              ? Array.from({ length: MAX_RELATED_ROWS + 4 }, (_, a) =>
                  action(`a${f}-${a}`, { requiredStates: [asStatePath(manyPaths[0]!)] })
                )
              : []
        })
      ])
    );

    const report = relatedElsewhereOfChange(wideBefore, wideAfter, crowd)!;

    expect(report.truncated).toBe(true);
    expect(report.statePaths).toHaveLength(MAX_RELATED_PATHS);
    for (const entry of report.statePaths) {
      expect(entry.features.length).toBeLessThanOrEqual(MAX_RELATED_FEATURES_PER_PATH);
    }
    expect(report.statePaths[0]!.features[0]!.readBy).toHaveLength(MAX_RELATED_ROWS);
  });
});
