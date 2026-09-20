import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import {
  actionStateReads,
  actionStateWrites,
  conditionStateReads,
  effectStateReads,
  effectStateWrites
} from './BehaviorSemantics';
import { stable } from './FeatureElementVersions';

/**
 * What a change to one feature touches in the OTHER features of its project.
 *
 * State paths are the seam between features: a path is a name, not a scope, so
 * `species.mix` declared in one feature is the same state another feature reads
 * in a rule and writes in an action. Changing a species mix moved an action and
 * two scenarios of a feature nobody had opened, and the only way to find them
 * was to grep a dump of the project.
 *
 * So a batch now says it, from the paths its change involves. Advisory and
 * nothing else: it names what deserves a look, never blocks a batch and never
 * moves `ok`. A shared path is legitimate modelling, not an error.
 *
 * Pure: two versions of the focal feature and the sibling features in, a report
 * out. The traversal is not written here. Reads and writes come from
 * BehaviorSemantics, the canonical walker the neighborhood graph and the
 * maturity scorer already agree on, so a path buried in a list mutation or a
 * rule-carried effect is found here exactly as it is there.
 */
export type RelatedElementKind = 'action' | 'surface_rule' | 'surface_invariant' | 'invariant';

export type RelatedElement = {
  readonly kind: RelatedElementKind;
  readonly id: string;
  readonly name: string;
};

export type RelatedFeature = {
  readonly featureId: string;
  readonly featureName: string;
  /** True when this feature declares a state definition at that path. */
  readonly declares: boolean;
  readonly readBy: readonly RelatedElement[];
  readonly writtenBy: readonly RelatedElement[];
};

export type RelatedStatePath = {
  readonly path: string;
  readonly features: readonly RelatedFeature[];
};

export type RelatedElsewhere = {
  readonly statePaths: readonly RelatedStatePath[];
  /** True when any cap below dropped something from the answer. */
  readonly truncated?: boolean;
};

/**
 * The answer is a pointer, not an inventory: past these sizes a reader stops
 * reading and runs find_state_references on the path that matters.
 */
export const MAX_RELATED_PATHS = 20;
export const MAX_RELATED_FEATURES_PER_PATH = 10;
export const MAX_RELATED_ROWS = 10;

const stateDefinitionsByPath = (feature: Feature): ReadonlyMap<string, string> =>
  new Map(
    (feature.surfaces ?? []).flatMap((surface) =>
      (surface.stateDefinitions ?? []).map((def) => [String(def.path), stable(def)] as const)
    )
  );

const actionsById = (feature: Feature): ReadonlyMap<string, Action> =>
  new Map(
    (feature.surfaces ?? []).flatMap((surface) =>
      (surface.actions ?? []).map((action) => [String(action.id), action] as const)
    )
  );

/** Every path an action depends on: what it requires, what it reads, what it writes. */
const pathsOfAction = (action: Action): readonly string[] => [
  ...(action.requiredStates ?? []).map(String),
  ...actionStateReads(action).map(String),
  ...actionStateWrites(action).map(String)
];

/**
 * The state paths a change involves: the paths of state definitions it added,
 * changed or removed, and the paths the actions it touched read or write.
 *
 * Derived from the two features the way ScenarioScope derives its own scope, by
 * diffing them rather than by reading the operations: an op kind added later
 * cannot slip past a diff, and an edit a later op in the same batch undid is
 * correctly nobody's business. An action counts as touched when anything it
 * owns differs, so a rule edit carries the action's paths; a changed action
 * contributes what it used to touch as well, since a rule that STOPPED reading
 * a path is exactly as interesting to its neighbours as one that started.
 */
export const statePathsOfChange = (before: Feature, after: Feature): readonly string[] => {
  const paths = new Set<string>();
  const beforeStates = stateDefinitionsByPath(before);
  const afterStates = stateDefinitionsByPath(after);
  for (const [path, digest] of afterStates) {
    if (beforeStates.get(path) !== digest) paths.add(path);
  }
  for (const path of beforeStates.keys()) {
    if (!afterStates.has(path)) paths.add(path);
  }

  const beforeActions = actionsById(before);
  const afterActions = actionsById(after);
  for (const [id, action] of afterActions) {
    const was = beforeActions.get(id);
    if (was !== undefined && stable(was) === stable(action)) continue;
    for (const path of pathsOfAction(action)) paths.add(path);
    if (was) for (const path of pathsOfAction(was)) paths.add(path);
  }
  for (const [id, was] of beforeActions) {
    if (!afterActions.has(id)) for (const path of pathsOfAction(was)) paths.add(path);
  }
  return [...paths];
};

type Bucket = {
  declares: boolean;
  readonly readBy: RelatedElement[];
  readonly writtenBy: RelatedElement[];
};

/**
 * One pass over a feature, collecting only the paths asked for. Per feature and
 * not per path: a project with forty features and twenty paths is one walk each,
 * not eight hundred.
 */
const bucketsOf = (feature: Feature, wanted: ReadonlySet<string>): ReadonlyMap<string, Bucket> => {
  const buckets = new Map<string, Bucket>();
  const bucket = (path: string): Bucket | null => {
    if (!wanted.has(path)) return null;
    const existing = buckets.get(path);
    if (existing) return existing;
    const created: Bucket = { declares: false, readBy: [], writtenBy: [] };
    buckets.set(path, created);
    return created;
  };
  const record = (
    paths: readonly { toString(): string }[],
    list: (b: Bucket) => RelatedElement[],
    element: RelatedElement
  ): void => {
    for (const raw of paths) {
      const target = bucket(String(raw));
      if (!target) continue;
      const rows = list(target);
      if (rows.some((row) => row.kind === element.kind && row.id === element.id)) continue;
      rows.push(element);
    }
  };

  for (const surface of feature.surfaces ?? []) {
    for (const def of surface.stateDefinitions ?? []) {
      const target = bucket(String(def.path));
      if (target) target.declares = true;
    }
    for (const action of surface.actions ?? []) {
      const element: RelatedElement = {
        kind: 'action',
        id: String(action.id),
        name: action.name
      };
      record(
        [...(action.requiredStates ?? []), ...actionStateReads(action)],
        (b) => b.readBy,
        element
      );
      record(actionStateWrites(action), (b) => b.writtenBy, element);
    }
    for (const rule of surface.rules ?? []) {
      const element: RelatedElement = {
        kind: 'surface_rule',
        id: String(rule.id),
        // A rule's description is what a human reads it by, and it is optional.
        // Without one the row falls back to the id, the way an audit tag does,
        // so it still points somewhere.
        name: rule.description ?? String(rule.id)
      };
      record(
        [...conditionStateReads(rule.condition), ...effectStateReads(rule.effect)],
        (b) => b.readBy,
        element
      );
      record(effectStateWrites(rule.effect), (b) => b.writtenBy, element);
    }
    for (const invariant of surface.invariants ?? []) {
      record(conditionStateReads(invariant.condition), (b) => b.readBy, {
        kind: 'surface_invariant',
        id: String(invariant.id),
        name: invariant.name
      });
    }
  }
  for (const invariant of feature.featureInvariants ?? []) {
    record(conditionStateReads(invariant.condition), (b) => b.readBy, {
      kind: 'invariant',
      id: String(invariant.id),
      name: invariant.name
    });
  }
  return buckets;
};

/**
 * Where `paths` also live, among `siblings` (the other features of the owning
 * project). Returns null when nothing matches, so the caller omits the block
 * entirely rather than answering an empty one; a feature no project claims has
 * no siblings and lands here as null too.
 *
 * Takes the paths rather than the two features so a caller can ask what the
 * change involves BEFORE deciding to load the siblings: a batch that touches no
 * state path pays nothing, not even a read.
 */
export const relatedElsewhereForPaths = (
  paths: readonly string[],
  siblings: readonly Feature[]
): RelatedElsewhere | null => {
  if (paths.length === 0 || siblings.length === 0) return null;
  const wanted = new Set(paths);

  const byPath = new Map<string, RelatedFeature[]>();
  let truncated = false;
  for (const sibling of siblings) {
    for (const [path, bucket] of bucketsOf(sibling, wanted)) {
      if (!bucket.declares && bucket.readBy.length === 0 && bucket.writtenBy.length === 0) continue;
      const rows = byPath.get(path) ?? [];
      if (rows.length >= MAX_RELATED_FEATURES_PER_PATH) {
        truncated = true;
        continue;
      }
      if (bucket.readBy.length > MAX_RELATED_ROWS || bucket.writtenBy.length > MAX_RELATED_ROWS) {
        truncated = true;
      }
      rows.push({
        featureId: String(sibling.id),
        featureName: sibling.name,
        declares: bucket.declares,
        readBy: bucket.readBy.slice(0, MAX_RELATED_ROWS),
        writtenBy: bucket.writtenBy.slice(0, MAX_RELATED_ROWS)
      });
      byPath.set(path, rows);
    }
  }

  // Path order follows the change, so the path the author just edited reads first.
  const statePaths: RelatedStatePath[] = [];
  for (const path of paths) {
    const features = byPath.get(path);
    if (!features || features.length === 0) continue;
    if (statePaths.length >= MAX_RELATED_PATHS) {
      truncated = true;
      break;
    }
    statePaths.push({ path, features });
  }
  if (statePaths.length === 0) return null;
  return truncated ? { statePaths, truncated } : { statePaths };
};

/** The same, from the two versions of the focal feature. */
export const relatedElsewhereOfChange = (
  before: Feature,
  after: Feature,
  siblings: readonly Feature[]
): RelatedElsewhere | null =>
  relatedElsewhereForPaths(statePathsOfChange(before, after), siblings);
