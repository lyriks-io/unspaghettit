import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import { asFeatureId, asStateDefinitionId, asSurfaceId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { getStateDefinitionsForSurface } from './SharedStateDefinitions';

const surface = (id: string, name: string): Surface => ({
  id: asSurfaceId(id),
  name,
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

describe('getStateDefinitionsForSurface', () => {
  it('includes local state and state shared from other surfaces', () => {
    const entry: Surface = {
      ...surface('entry', 'Entry'),
      stateDefinitions: [
        {
          id: asStateDefinitionId('entry-status'),
          path: asStatePath('audit.status'),
          type: 'enum',
          defaultValue: 'idle',
          enumValues: ['idle', 'running'],
          sharedWith: [asSurfaceId('results')]
        }
      ]
    };
    const results: Surface = {
      ...surface('results', 'Results'),
      stateDefinitions: [
        {
          id: asStateDefinitionId('results-count'),
          path: asStatePath('audit.issueCount'),
          type: 'number',
          defaultValue: 0
        }
      ]
    };
    const feature: Feature = {
      id: asFeatureId('exp'),
      name: 'Shared state',
      surfaces: [entry, results],
      personas: [],
      resources: [],
      entities: [],
      events: [],
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z'
    };

    const paths = getStateDefinitionsForSurface(feature, results).map((d) => String(d.path));

    expect(paths).toEqual(['audit.issueCount', 'audit.status']);
  });
});
