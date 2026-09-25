import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import {
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { closestStateKeys, stateRenameTargets } from './StateRenames';

const def = (id: string, path: string, previous?: readonly string[]): StateDefinition => ({
  id: asStateDefinitionId(id),
  path: asStatePath(path),
  type: 'number',
  defaultValue: 0,
  ...(previous ? { previousPaths: previous.map(asStatePath) } : {})
});

const featureWith = (id: string, defs: readonly StateDefinition[]): Feature => ({
  id: asFeatureId(id),
  name: id,
  surfaces: [
    {
      id: asSurfaceId(`${id}-s`),
      name: 'Shore',
      type: 'custom',
      stateDefinitions: defs,
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

describe('stateRenameTargets', () => {
  it('maps every path a definition left behind to its current key', () => {
    const renames = stateRenameTargets([
      featureWith('f1', [def('d1', 'tide.height', ['tide.level', 'tide.depth']), def('d2', 'wind.speed')])
    ]);
    expect([...renames]).toEqual([
      ['state:tide.level', ['state:tide.height']],
      ['state:tide.depth', ['state:tide.height']]
    ]);
  });

  it('names every target of a shared path renamed differently in two features', () => {
    const renames = stateRenameTargets([
      featureWith('f1', [def('d1', 'tide.height', ['tide.level'])]),
      featureWith('f2', [def('d2', 'tide.depth', ['tide.level'])])
    ]);
    expect(renames.get('state:tide.level')).toEqual(['state:tide.depth', 'state:tide.height']);
  });

  it('leaves out an old path another definition still carries', () => {
    const renames = stateRenameTargets([
      featureWith('f1', [def('d1', 'tide.height', ['tide.level'])]),
      featureWith('f2', [def('d2', 'tide.level')])
    ]);
    expect(renames.has('state:tide.level')).toBe(false);
  });
});

describe('closestStateKeys', () => {
  const current = ['state:sea.level', 'state:tide.height', 'state:tide.rising', 'state:wind.speed', 'action:a1'];

  it('puts the same last segment first, then the same parent', () => {
    expect(closestStateKeys('state:tide.level', current)).toEqual([
      'state:sea.level',
      'state:tide.height',
      'state:tide.rising'
    ]);
  });

  it('caps the list', () => {
    expect(closestStateKeys('state:tide.level', current, 1)).toEqual(['state:sea.level']);
  });

  it('suggests nothing when no path looks like it', () => {
    expect(closestStateKeys('state:moon.phase', current)).toEqual([]);
  });
});
