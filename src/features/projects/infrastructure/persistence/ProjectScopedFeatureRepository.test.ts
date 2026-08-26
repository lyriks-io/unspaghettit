import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asEntityId, asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import { InMemoryProjectRepository } from './InMemoryProjectRepository';
import { ProjectScopedFeatureRepository } from './ProjectScopedFeatureRepository';

const entity = { id: asEntityId('ent-user'), name: 'User', namespace: 'user', fields: [] };

const feature = (id: string, refs: readonly string[] = []): Feature => ({
  id: asFeatureId(id),
  name: id,
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  entityRefs: refs.map(asEntityId),
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z'
});

describe('ProjectScopedFeatureRepository.listFull', () => {
  it('resolves every member feature against its project library in one pass', async () => {
    const features = new InMemoryFeatureRepository();
    await features.save(feature('feat-a', ['ent-user']));
    await features.save(feature('feat-orphan', ['ent-user']));
    const projects = new InMemoryProjectRepository();
    await projects.save({
      id: asProjectId('proj'),
      name: 'Proj',
      description: '',
      featureIds: [asFeatureId('feat-a')],
      entities: [entity],
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z'
    } as Project);
    const scoped = new ProjectScopedFeatureRepository(features, projects);

    const all = await scoped.listFull();
    const byId = new Map(all.map((f) => [String(f.id), f]));
    // Same shape as get(): the member sees the library entity, the orphan keeps its ref.
    expect(byId.get('feat-a')).toEqual(await scoped.get(asFeatureId('feat-a')));
    expect(byId.get('feat-a')?.entities.map((e) => String(e.id))).toEqual(['ent-user']);
    expect(byId.get('feat-orphan')?.entities).toEqual([]);
  });
});
