import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { getEffectiveEntities } from './EffectiveEntities';

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

describe('getEffectiveEntities', () => {
  it('exposes deduced namespaces as effective entries even when nothing is declared', () => {
    const result = getEffectiveEntities(
      exp({ surfaces: [surface('A', ['user.email', 'cart.itemCount'])] })
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.isMaterialized)).toBe(true);
    expect(result.find((r) => r.namespace === 'user')?.name).toBe('User');
  });

  it('overlays declared metadata on top of deduced fields', () => {
    const result = getEffectiveEntities(
      exp({
        surfaces: [surface('A', ['user.email', 'user.role'])],
        entities: [
          {
            id: asEntityId('d-user'),
            namespace: 'user',
            description: 'Account record',
            fields: [
              {
                id: asEntityFieldId('f-1'),
                name: 'email',
                path: asStatePath('user.email'),
                type: 'string'
              }
            ]
          }
        ]
      })
    );
    const user = result.find((r) => r.namespace === 'user');
    expect(user?.isMaterialized).toBe(true);
    // Display name is always derived from the namespace.
    expect(user?.name).toBe('User');
    expect(user?.description).toBe('Account record');
    expect(user?.fields.map((f) => f.path)).toEqual(['user.email', 'user.role']);
    // user.email is declared (id present), user.role is deduced
    expect(user?.fields.find((f) => f.path === 'user.email')?.source).toBe('declared');
    expect(user?.fields.find((f) => f.path === 'user.role')?.source).toBe('deduced');
  });

  it('keeps declared entries that have no matching state paths', () => {
    const result = getEffectiveEntities(
      exp({
        entities: [
          {
            id: asEntityId('d-orphan'),
            namespace: 'orphan',
            fields: []
          }
        ]
      })
    );
    expect(result.find((r) => r.namespace === 'orphan')?.isMaterialized).toBe(true);
  });
});
