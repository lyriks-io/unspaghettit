import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type { Surface, SurfaceType } from '$features/behavior-model/domain/entities/Surface';
import type { SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type { BlueprintCategory } from '../value-objects/BlueprintCategory';
import type { BlueprintId } from '../value-objects/BlueprintId';

/**
 * Context handed to a blueprint's `build` function. The applier pre-allocates
 * a SurfaceId for every blueprint in the batch so cross-blueprint transitions
 * can resolve to a real id at construction time, without a second pass.
 */
export type BlueprintBuildContext = {
  readonly ids: IdGenerator;
  readonly ownSurfaceId: SurfaceId;
  /** Sibling blueprint id → assigned SurfaceId. Empty for siblings not in the
   *  current batch. Blueprints should treat lookups as optional. */
  readonly linkTargets: ReadonlyMap<BlueprintId, SurfaceId>;
};

export type BlueprintBuildResult = {
  readonly surface: Surface;
  readonly resources?: readonly Resource[];
  readonly personas?: readonly Persona[];
};

/**
 * A SurfaceBlueprint is a deterministic starter model for a Surface plus the
 * supporting Resources and Personas it needs. Blueprints must be structurally
 * valid and free of critical maturity defects, but domain-specific rules,
 * scenarios and permissions still require review after insertion. Treating a
 * generic template as 100% complete would create false confidence.
 *
 * The model treats blueprints as static specifications. They have no
 * lifecycle, only an identity (`id`) and a `build` factory. Concrete
 * implementations live in the infrastructure layer; the domain only knows
 * the shape.
 */
export type SurfaceBlueprint = {
  readonly id: BlueprintId;
  readonly name: string;
  readonly category: BlueprintCategory;
  /** Surface type the produced Surface uses. Drives the type filter in the
   *  library dialog so users can ask for "screens only", "modals only", etc. */
  readonly surfaceType: SurfaceType;
  /** One-line description shown on the library card. */
  readonly summary: string;
  /** Longer prose used in the dialog detail area. */
  readonly description: string;
  readonly platforms: readonly ('web' | 'mobile')[];
  /** Free-form tokens used by search. */
  readonly tags: readonly string[];
  /** Other blueprints this one expects to be applied alongside. Used so the
   *  library UI can offer "Add bundle" and so transitions resolve. May
   *  include cross-category ids (e.g. an auth blueprint listing a commerce
   *  cart so they wire up when both are imported). */
  readonly siblings?: readonly BlueprintId[];
  readonly build: (ctx: BlueprintBuildContext) => BlueprintBuildResult;
};
