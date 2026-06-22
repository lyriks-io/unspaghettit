import { isEvolution } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { IndexedImplementation } from './IndexedImplementation';

/**
 * How much of a feature is PROVEN, not just claimed: the share of its actions
 * whose `.unspa.json` entry carries a `verifiedAt` stamp (set by
 * `unspa coverage ingest` when the action's scenarios passed against the real
 * code). Evolution placeholders are excluded — they aren't committed behavior.
 */
export type VerifiedCoverage = {
  readonly verified: number;
  readonly total: number;
};

export const verifiedCoverageForFeature = (
  feature: Feature,
  index: readonly IndexedImplementation[]
): VerifiedCoverage => {
  const verifiedActionIds = new Set<string>();
  for (const entry of index) {
    if (entry.verifiedAt && entry.key.startsWith('action:')) {
      verifiedActionIds.add(entry.key.slice('action:'.length));
    }
  }

  let verified = 0;
  let total = 0;
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      if (isEvolution(action)) continue;
      total += 1;
      if (verifiedActionIds.has(String(action.id))) verified += 1;
    }
  }
  return { verified, total };
};
