import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '../entities/Project';
import { asProjectId, asStateVariableId } from '../value-objects/ids';
import {
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { projectStateVariables, stateCoherenceIssues } from './stateRegistry';

/**
 * A state definition that projects a shared state (its stateVariableId) under
 * another path than the shared state's: a rename on one side only. The
 * features no longer share the value, and the registry says so instead of
 * listing the projection as if nothing had happened.
 */

const shared = { id: asStateVariableId('sv-plan'), path: asStatePath('account.plan') };

const featureWith = (id: string, path: string): Feature =>
  ({
    id: asFeatureId(id),
    name: id === 'billing' ? 'Billing' : 'Access',
    description: 'A feature.',
    surfaces: [
      {
        id: asSurfaceId(`${id}-screen`),
        name: 'Screen',
        type: 'screen',
        description: 'A screen.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(`${id}-plan`),
            stateVariableId: shared.id,
            path: asStatePath(path),
            type: 'string',
            defaultValue: 'free',
            description: 'The plan.'
          }
        ],
        actions: [],
        rules: [],
        invariants: [],
        transitions: []
      }
    ],
    personas: [],
    resources: [],
    entities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }) as Feature;

const project: Project = {
  id: asProjectId('saas'),
  name: 'SaaS',
  description: 'A product.',
  featureIds: [asFeatureId('billing'), asFeatureId('access')],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  stateVariables: [
    {
      id: shared.id,
      path: shared.path,
      type: 'string',
      defaultValue: 'free',
      description: 'The plan of the account.',
      owner: { featureId: asFeatureId('billing'), surfaceId: asSurfaceId('billing-screen') },
      readers: [],
      writers: []
    }
  ]
};

const issuesOf = (features: readonly Feature[]) =>
  stateCoherenceIssues(projectStateVariables(project, features), features);

describe('a projection of a shared state under another path', () => {
  it('is no issue while every projection carries the shared path', () => {
    expect(issuesOf([featureWith('billing', 'account.plan'), featureWith('access', 'account.plan')])).toEqual([]);
  });

  it('is an error naming the feature, its path and the shared one', () => {
    const issues = issuesOf([featureWith('billing', 'account.plan'), featureWith('access', 'account.tier')]);
    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'projection-path-mismatch',
        severity: 'error',
        stateId: 'sv-plan',
        path: 'account.plan',
        featureIds: ['access', 'billing']
      })
    ]);
    expect(issues[0]!.message).toContain('"account.tier"');
    expect(issues[0]!.message).toContain('"Access"');
  });
});
