import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asEntityId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { deduceDataCandidates } from './EntityDeducer';

const surface = (name: string, paths: readonly string[]): Surface => ({
  id: asSurfaceId(name),
  name,
  type: 'screen',
  stateDefinitions: paths.map((p, i) => ({
    id: asStateDefinitionId(`${name}-${i}`),
    path: asStatePath(p),
    type: 'string',
    defaultValue: ''
  })),
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

const exp = (overrides: Partial<Feature>): Feature => ({
  id: asFeatureId('e'),
  name: 'E',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
  ...overrides
});

describe('deduceDataCandidates', () => {
  it('groups state paths by namespace into one candidate per unique first segment', () => {
    const candidates = deduceDataCandidates(
      exp({
        surfaces: [
          surface('A', ['user.email', 'user.role', 'cart.itemCount']),
          surface('B', ['user.authenticated', 'cart.subtotal'])
        ]
      })
    );
    expect(candidates).toHaveLength(2);
    const user = candidates.find((c) => c.namespace === 'user');
    const cart = candidates.find((c) => c.namespace === 'cart');
    expect(user?.fields.map((f) => f.path)).toEqual([
      'user.authenticated',
      'user.email',
      'user.role'
    ]);
    expect(cart?.fields.map((f) => f.path)).toEqual(['cart.itemCount', 'cart.subtotal']);
    expect(user?.usedBySurfaces).toEqual(['A', 'B']);
  });

  it('skips namespaces that are already materialized in feature.entities', () => {
    const candidates = deduceDataCandidates(
      exp({
        surfaces: [surface('A', ['user.email', 'cart.itemCount'])],
        entities: [
          {
            id: asEntityId('d-user'),
            namespace: 'user',
            fields: []
          }
        ]
      })
    );
    expect(candidates.map((c) => c.namespace)).toEqual(['cart']);
  });

  it('proposes a humanized name from the namespace', () => {
    const candidates = deduceDataCandidates(
      exp({ surfaces: [surface('A', ['quota.leadsThisMonth'])] })
    );
    expect(candidates[0]?.proposedName).toBe('Quota');
  });
});
