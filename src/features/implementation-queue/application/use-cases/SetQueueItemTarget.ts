import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { Clock } from '$shared/domain/Clock';
import { setTarget } from '../../domain/services/QueueOperations';
import type { QueueItemId, QueueTarget } from '../../domain/entities/QueueItem';
import { ProjectNotFoundForQueueError } from './EnqueueQueueItem';

/**
 * Set (or clear, with `undefined`) the implementation target on one queue
 * entry. The target is advisory metadata — "take this to ~50% implementation",
 * "to full maturity" — that the build step (a person or an LLM reading the
 * queue over MCP) uses as its goal. No-op (and no persist) when the entry id
 * isn't in the project's queue.
 */
export const setQueueItemTargetUseCase = (deps: {
  projects: ProjectRepository;
  clock: Clock;
}) => {
  return async (
    projectId: ProjectId,
    itemId: QueueItemId,
    target: QueueTarget | undefined
  ): Promise<Project> => {
    const project = await deps.projects.get(projectId);
    if (!project) throw new ProjectNotFoundForQueueError(projectId);
    const queue = project.implementationQueue ?? [];
    const next = setTarget(queue, itemId, target);
    if (next === queue) return project;
    const updated: Project = {
      ...project,
      implementationQueue: next,
      updatedAt: deps.clock()
    };
    await deps.projects.save(updated);
    return updated;
  };
};
