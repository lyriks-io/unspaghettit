import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '../entities/Project';
import { asProjectId, asStateVariableId } from '../value-objects/ids';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId,
  asValueSetId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { projectStateVariables, stateCoherenceIssues } from './stateRegistry';

const feature = (overrides: Partial<Feature> = {}): Feature =>
  ({
    id: asFeatureId('behavior'),
    name: 'Behavior',
    description: 'Behavior feature',
    surfaces: [
      {
        id: asSurfaceId('experience'),
        name: 'Experience',
        description: 'Main experience',
        stateDefinitions: [],
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }) as Feature;

const project = (overrides: Partial<Project> = {}): Project => ({
  id: asProjectId('project'),
  name: 'Project',
  description: 'Project description',
  featureIds: [asFeatureId('behavior')],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
});

describe('project state registry', () => {
  it('projects legacy definitions by path without rewriting the project', () => {
    const legacy = feature({
      surfaces: [
        {
          ...feature().surfaces[0]!,
          stateDefinitions: [
            {
              id: asStateDefinitionId('legacy-status'),
              path: asStatePath('rma.status'),
              type: 'enum',
              defaultValue: 'requested',
              enumValues: ['requested', 'approved'],
              description: 'Lifecycle status'
            }
          ]
        }
      ]
    });

    const source = project();
    const states = projectStateVariables(source, [legacy]);

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ id: 'legacy-status', path: 'rma.status' });
    expect(source.stateVariables).toBeUndefined();
  });

  it('keeps explicit identity and discovers surface projections by stateVariableId', () => {
    const stateId = asStateVariableId('canonical-status');
    const explicit = project({
      stateVariables: [
        {
          id: stateId,
          path: asStatePath('rma.status'),
          type: 'string',
          defaultValue: 'requested',
          description: 'Lifecycle status',
          owner: { featureId: asFeatureId('behavior'), surfaceId: asSurfaceId('experience') },
          readers: [],
          writers: []
        }
      ]
    });
    const leaf = feature({
      surfaces: [
        {
          ...feature().surfaces[0]!,
          id: asSurfaceId('leaf'),
          stateDefinitions: [
            {
              id: asStateDefinitionId('projection'),
              stateVariableId: stateId,
              path: asStatePath('rma.status'),
              type: 'string',
              defaultValue: 'requested',
              description: 'Lifecycle status'
            }
          ]
        }
      ]
    });

    expect(projectStateVariables(explicit, [leaf])[0]?.readers).toContainEqual({
      featureId: asFeatureId('behavior'),
      surfaceId: asSurfaceId('leaf')
    });
  });

  it('keeps every legacy projection when surfaces reuse one state path', () => {
    const reused = feature({
      surfaces: [
        {
          ...feature().surfaces[0]!,
          stateDefinitions: [
            {
              id: asStateDefinitionId('owner-status'),
              path: asStatePath('rma.status'),
              type: 'string',
              defaultValue: 'requested',
              description: 'Lifecycle status'
            }
          ]
        },
        {
          ...feature().surfaces[0]!,
          id: asSurfaceId('review'),
          stateDefinitions: [
            {
              id: asStateDefinitionId('review-status'),
              path: asStatePath('rma.status'),
              type: 'string',
              defaultValue: 'requested',
              description: 'Lifecycle status'
            }
          ]
        }
      ]
    });

    expect(projectStateVariables(project(), [reused])[0]?.readers).toContainEqual({
      featureId: asFeatureId('behavior'),
      surfaceId: asSurfaceId('review')
    });
  });

  it('associates legacy projections to an explicit registry entry by path', () => {
    const stateId = asStateVariableId('canonical-status');
    const explicit = project({
      stateVariables: [
        {
          id: stateId,
          path: asStatePath('rma.status'),
          type: 'string',
          defaultValue: 'requested',
          description: 'Lifecycle status',
          owner: { featureId: asFeatureId('behavior'), surfaceId: asSurfaceId('experience') },
          readers: [],
          writers: []
        }
      ]
    });
    const legacyProjection = feature({
      surfaces: [
        {
          ...feature().surfaces[0]!,
          id: asSurfaceId('legacy-reader'),
          stateDefinitions: [
            {
              id: asStateDefinitionId('legacy-status'),
              path: asStatePath('rma.status'),
              type: 'string',
              defaultValue: 'requested',
              description: 'Lifecycle status'
            }
          ]
        }
      ]
    });

    expect(projectStateVariables(explicit, [legacyProjection])).toEqual([
      expect.objectContaining({
        id: stateId,
        readers: [{ featureId: asFeatureId('behavior'), surfaceId: asSurfaceId('legacy-reader') }]
      })
    ]);
  });

  it('reports enum drift on a linked data field', () => {
    const valueSetId = asValueSetId('rma-status-values');
    const dataFeature = feature({
      valueSets: [{ id: valueSetId, name: 'Status', values: ['requested', 'approved'] }],
      entities: [
        {
          id: asEntityId('request'),
          namespace: 'rma',
          description: 'Return request',
          fields: [
            {
              id: asEntityFieldId('status'),
              name: 'status',
              type: 'enum',
              description: 'Status',
              enumValues: ['requested', 'rejected']
            }
          ]
        }
      ]
    });
    const states = [
      {
        id: asStateVariableId('canonical-status'),
        path: asStatePath('rma.status'),
        type: 'enum' as const,
        defaultValue: 'requested',
        description: 'Lifecycle status',
        valueSetId,
        owner: { featureId: dataFeature.id, surfaceId: dataFeature.surfaces[0]!.id },
        readers: [],
        writers: [],
        links: {
          dataField: {
            featureId: dataFeature.id,
            entityId: asEntityId('request'),
            fieldId: asEntityFieldId('status')
          }
        }
      }
    ];

    expect(stateCoherenceIssues(states, [dataFeature])).toEqual([
      expect.objectContaining({ kind: 'field-enum-mismatch', severity: 'error' })
    ]);
  });
});
