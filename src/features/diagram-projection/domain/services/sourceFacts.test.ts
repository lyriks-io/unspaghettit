import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { asFeatureId, asSurfaceId, asTransitionId } from '$features/behavior-model/domain/value-objects/ids';
import { sourceFacts } from './sourceFacts';

const surface = (over: Partial<Surface> = {}): Surface => ({
  id: asSurfaceId('s'),
  name: 'S',
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: [],
  ...over
});

const feature = (over: Partial<Feature> = {}): Feature => ({
  id: asFeatureId('f'),
  name: 'F',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '',
  updatedAt: '',
  ...over
});

describe('sourceFacts', () => {
  it('reports nothing loaded for an empty source', () => {
    expect(sourceFacts({ features: [] })).toEqual({
      loaded: false,
      hasTransitions: false,
      hasEntities: false
    });
  });

  it('detects surface transitions', () => {
    const f = feature({
      surfaces: [surface({ transitions: [{ id: asTransitionId('t'), target: asSurfaceId('s2') }] })]
    });
    expect(sourceFacts({ features: [f] })).toMatchObject({ loaded: true, hasTransitions: true });
  });

  it('detects entities', () => {
    const f = feature({
      entities: [{ id: 'e1' as never, namespace: 'user', fields: [] }]
    });
    expect(sourceFacts({ features: [f] })).toMatchObject({ loaded: true, hasEntities: true });
  });
});
