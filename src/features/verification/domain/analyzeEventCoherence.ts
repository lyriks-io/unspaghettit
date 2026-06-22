import { isEvolution } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { EventCoherenceReport, EventHandlerFinding } from './EventCoherenceReport';

/**
 * Pure cross-feature event-coherence analysis. Collects every event emitted
 * anywhere in the cohort, then flags every handler whose triggering event is in
 * nobody's emit set. Evolution placeholders (empty bodies) are ignored on both
 * sides — they aren't committed behavior yet.
 */
export const analyzeEventCoherence = (features: readonly Feature[]): EventCoherenceReport => {
  const emitted = new Set<string>();
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const action of surface.actions) {
        if (isEvolution(action)) continue;
        for (const event of action.emittedEvents) emitted.add(String(event));
      }
    }
  }

  const deadHandlers: EventHandlerFinding[] = [];
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const action of surface.actions) {
        if (isEvolution(action)) continue;
        const trigger = action.triggeredByEvent;
        if (trigger && !emitted.has(String(trigger))) {
          deadHandlers.push({
            featureId: String(feature.id),
            featureName: feature.name,
            surfaceId: String(surface.id),
            actionId: String(action.id),
            actionName: action.name,
            event: String(trigger)
          });
        }
      }
    }
  }

  return { deadHandlers };
};
