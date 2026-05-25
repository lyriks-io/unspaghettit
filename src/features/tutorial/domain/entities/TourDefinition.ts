import type { TourStep } from './TourStep';

/**
 * Aggregate root for an interactive guided tour. Walks the user through
 * producing a specific outcome in the real app (creating a feature,
 * adding a surface, running a scenario), with the side panel always
 * visible and the next target highlighted.
 *
 * Aggregate boundary: a TourDefinition owns its `steps`. The engine
 * progresses through them in declared order; there are no branches or
 * jumps in this model. Adding non-linear flows would mean evolving the
 * aggregate (e.g. adjacency list of step ids).
 */
export type TourDefinition = {
  readonly id: string;
  readonly name: string;
  /** One-paragraph elevator pitch shown when the user starts the tour. */
  readonly summary: string;
  readonly steps: readonly TourStep[];
};
