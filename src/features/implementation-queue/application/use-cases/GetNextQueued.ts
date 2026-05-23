import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import { listQueueUseCase, type QueueView } from './ListQueue';

/**
 * Predicate the caller plugs in to decide which queued items are "done"
 * and should be skipped over when picking the next one. The MCP plugs in
 * a predicate that reads `.unspa.json`; the dashboard plugs in one that
 * reads the implementation-status sidecar. Either side can also pass
 * `() => false` to get a pure peek of the next live entry (no filtering).
 */
export type QueueDonePredicate = (view: QueueView) => boolean | Promise<boolean>;

/**
 * Returns the first queue entry that is not orphaned and not "done" per
 * the supplied predicate, or null when the queue is empty / fully done.
 * Pure peek: nothing is dequeued. The dequeue happens later, when the
 * actual implementation status flips to done (auto-prune via the
 * predicate) or when the user/MCP explicitly dequeues.
 */
export const getNextQueuedUseCase = (deps: {
  projects: ProjectRepository;
  features: FeatureRepository;
}) => {
  const listQueue = listQueueUseCase(deps);
  return async (
    projectId: ProjectId,
    isDone: QueueDonePredicate
  ): Promise<QueueView | null> => {
    const views = await listQueue(projectId);
    for (const view of views) {
      if (view.orphaned) continue;
      const done = await isDone(view);
      if (!done) return view;
    }
    return null;
  };
};
