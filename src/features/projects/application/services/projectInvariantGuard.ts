import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import { loadFeaturesByIds } from '$features/behavior-model/application/services/bulkRead';
import type { ProjectRepository } from '../ports/ProjectRepository';
import {
  invariantPathsLost,
  lostInvariantPathMessage
} from '../../domain/services/stateRegistry';
import { findOwningProject } from './bulkRead';

/**
 * The check a feature write runs against its project before it is saved: the
 * refusals for every project invariant the change would leave reading a state
 * no feature of the project declares any more. Empty when the feature belongs
 * to no project, the project has no invariant, or nothing is lost.
 *
 * The project could not be read (a sibling file unreadable, say): the write
 * goes on as it did before this check existed, rather than blocking every
 * write of the project on a file the change does not touch.
 */
export const projectInvariantGuard =
  (features: FeatureRepository, projects: ProjectRepository) =>
  async (before: Feature, after: Feature): Promise<readonly string[]> => {
    try {
      const project = await findOwningProject(projects, String(after.id));
      const invariants = project?.projectInvariants ?? [];
      if (!project || invariants.length === 0) return [];
      const siblingIds = project.featureIds.map(String).filter((id) => id !== String(after.id));
      const siblings = (await loadFeaturesByIds(features, siblingIds)).filter(
        (f): f is Feature => f !== null
      );
      return invariantPathsLost(invariants, [before, ...siblings], [after, ...siblings]).map(
        lostInvariantPathMessage
      );
    } catch {
      return [];
    }
  };
