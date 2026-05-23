import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';
import { asQueueItemId } from '../../domain/entities/QueueItem';
import { getNextQueuedUseCase } from './GetNextQueued';
import { listQueueUseCase } from './ListQueue';

let projectRepo: InMemoryProjectRepository;
let featureRepo: InMemoryFeatureRepository;

const feature: Feature = {
  id: asFeatureId('f-1'),
  name: 'Booking',
  description: 'd',
  surfaces: [
    {
      id: 'surface-1' as never,
      name: 'Checkout',
      description: 'Confirm',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('a-1'),
          name: 'Confirm',
          intent: 'lock the slot',
          parameters: [],
          requiredStates: [],
          emittedEvents: [],
          rules: [],
          effects: [],
          invariants: []
        } as never
      ],
      rules: [],
      invariants: [],
      transitions: []
    } as never
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
};

const project: Project = {
  id: asProjectId('p-1'),
  name: 'Bookings',
  description: 'd',
  featureIds: [asFeatureId('f-1')],
  implementationQueue: [
    {
      id: asQueueItemId('q-1'),
      kind: 'action',
      featureId: asFeatureId('f-1'),
      actionId: asActionId('a-1'),
      addedAt: '2026-05-01T00:00:00.000Z'
    },
    {
      id: asQueueItemId('q-2'),
      kind: 'action',
      featureId: asFeatureId('f-1'),
      actionId: asActionId('a-missing'),
      addedAt: '2026-05-01T00:00:00.000Z'
    },
    {
      id: asQueueItemId('q-3'),
      kind: 'feature',
      featureId: asFeatureId('f-1'),
      addedAt: '2026-05-01T00:00:00.000Z'
    },
    {
      id: asQueueItemId('q-4'),
      kind: 'surface',
      featureId: asFeatureId('f-1'),
      surfaceId: asSurfaceId('surface-1'),
      addedAt: '2026-05-01T00:00:00.000Z'
    },
    {
      id: asQueueItemId('q-5'),
      kind: 'surface',
      featureId: asFeatureId('f-1'),
      surfaceId: asSurfaceId('ghost-surface'),
      addedAt: '2026-05-01T00:00:00.000Z'
    }
  ],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
};

beforeEach(async () => {
  projectRepo = new InMemoryProjectRepository();
  featureRepo = new InMemoryFeatureRepository();
  await projectRepo.save(project);
  await featureRepo.save(feature);
});

describe('listQueueUseCase', () => {
  it('enriches each entry with human labels', async () => {
    const list = listQueueUseCase({ projects: projectRepo, features: featureRepo });
    const views = await list(asProjectId('p-1'));
    expect(views).toHaveLength(5);
    expect(views[0]).toMatchObject({
      featureName: 'Booking',
      actionName: 'Confirm',
      orphaned: false
    });
  });

  it('flags entries whose target was deleted as orphaned', async () => {
    const list = listQueueUseCase({ projects: projectRepo, features: featureRepo });
    const views = await list(asProjectId('p-1'));
    expect(views[1]!.orphaned).toBe(true);
    expect(views[1]!.actionName).toMatch(/missing action/);
  });

  it('enriches a surface entry with its name', async () => {
    const list = listQueueUseCase({ projects: projectRepo, features: featureRepo });
    const views = await list(asProjectId('p-1'));
    const surfaceView = views.find((v) => v.item.id === asQueueItemId('q-4'));
    expect(surfaceView).toBeDefined();
    expect(surfaceView!.surfaceName).toBe('Checkout');
    expect(surfaceView!.orphaned).toBe(false);
  });

  it('flags a deleted surface as orphaned', async () => {
    const list = listQueueUseCase({ projects: projectRepo, features: featureRepo });
    const views = await list(asProjectId('p-1'));
    const orphanSurface = views.find((v) => v.item.id === asQueueItemId('q-5'));
    expect(orphanSurface!.orphaned).toBe(true);
    expect(orphanSurface!.surfaceName).toMatch(/missing surface/);
  });
});

describe('getNextQueuedUseCase', () => {
  it('skips orphans and returns the first non-done entry', async () => {
    void fixedClock; // imported for parity with other test files
    const next = getNextQueuedUseCase({ projects: projectRepo, features: featureRepo });
    const view = await next(asProjectId('p-1'), () => false);
    expect(view?.item.id).toBe(asQueueItemId('q-1'));
  });

  it('respects the done predicate', async () => {
    const next = getNextQueuedUseCase({ projects: projectRepo, features: featureRepo });
    const view = await next(asProjectId('p-1'), (v) => v.item.id === asQueueItemId('q-1'));
    expect(view?.item.id).toBe(asQueueItemId('q-3'));
  });

  it('returns null when nothing is implementable', async () => {
    const next = getNextQueuedUseCase({ projects: projectRepo, features: featureRepo });
    const view = await next(asProjectId('p-1'), () => true);
    expect(view).toBeNull();
  });
});
