import type { StateDefinition } from '../entities/StateDefinition';
import { readPath, splitPath, type StateSnapshot } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

export const buildInitialSnapshot = (
  definitions: readonly StateDefinition[]
): StateSnapshot => {
  // One object built in place, the same as writing each default in turn with
  // writePath but without copying the whole snapshot at every state (a project
  // of thousands of states spent seconds there). Only objects made here are
  // written into: a default that is itself an object is copied before a deeper
  // path is written inside it, exactly as writePath would.
  const root: { [k: string]: StateValue } = {};
  const made = new WeakSet<object>([root]);
  for (const def of definitions) {
    const segments = splitPath(def.path);
    if (segments.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as string;
      const existing = cursor[segment];
      let child: { [k: string]: StateValue };
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        child = made.has(existing) ? (existing as { [k: string]: StateValue }) : { ...(existing as StateSnapshot) };
      } else {
        child = {};
      }
      made.add(child);
      cursor[segment] = child;
      cursor = child;
    }
    cursor[segments[segments.length - 1] as string] = def.defaultValue;
  }
  return root;
};

/**
 * The declarations a run of one feature starts from when other features of its
 * project are seeded beside it: the feature's own first, then every other
 * feature's for a path not declared yet. The first declaration of a path wins,
 * so the feature being checked always starts from its own value, and a path two
 * other features declare starts from the first of them. The exploration, the
 * step-by-step simulation and the solver all start from this same state.
 */
export const startingDeclarations = (
  own: readonly StateDefinition[],
  others: readonly StateDefinition[] = []
): StateDefinition[] => {
  const seen = new Set<string>();
  const out: StateDefinition[] = [];
  for (const def of [...own, ...others]) {
    const path = String(def.path);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(def);
  }
  return out;
};

/**
 * A starting snapshot with the other features' state filled in: their
 * defaults, only for a path the checked feature does not declare and the
 * snapshot does not already set, following startingDeclarations. Used wherever
 * a project invariant may read another feature's state.
 */
export const seedOtherFeatureDefaults = (
  snapshot: StateSnapshot,
  own: readonly StateDefinition[],
  others: readonly StateDefinition[]
): StateSnapshot => {
  const ownPaths = new Set(own.map((def) => String(def.path)));
  return fillMissing(snapshot, startingDeclarations(own, others), (path) => ownPaths.has(path));
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
  return fillMissing(snapshot, definitions);
};

/**
 * Each declared path the snapshot lacks, set to its default: the same as
 * writing them one by one with writePath, built in place in one pass. A
 * write copied the whole root and every object on its path, so a project of
 * thousands of states spent seconds per scenario (and per step) here. Only
 * objects made here are written into; any other object on a path is copied
 * once before its first write, as writePath would. The snapshot itself is
 * never changed, and comes back as is when nothing was missing.
 */
const fillMissing = (
  snapshot: StateSnapshot,
  definitions: readonly StateDefinition[],
  skip?: (path: string) => boolean
): StateSnapshot => {
  let root: { [k: string]: StateValue } | null = null;
  const made = new WeakSet<object>();
  for (const def of definitions) {
    if (skip?.(String(def.path))) continue;
    if (readPath(root ?? snapshot, def.path) !== undefined) continue;
    const segments = splitPath(def.path);
    if (segments.length === 0) continue;
    if (!root) {
      root = { ...snapshot };
      made.add(root);
    }
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as string;
      const existing = cursor[segment];
      let child: { [k: string]: StateValue };
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        child = made.has(existing) ? (existing as { [k: string]: StateValue }) : { ...(existing as StateSnapshot) };
      } else {
        child = {};
      }
      made.add(child);
      cursor[segment] = child;
      cursor = child;
    }
    cursor[segments[segments.length - 1] as string] = def.defaultValue;
  }
  return root ?? snapshot;
};

export const cloneSnapshot = (snapshot: StateSnapshot): StateSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as StateSnapshot;
