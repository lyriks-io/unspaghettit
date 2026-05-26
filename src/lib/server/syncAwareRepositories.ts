import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { replaceSnapshotViaSync } from '$lib/server/syncBridge';

/**
 * Decorates a base ProjectRepository so that save() routes through the
 * Y.Doc-aware sync bridge instead of writing straight to disk. List, get,
 * and delete still defer to the base repo — only the write path needs the
 * collaborative-edit broadcast.
 */
export const createSyncAwareProjectRepository = (
  base: ProjectRepository
): ProjectRepository => ({
  list: () => base.list(),
  get: (id) => base.get(id),
  delete: (id) => base.delete(id),
  save: async (project: Project) => {
    await replaceSnapshotViaSync('project', project.id, project);
  }
});

export const createSyncAwareFeatureRepository = (
  base: FeatureRepository
): FeatureRepository => ({
  list: () => base.list(),
  get: (id) => base.get(id),
  delete: (id) => base.delete(id),
  save: async (feature: Feature) => {
    await replaceSnapshotViaSync('feature', feature.id, feature);
  }
});
