import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Transition } from '$features/behavior-model/domain/entities/Transition';
import type {
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

export type FocusedSurfaceIndex = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly surfaceId: SurfaceId;
  readonly surface: {
    readonly id: SurfaceId;
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly stateCount: number;
    readonly ruleCount: number;
    readonly invariantCount: number;
    readonly transitionCount: number;
    readonly actions: readonly { readonly id: string; readonly name: string }[];
  };
};

export type FocusedSurfaceVerbose = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly surface: Surface;
};

const indexEntry = (
  feature: Feature,
  surface: Surface
): FocusedSurfaceIndex => ({
  featureId: feature.id,
  featureName: feature.name,
  surfaceId: surface.id,
  surface: {
    id: surface.id,
    name: surface.name,
    type: surface.type,
    ...(surface.description ? { description: surface.description } : {}),
    stateCount: surface.stateDefinitions.length,
    ruleCount: surface.rules.length,
    invariantCount: surface.invariants.length,
    transitionCount: surface.transitions.length,
    actions: surface.actions.map((c: Action) => ({
      id: String(c.id),
      name: c.name
    }))
  }
});

const verboseEntry = (
  feature: Feature,
  surface: Surface
): FocusedSurfaceVerbose => ({
  featureId: feature.id,
  featureName: feature.name,
  surface
});

/**
 * Return one surface in either compact (index) or verbose (full nested
 * actions/rules/effects/state defs/invariants/transitions) shape. The
 * verbose shape is a focused alternative to get_feature(verbose:true)
 * for callers that only want one surface's internals.
 */
export const getSurfaceTool = (
  feature: Feature,
  surfaceId: SurfaceId,
  verbose: boolean
): FocusedSurfaceIndex | FocusedSurfaceVerbose | null => {
  const surface = feature.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return null;
  return verbose ? verboseEntry(feature, surface) : indexEntry(feature, surface);
};

// Re-export entity types so external callers don't need to chase the
// behavior-model package layout when typing tool results.
export type { Action, Invariant, Rule, StateDefinition, Surface, Transition };
