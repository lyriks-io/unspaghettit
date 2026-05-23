import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import { asActionId, asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import { asQueueItemId, type QueueItem } from '../../domain/entities/QueueItem';
import { dequeueQueueItemUseCase } from './DequeueQueueItem';
import { moveQueueItemUseCase } from './MoveQueueItem';

const FROZEN_TIME = '2026-05-22T08:30:00.000Z';

const makeQueue = (): readonly QueueItem[] => [
  {
    id: asQueueItemId('q-a'),
    kind: 'feature',
    featureId: asFeatureId('f-1'),
    addedAt: '2026-05-01T00:00:00.000Z'
  },
  {
    id: asQueueItemId('q-b'),
    kind: 'action',
    featureId: asFeatureId('f-1'),
    actionId: asActionId('a-1'),
    addedAt: '2026-05-01T00:00:00.000Z'
  },
  {
    id: asQueueItemId('q-c'),
    kind: 'feature',
    featureId: asFeatureId('f-2'),
    addedAt: '2026-05-01T00:00:00.000Z'
  }
];

let projectRepo: InMemoryProjectRepository;

beforeEach(async () => {
  projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: asProjectId('p-1'),
    name: 'P',
    description: 'd',
    featureIds: [asFeatureId('f-1'), asFeatureId('f-2')],
    implementationQueue: makeQueue(),
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z'
  };
  await projectRepo.save(project);
});

describe('moveQueueItemUseCase', () => {
  it('moves to an absolute index', async () => {
    const move = moveQueueItemUseCase({ projects: projectRepo, clock: fixedClock(FROZEN_TIME) });
    const next = await move(asProjectId('p-1'), asQueueItemId('q-c'), {
      kind: 'to',
      targetIndex: 0
    });
    expect(next.implementationQueue?.map((q) => String(q.id))).toEqual(['q-c', 'q-a', 'q-b']);
    expect(next.updatedAt).toBe(FROZEN_TIME);
  });

  it('moves by direction', async () => {
    const move = moveQueueItemUseCase({ projects: projectRepo, clock: fixedClock(FROZEN_TIME) });
    const next = await move(asProjectId('p-1'), asQueueItemId('q-b'), {
      kind: 'by',
      direction: 'up'
    });
    expect(next.implementationQueue?.map((q) => String(q.id))).toEqual(['q-b', 'q-a', 'q-c']);
  });

  it('is a no-op at the edge (does not bump updatedAt)', async () => {
    const move = moveQueueItemUseCase({ projects: projectRepo, clock: fixedClock(FROZEN_TIME) });
    const next = await move(asProjectId('p-1'), asQueueItemId('q-a'), {
      kind: 'by',
      direction: 'up'
    });
    expect(next.updatedAt).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('dequeueQueueItemUseCase', () => {
  it('removes the entry and bumps updatedAt', async () => {
    const dequeue = dequeueQueueItemUseCase({
      projects: projectRepo,
      clock: fixedClock(FROZEN_TIME)
    });
    const next = await dequeue(asProjectId('p-1'), asQueueItemId('q-b'));
    expect(next.implementationQueue?.map((q) => String(q.id))).toEqual(['q-a', 'q-c']);
    expect(next.updatedAt).toBe(FROZEN_TIME);
  });

  it('is a no-op when the id is unknown', async () => {
    const dequeue = dequeueQueueItemUseCase({
      projects: projectRepo,
      clock: fixedClock(FROZEN_TIME)
    });
    const next = await dequeue(asProjectId('p-1'), asQueueItemId('ghost'));
    expect(next.implementationQueue).toHaveLength(3);
    expect(next.updatedAt).toBe('2026-05-01T00:00:00.000Z');
  });
});
