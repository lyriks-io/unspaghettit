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
import {
  ActionNotInFeatureError,
  enqueueQueueItemUseCase,
  FeatureNotInProjectError,
  ProjectNotFoundForQueueError,
  SurfaceNotInFeatureError
} from './EnqueueQueueItem';

const FROZEN_TIME = '2026-05-22T08:30:00.000Z';

let projectRepo: InMemoryProjectRepository;
let featureRepo: InMemoryFeatureRepository;
let counter = 0;

const featureFixture: Feature = {
  id: asFeatureId('f-1'),
  name: 'Booking',
  description: 'Restaurant booking',
  surfaces: [
    {
      id: 'surface-1' as never,
      name: 'Checkout',
      description: 'Confirm and pay',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('a-1'),
          name: 'Confirm booking',
          intent: 'Locks the slot for the user',
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

const projectFixture: Project = {
  id: asProjectId('p-1'),
  name: 'Bookings',
  description: 'Bookings product',
  featureIds: [asFeatureId('f-1')],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
};

const buildUseCase = () =>
  enqueueQueueItemUseCase({
    projects: projectRepo,
    features: featureRepo,
    clock: fixedClock(FROZEN_TIME),
    ids: () => `queue-${++counter}`
  });

beforeEach(async () => {
  counter = 0;
  projectRepo = new InMemoryProjectRepository();
  featureRepo = new InMemoryFeatureRepository();
  await projectRepo.save(projectFixture);
  await featureRepo.save(featureFixture);
});

describe('enqueueQueueItemUseCase', () => {
  it('appends a feature entry to the queue and bumps updatedAt', async () => {
    const enqueue = buildUseCase();
    const result = await enqueue(asProjectId('p-1'), {
      kind: 'feature',
      featureId: asFeatureId('f-1')
    });
    expect(result.alreadyQueued).toBe(false);
    expect(result.project.implementationQueue).toHaveLength(1);
    expect(result.project.updatedAt).toBe(FROZEN_TIME);
    expect(result.item.id).toBe('queue-1');
  });

  it('re-queueing the same target is a no-op (alreadyQueued:true, no save)', async () => {
    const enqueue = buildUseCase();
    await enqueue(asProjectId('p-1'), { kind: 'feature', featureId: asFeatureId('f-1') });
    const second = await enqueue(asProjectId('p-1'), {
      kind: 'feature',
      featureId: asFeatureId('f-1')
    });
    expect(second.alreadyQueued).toBe(true);
    expect(second.project.implementationQueue).toHaveLength(1);
    // The returned item is the original, not a freshly minted one
    expect(second.item.id).toBe('queue-1');
  });

  it('queues an action when its parent feature has it', async () => {
    const enqueue = buildUseCase();
    const result = await enqueue(asProjectId('p-1'), {
      kind: 'action',
      featureId: asFeatureId('f-1'),
      actionId: asActionId('a-1')
    });
    expect(result.alreadyQueued).toBe(false);
    expect(result.item.kind).toBe('action');
  });

  it('rejects unknown projects', async () => {
    const enqueue = buildUseCase();
    await expect(
      enqueue(asProjectId('ghost'), { kind: 'feature', featureId: asFeatureId('f-1') })
    ).rejects.toThrow(ProjectNotFoundForQueueError);
  });

  it('rejects a feature that is not attached to the project', async () => {
    const enqueue = buildUseCase();
    await expect(
      enqueue(asProjectId('p-1'), { kind: 'feature', featureId: asFeatureId('f-other') })
    ).rejects.toThrow(FeatureNotInProjectError);
  });

  it('rejects an action that is not part of its feature', async () => {
    const enqueue = buildUseCase();
    await expect(
      enqueue(asProjectId('p-1'), {
        kind: 'action',
        featureId: asFeatureId('f-1'),
        actionId: asActionId('ghost')
      })
    ).rejects.toThrow(ActionNotInFeatureError);
  });

  it('queues a surface that exists on its feature', async () => {
    const enqueue = buildUseCase();
    const result = await enqueue(asProjectId('p-1'), {
      kind: 'surface',
      featureId: asFeatureId('f-1'),
      surfaceId: asSurfaceId('surface-1')
    });
    expect(result.alreadyQueued).toBe(false);
    expect(result.item.kind).toBe('surface');
  });

  it('rejects a surface that is not part of its feature', async () => {
    const enqueue = buildUseCase();
    await expect(
      enqueue(asProjectId('p-1'), {
        kind: 'surface',
        featureId: asFeatureId('f-1'),
        surfaceId: asSurfaceId('ghost-surface')
      })
    ).rejects.toThrow(SurfaceNotInFeatureError);
  });

  it('treats feature, surface, and action targets independently for dedupe', async () => {
    const enqueue = buildUseCase();
    await enqueue(asProjectId('p-1'), { kind: 'feature', featureId: asFeatureId('f-1') });
    await enqueue(asProjectId('p-1'), {
      kind: 'surface',
      featureId: asFeatureId('f-1'),
      surfaceId: asSurfaceId('surface-1')
    });
    const last = await enqueue(asProjectId('p-1'), {
      kind: 'action',
      featureId: asFeatureId('f-1'),
      actionId: asActionId('a-1')
    });
    expect(last.project.implementationQueue).toHaveLength(3);
  });
});
