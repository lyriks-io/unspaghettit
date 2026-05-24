import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { QueueItem } from '../../domain/entities/QueueItem';
import { ProjectNotFoundForQueueError } from './EnqueueQueueItem';

/**
 * A queue item enriched with human-meaningful labels (feature name,
 * action name) and an `orphaned` flag for entries whose target no
 * longer exists in the spec — usually because the user deleted the
 * feature or action without dequeueing first. The dashboard renders
 * orphans dimmed with a "remove" affordance instead of dropping them
 * silently; that way a deletion is recoverable as long as the user
 * notices the orphan.
 */
export type QueueView = {
  readonly item: QueueItem;
  readonly featureName: string;
  readonly surfaceName?: string;
  readonly actionName?: string;
  readonly orphaned: boolean;
};

/**
 * Returns the project's raw queue order, enriched with labels. The
 * "is implemented" predicate is intentionally NOT applied here — the
 * caller (MCP or UI) layers its own done-detection on top via
 * `get_implementation_status` (MCP) or the implementationStatusStore
 * (dashboard), because the two sides see status from different
 * sources of truth and we don't want the queue domain to depend on
 * either one.
 */
export const listQueueUseCase = (deps: {
  projects: ProjectRepository;
  features: FeatureRepository;
}) => {
  return async (projectId: ProjectId): Promise<readonly QueueView[]> => {
    const project = await deps.projects.get(projectId);
    if (!project) throw new ProjectNotFoundForQueueError(projectId);
    const queue = project.implementationQueue ?? [];
    if (queue.length === 0) return [];

    // One read per distinct featureId. The queue is typically < 50 entries
    // and feature.get is cheap, but cache anyway so an "implement next 20
    // actions of feature X" run does not pay N round-trips.
    const cache = new Map<string, Awaited<ReturnType<typeof deps.features.get>>>();
    const resolveFeature = async (featureId: QueueItem['featureId']) => {
      const key = String(featureId);
      if (cache.has(key)) return cache.get(key)!;
      const f = await deps.features.get(featureId);
      cache.set(key, f);
      return f;
    };

    const views: QueueView[] = [];
    for (const item of queue) {
      const feature = await resolveFeature(item.featureId);
      if (!feature) {
        views.push({
          item,
          featureName: `(missing feature ${item.featureId})`,
          orphaned: true
        });
        continue;
      }
      if (item.kind === 'feature') {
        views.push({ item, featureName: feature.name, orphaned: false });
        continue;
      }
      if (item.kind === 'surface') {
        const surface = feature.surfaces.find((s) => s.id === item.surfaceId);
        if (!surface) {
          views.push({
            item,
            featureName: feature.name,
            surfaceName: `(missing surface ${item.surfaceId})`,
            orphaned: true
          });
          continue;
        }
        views.push({
          item,
          featureName: feature.name,
          surfaceName: surface.name,
          orphaned: false
        });
        continue;
      }
      const action = feature.surfaces
        .flatMap((s) => s.actions)
        .find((a) => a.id === item.actionId);
      if (!action) {
        views.push({
          item,
          featureName: feature.name,
          actionName: `(missing action ${item.actionId})`,
          orphaned: true
        });
        continue;
      }
      views.push({
        item,
        featureName: feature.name,
        actionName: action.name,
        orphaned: false
      });
    }
    return views;
  };
};
