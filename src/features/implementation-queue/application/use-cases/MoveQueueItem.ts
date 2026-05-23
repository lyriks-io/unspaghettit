import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { Clock } from '$shared/domain/Clock';
import type { QueueItemId } from '../../domain/entities/QueueItem';
import { moveBy, moveTo } from '../../domain/services/QueueOperations';
import { ProjectNotFoundForQueueError } from './EnqueueQueueItem';

/**
 * Two shapes of "move": absolute (UI drag-and-drop drops at index N) and
 * relative (MCP `reorder_queue direction:'up'|'down'`). Both pure under
 * the hood; this just dispatches.
 */
export type MoveQueueInput =
  | { readonly kind: 'to'; readonly targetIndex: number }
  | { readonly kind: 'by'; readonly direction: 'up' | 'down' };

export const moveQueueItemUseCase = (deps: {
  projects: ProjectRepository;
  clock: Clock;
}) => {
  return async (
    projectId: ProjectId,
    queueItemId: QueueItemId,
    input: MoveQueueInput
  ): Promise<Project> => {
    const project = await deps.projects.get(projectId);
    if (!project) throw new ProjectNotFoundForQueueError(projectId);
    const queue = project.implementationQueue ?? [];
    const nextQueue =
      input.kind === 'to'
        ? moveTo(queue, queueItemId, input.targetIndex)
        : moveBy(queue, queueItemId, input.direction);
    if (nextQueue === queue) return project;
    const next: Project = {
      ...project,
      implementationQueue: nextQueue,
      updatedAt: deps.clock()
    };
    await deps.projects.save(next);
    return next;
  };
};
