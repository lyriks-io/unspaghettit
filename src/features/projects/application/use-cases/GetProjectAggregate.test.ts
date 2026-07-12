import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Tag } from '$shared/domain/Tags';
import { getProjectAggregateUseCase } from './GetProjectAggregate';

const feature = (id: string, name: string, tags?: readonly Tag[]): Feature =>
  ({
    id: asFeatureId(id),
    name,
    description: 'd',
    surfaces: [],
    personas: [],
    resources: [],
    entities: [],
    tags,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  }) as Feature;

describe('getProjectAggregate — core features (end-to-end through the real use case)', () => {
  it('surfaces the registry, grouping, uncategorized, and soft warnings', async () => {
    const projects = new InMemoryProjectRepository();
    const features = new InMemoryFeatureRepository();

    const login = feature('f1', 'Login', [{ type: 'core', value: 'auth' }]);
    const notes = feature('f2', 'Notes', undefined);
    const reports = feature('f3', 'Reports', [{ type: 'core', value: 'reporting' }]); // undeclared

    await features.save(login);
    await features.save(notes);
    await features.save(reports);

    await projects.save({
      id: asProjectId('p'),
      name: 'P',
      description: 'd',
      featureIds: [login.id, notes.id, reports.id],
      coreFeatures: [{ value: 'auth', description: 'sign-in' }],
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z'
    } as Project);

    const aggregate = await getProjectAggregateUseCase({ projects, features })(asProjectId('p'));

    expect(aggregate).not.toBeNull();
    expect(aggregate!.coreFeatures).toEqual([{ value: 'auth', description: 'sign-in' }]);
    expect(
      aggregate!.coreFeatureGroups.find((g) => g.value === 'auth')?.features.map((f) => f.name)
    ).toEqual(['Login']);
    expect(aggregate!.coreFeatureUncategorized.map((f) => f.name)).toEqual(['Notes']);
    // The reporting-tagged feature is not a member of any group and raises a soft warning.
    expect(aggregate!.coreFeatureWarnings.map((w) => w.kind)).toEqual(['undeclared']);
    expect(aggregate!.coreFeatureWarnings[0]?.featureName).toBe('Reports');
  });

  it('reports no core-feature data for a project that declares none', async () => {
    const projects = new InMemoryProjectRepository();
    const features = new InMemoryFeatureRepository();
    const only = feature('f1', 'Solo', undefined);
    await features.save(only);
    await projects.save({
      id: asProjectId('p2'),
      name: 'P2',
      description: 'd',
      featureIds: [only.id],
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z'
    } as Project);

    const aggregate = await getProjectAggregateUseCase({ projects, features })(asProjectId('p2'));
    expect(aggregate!.coreFeatures).toEqual([]);
    expect(aggregate!.coreFeatureGroups).toEqual([]);
    expect(aggregate!.coreFeatureUncategorized.map((f) => f.name)).toEqual(['Solo']);
    expect(aggregate!.coreFeatureWarnings).toEqual([]);
  });
});
