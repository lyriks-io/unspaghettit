import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { Clock } from '$shared/domain/Clock';
import type { QueueItemId } from '../../domain/entities/QueueItem';
import { dequeue } from '../../domain/services/QueueOperations';
import { ProjectNotFoundForQueueError } from './EnqueueQueueItem';

/**
 * Remove a queue entry by its opaque id. Idempotent: dequeueing an id
 * that no longer exists is a no-op (returns the project unchanged) so
 * a stale "remove" from a slow UI doesn't error out.
 */
export const dequeueQueueItemUseCase = (deps: {
  projects: ProjectRepository;
  clock: Clock;
}) => {
  return async (projectId: ProjectId, queueItemId: QueueItemId): Promise<Project> => {
    const project = await deps.projects.get(projectId);
    if (!project) throw new ProjectNotFoundForQueueError(projectId);
    const queue = project.implementationQueue ?? [];
    const nextQueue = dequeue(queue, queueItemId);
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
