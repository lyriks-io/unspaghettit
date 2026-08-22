import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { elementVersionOf } from '$features/behavior-model/domain/services/FeatureElementVersions';
import type { DriftEntry, DriftReport, OrphanEntry } from './DriftReport';
import type { IndexedImplementation } from './IndexedImplementation';

/**
 * Spec→code drift detection. Given the features of a project and the audited
 * entries of its `.unspa.json` index, find every entry whose owning feature has
 * been edited since the entry was last audited — meaning the implementation was
 * mapped against an older spec and is now suspect.
 *
 * Resolution is per ELEMENT when the feature carries element stamps (see
 * FeatureElementVersions): a changed rule marks that rule's entry stale and
 * leaves its neighbours alone, and each stale entry reports `scope: "element"`.
 * A snapshot written before those stamps existed, or an element that has never
 * been stamped, falls back to `feature.updatedAt`, which moves on ANY edit and
 * therefore implicates every audited entity of the feature. Those entries report
 * `scope: "feature"`, so a reader can tell evidence from association.
 *
 * Pure: no clock, no I/O. Comparison is by parsed timestamp so format quirks
 * (trailing Z, millis) don't produce false positives; an unparseable stamp is
 * reported as unversioned rather than guessed.
 */

/** Per-feature identifier sets, grouped by entity kind so key resolution is type-aware. */
type IdentifierSets = {
  readonly surfaceIds: ReadonlySet<string>;
  readonly actionIds: ReadonlySet<string>;
  readonly statePaths: ReadonlySet<string>;
  readonly ruleIds: ReadonlySet<string>;
  readonly invariantIds: ReadonlySet<string>;
  readonly transitionIds: ReadonlySet<string>;
  readonly eventNames: ReadonlySet<string>;
  /** Personas, resources, entities, value sets — keyed by id for the generic fallback. */
  readonly otherIds: ReadonlySet<string>;
};

const buildIdentifierSets = (feature: Feature): IdentifierSets => {
  const surfaceIds = new Set<string>();
  const actionIds = new Set<string>();
  const statePaths = new Set<string>();
  const ruleIds = new Set<string>();
  const invariantIds = new Set<string>();
  const transitionIds = new Set<string>();
  const eventNames = new Set<string>();
  const otherIds = new Set<string>();

  for (const inv of feature.featureInvariants ?? []) invariantIds.add(String(inv.id));
  for (const event of feature.events ?? []) eventNames.add(String(event.name));
  for (const vs of feature.valueSets ?? []) otherIds.add(String(vs.id));
  for (const persona of feature.personas ?? []) otherIds.add(String(persona.id));
  for (const resource of feature.resources ?? []) otherIds.add(String(resource.id));
  for (const entity of feature.entities ?? []) otherIds.add(String(entity.id));

  for (const surface of feature.surfaces) {
    surfaceIds.add(String(surface.id));
    for (const transition of surface.transitions) transitionIds.add(String(transition.id));
    for (const rule of surface.rules) ruleIds.add(String(rule.id));
    for (const inv of surface.invariants) invariantIds.add(String(inv.id));
    for (const def of surface.stateDefinitions) statePaths.add(String(def.path));
    for (const action of surface.actions) {
      actionIds.add(String(action.id));
      for (const rule of action.rules) ruleIds.add(String(rule.id));
      for (const inv of action.invariants) invariantIds.add(String(inv.id));
      for (const transition of action.transitions) transitionIds.add(String(transition.id));
    }
  }

  return {
    surfaceIds,
    actionIds,
    statePaths,
    ruleIds,
    invariantIds,
    transitionIds,
    eventNames,
    otherIds
  };
};

/** Whether `suffix` names an entity of `type` in this feature. Unknown types fall back to any-kind. */
const owns = (sets: IdentifierSets, type: string, suffix: string): boolean => {
  switch (type) {
    case 'surface':
      return sets.surfaceIds.has(suffix);
    case 'action':
      return sets.actionIds.has(suffix);
    case 'state':
      return sets.statePaths.has(suffix);
    case 'event':
      return sets.eventNames.has(suffix);
    case 'rule':
    case 'surface_rule':
      return sets.ruleIds.has(suffix);
    case 'invariant':
    case 'surface_invariant':
      return sets.invariantIds.has(suffix);
    case 'transition':
      return sets.transitionIds.has(suffix);
    default:
      return (
        sets.surfaceIds.has(suffix) ||
        sets.actionIds.has(suffix) ||
        sets.statePaths.has(suffix) ||
        sets.eventNames.has(suffix) ||
        sets.ruleIds.has(suffix) ||
        sets.invariantIds.has(suffix) ||
        sets.transitionIds.has(suffix) ||
        sets.otherIds.has(suffix)
      );
  }
};

export const detectDrift = (
  features: readonly Feature[],
  index: readonly IndexedImplementation[]
): DriftReport => {
  const owners = features.map((feature) => ({ feature, sets: buildIdentifierSets(feature) }));

  const stale: DriftEntry[] = [];
  const unversioned: string[] = [];
  const orphans: OrphanEntry[] = [];
  let checked = 0;

  for (const entry of index) {
    // A 'missing' entry maps nothing to code yet, so it can't have drifted.
    if (entry.status === 'missing') continue;

    const sep = entry.key.indexOf(':');
    if (sep < 0) {
      orphans.push({ key: entry.key, reason: 'malformed key (expected "<type>:<id-or-path>")' });
      continue;
    }
    const type = entry.key.slice(0, sep);
    const suffix = entry.key.slice(sep + 1);

    const owner = owners.find((o) => owns(o.sets, type, suffix));
    if (!owner) {
      orphans.push({ key: entry.key, reason: 'no spec entity matches this key (renamed or removed?)' });
      continue;
    }

    checked += 1;
    if (!entry.auditedSpecVersion) {
      unversioned.push(entry.key);
      continue;
    }

    // The element's own stamp when the feature carries one, so an edit to a
    // neighbouring rule stops implicating this entry. Falls back to the
    // feature-wide stamp for snapshots written before per-element versions.
    const elementVersion = elementVersionOf(owner.feature, entry.key);
    const currentVersion = elementVersion ?? String(owner.feature.updatedAt);
    const audited = Date.parse(entry.auditedSpecVersion);
    const current = Date.parse(currentVersion);
    if (Number.isNaN(audited) || Number.isNaN(current)) {
      unversioned.push(entry.key);
      continue;
    }

    if (current > audited) {
      stale.push({
        key: entry.key,
        entitySuffix: suffix,
        featureId: String(owner.feature.id),
        featureName: owner.feature.name,
        status: entry.status,
        auditedSpecVersion: entry.auditedSpecVersion,
        currentSpecVersion: currentVersion,
        scope: elementVersion ? 'element' : 'feature'
      });
    }
  }

  return { stale, unversioned, orphans, checked };
};
