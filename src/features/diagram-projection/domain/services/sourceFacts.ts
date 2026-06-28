import type { ProjectionSource } from '../ports/Projector';

/**
 * Read-only facts about the source model that drive the viewer's gating and
 * empty states. Mirrors the `source.*` state paths in the feature spec.
 */
export type SourceFacts = {
  /** A feature or project is open as the projection source. */
  readonly loaded: boolean;
  /** The model declares at least one surface transition (drives the statechart). */
  readonly hasTransitions: boolean;
  /** The model declares at least one entity (drives the ER diagram). */
  readonly hasEntities: boolean;
};

export const sourceFacts = ({ features }: ProjectionSource): SourceFacts => {
  const hasTransitions = features.some((feature) =>
    feature.surfaces.some(
      (surface) =>
        surface.transitions.length > 0 ||
        surface.actions.some(
          (action) =>
            action.transitions.length > 0 ||
            [...action.effects, ...(action.onBlockedEffects ?? [])].some(
              (effect) => effect.type === 'transition_surface'
            )
        )
    )
  );
  const hasEntities = features.some((feature) => feature.entities.length > 0);
  return { loaded: features.length > 0, hasTransitions, hasEntities };
};
