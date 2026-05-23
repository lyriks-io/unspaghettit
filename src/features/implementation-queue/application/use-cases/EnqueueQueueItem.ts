import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { Clock } from '$shared/domain/Clock';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import {
  asQueueItemId,
  queueItemKey,
  type QueueItem
} from '../../domain/entities/QueueItem';
import { enqueue, isQueued } from '../../domain/services/QueueOperations';

export class ProjectNotFoundForQueueError extends Error {
  constructor(projectId: ProjectId) {
    super(`Project ${projectId} not found`);
    this.name = 'ProjectNotFoundForQueueError';
  }
}

export class FeatureNotInProjectError extends Error {
  constructor(featureId: FeatureId, projectId: ProjectId) {
    super(`Feature ${featureId} is not attached to project ${projectId}`);
    this.name = 'FeatureNotInProjectError';
  }
}

export class ActionNotInFeatureError extends Error {
  constructor(actionId: ActionId, featureId: FeatureId) {
    super(`Action ${actionId} is not part of feature ${featureId}`);
    this.name = 'ActionNotInFeatureError';
  }
}

export class SurfaceNotInFeatureError extends Error {
  constructor(surfaceId: SurfaceId, featureId: FeatureId) {
    super(`Surface ${surfaceId} is not part of feature ${featureId}`);
    this.name = 'SurfaceNotInFeatureError';
  }
}

export type EnqueueInput =
  | { readonly kind: 'feature'; readonly featureId: FeatureId; readonly note?: string }
  | {
      readonly kind: 'surface';
      readonly featureId: FeatureId;
      readonly surfaceId: SurfaceId;
      readonly note?: string;
    }
  | {
      readonly kind: 'action';
      readonly featureId: FeatureId;
      readonly actionId: ActionId;
      readonly note?: string;
    };

export type EnqueueResult = {
  readonly project: Project;
  readonly item: QueueItem;
  /** True when the entry already existed and we returned it unchanged. */
  readonly alreadyQueued: boolean;
};

/**
 * Enqueue validates the target before persisting: a queue entry pointing
 * at a feature not in the project, or an action not in the feature, would
 * be unreachable from the rest of the UI and create silent rot. We fail
 * fast at the boundary instead of silently storing dead pointers.
 */
export const enqueueQueueItemUseCase = (deps: {
  projects: ProjectRepository;
  features: FeatureRepository;
  clock: Clock;
  ids: IdGenerator;
}) => {
  return async (
    projectId: ProjectId,
    input: EnqueueInput
  ): Promise<EnqueueResult> => {
    const project = await deps.projects.get(projectId);
    if (!project) throw new ProjectNotFoundForQueueError(projectId);
    if (!project.featureIds.includes(input.featureId)) {
      throw new FeatureNotInProjectError(input.featureId, projectId);
    }

    if (input.kind === 'surface' || input.kind === 'action') {
      const feature = await deps.features.get(input.featureId);
      if (!feature) throw new FeatureNotInProjectError(input.featureId, projectId);
      if (input.kind === 'surface') {
        const found = feature.surfaces.some((s) => s.id === input.surfaceId);
        if (!found) throw new SurfaceNotInFeatureError(input.surfaceId, input.featureId);
      } else {
        const found = feature.surfaces.some((s) =>
          s.actions.some((a) => a.id === input.actionId)
        );
        if (!found) throw new ActionNotInFeatureError(input.actionId, input.featureId);
      }
    }

    const queue = project.implementationQueue ?? [];
    const newItem: QueueItem = buildItem(input, deps);

    const targetKey = queueItemKey(newItem);
    if (isQueued(queue, targetKey)) {
      const existing = queue.find((q) => queueItemKey(q) === targetKey)!;
      return { project, item: existing, alreadyQueued: true };
    }

    const next: Project = {
      ...project,
      implementationQueue: enqueue(queue, newItem),
      updatedAt: deps.clock()
    };
    await deps.projects.save(next);
    return { project: next, item: newItem, alreadyQueued: false };
  };
};

/**
 * Discriminated-union → QueueItem constructor. Kept local because it's
 * only meaningful inside enqueue (everywhere else, items already exist).
 */
const buildItem = (
  input: EnqueueInput,
  deps: { ids: IdGenerator; clock: Clock }
): QueueItem => {
  const id = asQueueItemId(deps.ids());
  const addedAt = deps.clock();
  const note = input.note ? { note: input.note } : {};
  switch (input.kind) {
    case 'feature':
      return { id, kind: 'feature', featureId: input.featureId, addedAt, ...note };
    case 'surface':
      return {
        id,
        kind: 'surface',
        featureId: input.featureId,
        surfaceId: input.surfaceId,
        addedAt,
        ...note
      };
    case 'action':
      return {
        id,
        kind: 'action',
        featureId: input.featureId,
        actionId: input.actionId,
        addedAt,
        ...note
      };
  }
};
