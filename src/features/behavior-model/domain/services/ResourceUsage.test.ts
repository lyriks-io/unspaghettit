import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import {
  asActionId,
  asEntityId,
  asFeatureId,
  asParameterId,
  asResourceId,
  asSurfaceId
} from '../value-objects/ids';
import { buildResourceUsage } from './ResourceUsage';

const exp: Feature = {
  id: asFeatureId('e'),
  name: 'E',
  resources: [],
  entities: [
    {
      id: asEntityId('d-user'),
      namespace: 'user',
      resourceId: asResourceId('r-users'),
      fields: []
    },
    {
      id: asEntityId('d-cart'),
      namespace: 'cart',
      resourceId: asResourceId('r-other'),
      fields: []
    }
  ],
  personas: [],
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'Sign in',
      type: 'screen',
      stateDefinitions: [],
      rules: [],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId('c'),
          name: 'Sign in',
          intent: '',
          parameters: [
            {
              id: asParameterId('p1'),
              name: 'email',
              type: 'string',
              required: true,
              resourceId: asResourceId('r-users')
            },
            {
              id: asParameterId('p2'),
              name: 'password',
              type: 'string',
              required: true
            }
          ],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ]
    }
  ],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
};

describe('buildResourceUsage', () => {
  it('lists data entities and parameters that point at the resource', () => {
    const usage = buildResourceUsage(exp, asResourceId('r-users'));
    expect(usage.dataNamespaces).toEqual(['user']);
    expect(usage.parameters).toHaveLength(1);
    expect(usage.parameters[0]?.parameterName).toBe('email');
    expect(usage.parameters[0]?.actionName).toBe('Sign in');
  });

  it('returns empty arrays when nothing references the resource', () => {
    const usage = buildResourceUsage(exp, asResourceId('r-noone'));
    expect(usage.dataNamespaces).toEqual([]);
    expect(usage.parameters).toEqual([]);
  });
});
