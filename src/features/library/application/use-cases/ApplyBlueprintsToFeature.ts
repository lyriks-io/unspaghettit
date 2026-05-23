import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type { BlueprintRepository } from '../../domain/repositories/BlueprintRepository';
import { applyBlueprints, expandWithSiblings } from '../../domain/services/BlueprintApplier';
import type { BlueprintId } from '../../domain/value-objects/BlueprintId';

export type ApplyBlueprintsResult = {
  readonly feature: Feature;
  readonly addedSurfaceIds: readonly SurfaceId[];
};

/**
 * Resolve blueprint ids through the repository, optionally expand to siblings,
 * and apply them to the feature. Pure orchestration. No persistence.
 */
export const applyBlueprintsToFeature = (
  repo: BlueprintRepository,
  feature: Feature,
  blueprintIds: readonly BlueprintId[],
  ids: IdGenerator,
  options: { readonly includeSiblings?: boolean } = {}
): ApplyBlueprintsResult => {
  const requested = blueprintIds
    .map((id) => repo.findById(id))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);

  const blueprints = options.includeSiblings
    ? expandWithSiblings(requested, (id) => repo.findById(id))
    : requested;

  return applyBlueprints(feature, blueprints, ids);
};
