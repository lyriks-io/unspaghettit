import type { Clock } from '$shared/domain/Clock';
import { renameTagInList, tagKey, type Tag } from '$shared/domain/Tags';
import { renameTypeColor } from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';

export type RenameTagInput = {
  readonly from: Tag;
  readonly to: Tag;
};

export type RenameTagResult = {
  readonly projectsUpdated: number;
  readonly featuresUpdated: number;
  readonly colorReassigned: boolean;
};

/**
 * Renames a tag across every project and feature that uses it, then carries
 * the previous color assignment (if any) onto the new type. No-op when the
 * old and new tag normalize to the same key.
 */
export const renameTagUseCase = (deps: {
  projects: ProjectRepository;
  features: FeatureRepository;
  palette: TagPaletteRepository;
  clock: Clock;
}) =>
  async (input: RenameTagInput): Promise<RenameTagResult> => {
    if (tagKey(input.from) === tagKey(input.to)) {
      return { projectsUpdated: 0, featuresUpdated: 0, colorReassigned: false };
    }

    const projectSummaries = await deps.projects.list();
    let projectsUpdated = 0;
    for (const summary of projectSummaries) {
      const project = await deps.projects.get(summary.id);
      if (!project) continue;
      const nextTags = renameTagInList(project.tags, input.from, input.to);
      if (nextTags === project.tags) continue;
      await deps.projects.save({
        ...project,
        tags: nextTags,
        updatedAt: deps.clock()
      });
      projectsUpdated++;
    }

    const featureSummaries = await deps.features.list();
    let featuresUpdated = 0;
    for (const summary of featureSummaries) {
      const feature = await deps.features.get(summary.id);
      if (!feature) continue;
      const nextTags = renameTagInList(feature.tags, input.from, input.to);
      if (nextTags === feature.tags) continue;
      await deps.features.save({
        ...feature,
        tags: nextTags,
        updatedAt: deps.clock()
      });
      featuresUpdated++;
    }

    const current = await deps.palette.get();
    const next = renameTypeColor(current, input.from.type, input.to.type);
    const colorReassigned = next !== current;
    if (colorReassigned) await deps.palette.save(next);

    return { projectsUpdated, featuresUpdated, colorReassigned };
  };
