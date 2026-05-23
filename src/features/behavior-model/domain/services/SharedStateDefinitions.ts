import type { Feature } from '../entities/Feature';
import type { StateDefinition } from '../entities/StateDefinition';
import type { Surface } from '../entities/Surface';

export const getStateDefinitionsForSurface = (
  feature: Feature,
  surface: Surface
): readonly StateDefinition[] => {
  const byPath = new Map<string, StateDefinition>();
  for (const def of surface.stateDefinitions) {
    byPath.set(String(def.path), def);
  }

  for (const other of feature.surfaces) {
    if (other.id === surface.id) continue;
    for (const def of other.stateDefinitions) {
      if (!def.sharedWith?.includes(surface.id)) continue;
      const path = String(def.path);
      if (!byPath.has(path)) byPath.set(path, def);
    }
  }

  return [...byPath.values()];
};

export const withSharedStateDefinitions = (
  feature: Feature,
  surface: Surface
): Surface => ({
  ...surface,
  stateDefinitions: getStateDefinitionsForSurface(feature, surface)
});
