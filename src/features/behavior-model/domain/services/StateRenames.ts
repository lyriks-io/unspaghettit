import type { Feature } from '$features/behavior-model/domain/entities/Feature';

/**
 * Where an implementation index key on a renamed state path should go now.
 *
 * The index keys a state by its path (`state:<path>`), so renaming the path
 * leaves the entry pointing at nothing. The definition keeps the paths it left
 * behind (`previousPaths`), which is enough to tell the caller the key to
 * migrate to instead of calling the entry an orphan with no explanation.
 *
 * Answers old key to the current keys, sorted: a path shared across features
 * can have been renamed differently in each of them, and all of them are
 * reported rather than one picked at random. A path that is current somewhere
 * is never listed, since that key still resolves.
 */
export const stateRenameTargets = (
  features: readonly Feature[]
): ReadonlyMap<string, readonly string[]> => {
  const current = new Set<string>();
  const targets = new Map<string, Set<string>>();
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const def of surface.stateDefinitions) {
        const to = `state:${String(def.path)}`;
        current.add(to);
        for (const previous of def.previousPaths ?? []) {
          const from = `state:${String(previous)}`;
          const set = targets.get(from) ?? new Set<string>();
          set.add(to);
          targets.set(from, set);
        }
      }
    }
  }
  const out = new Map<string, readonly string[]>();
  for (const [from, to] of targets) {
    if (!current.has(from)) out.set(from, [...to].sort());
  }
  return out;
};

/**
 * Current state keys that look like the one a stale `state:<path>` key meant,
 * for when no rename was recorded (a rename made before the history existed, or
 * one the host did not keep). Same last segment first (`tide.level` moved under
 * another parent), then same parent (`tide.level` reworded to `tide.height`).
 * A guess to check, never a mapping: at most `limit` keys, sorted.
 */
export const closestStateKeys = (
  staleKey: string,
  currentKeys: Iterable<string>,
  limit = 3
): readonly string[] => {
  const path = staleKey.startsWith('state:') ? staleKey.slice('state:'.length) : staleKey;
  const dot = path.lastIndexOf('.');
  const last = path.slice(dot + 1);
  const parent = dot >= 0 ? path.slice(0, dot) : null;
  const sameLast: string[] = [];
  const sameParent: string[] = [];
  for (const key of currentKeys) {
    if (!key.startsWith('state:') || key === staleKey) continue;
    const other = key.slice('state:'.length);
    const otherDot = other.lastIndexOf('.');
    if (other.slice(otherDot + 1) === last) sameLast.push(key);
    else if (parent !== null && otherDot >= 0 && other.slice(0, otherDot) === parent) {
      sameParent.push(key);
    }
  }
  return [...sameLast.sort(), ...sameParent.sort()].slice(0, limit);
};
