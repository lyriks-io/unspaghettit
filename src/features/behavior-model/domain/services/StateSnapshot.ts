import type { StateDefinition } from '../entities/StateDefinition';
import { readPath, writePath, type StateSnapshot } from '../value-objects/StatePath';

export const buildInitialSnapshot = (
  definitions: readonly StateDefinition[]
): StateSnapshot => {
  let snapshot: StateSnapshot = {};
  for (const def of definitions) {
    snapshot = writePath(snapshot, def.path, def.defaultValue);
  }
  return snapshot;
};

/**
 * Fill paths declared in `definitions` that are missing from `snapshot` with
 * their `defaultValue`. Existing values (including `null`) are preserved.
 * Used by the simulator so callers may pass partial snapshots without
 * triggering invariant/condition failures on undefined paths.
 */
export const mergeSnapshotWithDefaults = (
  snapshot: StateSnapshot,
  definitions: readonly StateDefinition[]
): StateSnapshot => {
  let result = snapshot;
  for (const def of definitions) {
    if (readPath(result, def.path) !== undefined) continue;
    result = writePath(result, def.path, def.defaultValue);
  }
  return result;
};

export const cloneSnapshot = (snapshot: StateSnapshot): StateSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as StateSnapshot;
