import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type {
  BlueprintBuildContext,
  SurfaceBlueprint
} from '../entities/SurfaceBlueprint';
import type { BlueprintId } from '../value-objects/BlueprintId';

/**
 * Apply a batch of blueprints to an feature in a single coherent operation.
 *
 * The two-phase shape matters: we pre-allocate a SurfaceId for every blueprint
 * in the batch BEFORE calling any `build`. That way each blueprint can wire
 * transitions to its siblings using the freshly-assigned ids, rather than
 * requiring a post-hoc rewrite step.
 *
 * Resources and personas are merged by name. Duplicates are skipped to
 * preserve any tweaks the user has made to existing entries.
 *
 * Pure function. The application use-case is responsible for persistence.
 */
export const applyBlueprints = (
  feature: Feature,
  blueprints: readonly SurfaceBlueprint[],
  ids: IdGenerator
): { readonly feature: Feature; readonly addedSurfaceIds: readonly SurfaceId[] } => {
  const linkTargets = new Map<BlueprintId, SurfaceId>();
  for (const bp of blueprints) {
    linkTargets.set(bp.id, asSurfaceId(ids()));
  }

  let next: Feature = feature;
  const addedSurfaceIds: SurfaceId[] = [];

  for (const bp of blueprints) {
    const ownSurfaceId = linkTargets.get(bp.id);
    if (!ownSurfaceId) continue;
    const ctx: BlueprintBuildContext = { ids, ownSurfaceId, linkTargets };
    const result = bp.build(ctx);
    next = mergeBuildResult(next, result.surface, result.resources, result.personas);
    addedSurfaceIds.push(ownSurfaceId);
  }

  return { feature: next, addedSurfaceIds };
};

const mergeBuildResult = (
  feature: Feature,
  surface: Surface,
  resources: readonly Resource[] | undefined,
  personas: readonly Persona[] | undefined
): Feature => {
  const existingResourceNames = new Set(feature.resources.map((r) => r.name));
  const newResources = (resources ?? []).filter((r) => !existingResourceNames.has(r.name));

  const existingPersonaNames = new Set(feature.personas.map((p) => p.name));
  const newPersonas = (personas ?? []).filter((p) => !existingPersonaNames.has(p.name));

  return {
    ...feature,
    surfaces: [...feature.surfaces, surface],
    resources: [...feature.resources, ...newResources],
    personas: [...feature.personas, ...newPersonas]
  };
};

/**
 * Expand a set of blueprints by transitively pulling in their siblings.
 * Used when the user clicks "Add bundle" on a blueprint that's part of a
 * linked group (e.g. picking Sign in pulls Sign up + Verify + Reset).
 */
export const expandWithSiblings = (
  blueprints: readonly SurfaceBlueprint[],
  byId: (id: BlueprintId) => SurfaceBlueprint | undefined
): readonly SurfaceBlueprint[] => {
  const seen = new Set<BlueprintId>();
  const out: SurfaceBlueprint[] = [];
  const visit = (bp: SurfaceBlueprint) => {
    if (seen.has(bp.id)) return;
    seen.add(bp.id);
    out.push(bp);
    for (const siblingId of bp.siblings ?? []) {
      const sibling = byId(siblingId);
      if (sibling) visit(sibling);
    }
  };
  for (const bp of blueprints) visit(bp);
  return out;
};
