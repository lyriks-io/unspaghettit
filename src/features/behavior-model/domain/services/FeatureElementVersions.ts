import type { Feature } from '$features/behavior-model/domain/entities/Feature';

/**
 * Per-element spec versions: when each part of a feature last actually changed.
 *
 * `feature.updatedAt` moves on ANY edit, which is why drift detection could only
 * ever say "something in this feature moved". That is enough to know a feature
 * deserves a second look, and useless for deciding what to build: a typo fixed
 * in one description marked every audited entity of the feature suspect.
 *
 * So every write stamps the elements it actually touched. The stamps live in ONE
 * optional map on the feature, keyed exactly like the `.unspa.json` index
 * (`"<type>:<id-or-path>"`), rather than as a field on every element type. That
 * keeps element shapes (and their validators, normalizers and scorers) untouched,
 * and makes the lookup from an index entry a single map read.
 *
 * Backward compatible in both directions:
 *  - a feature written before this exists has no map, and every reader falls
 *    back to `feature.updatedAt`, which is exactly today's behavior;
 *  - the first write after upgrading calibrates the whole feature, stamping
 *    untouched elements with the feature's own `updatedAt`. That is an upper
 *    bound on when they really changed, so the only error it can produce is the
 *    one the coarse signal already produced. Every later write makes it exact.
 */

/** `"<type>:<id-or-path>"`, the same key space as the behavioral index. */
export type ElementVersionKey = string;

/** Element key to ISO timestamp of the last change to that element. */
export type ElementVersions = Readonly<Record<ElementVersionKey, string>>;

/**
 * Index writers name the same concept two ways depending on where it hangs.
 * Drift resolution already accepts both, so the stamp lookup must too.
 */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  surface_rule: 'rule',
  surface_invariant: 'invariant',
  capability: 'action'
};

const canonicalType = (type: string): string => TYPE_ALIASES[type] ?? type;

/** Deterministic serialization: key order must never decide whether an element changed. */
const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
};

/** An element without the collections that carry keys of their own. */
const own = (element: unknown, ...childKeys: string[]): string => {
  const { ...rest } = (element ?? {}) as Record<string, unknown>;
  for (const key of childKeys) delete rest[key];
  return stable(rest);
};

/**
 * Every keyed element of a feature with a digest of its OWN content. Children
 * that hold their own key are excluded from a parent's digest, so editing a rule
 * moves the rule and nothing else. A scenario is a test of an action, not part
 * of its implementation, so it is keyed separately as well: adding one changes
 * what a story must assert without invalidating the code already mapped to the
 * action.
 */
export const elementDigests = (feature: Feature): ReadonlyMap<ElementVersionKey, string> => {
  const digests = new Map<ElementVersionKey, string>();
  const put = (type: string, id: unknown, digest: string) => {
    const suffix = String(id ?? '');
    if (suffix.length > 0) digests.set(`${type}:${suffix}`, digest);
  };

  for (const inv of feature.featureInvariants ?? []) put('invariant', inv.id, stable(inv));
  for (const event of feature.events ?? []) put('event', event.name, stable(event));
  for (const vs of feature.valueSets ?? []) put('valueSet', vs.id, stable(vs));
  for (const persona of feature.personas ?? []) put('persona', persona.id, stable(persona));
  for (const resource of feature.resources ?? []) put('resource', resource.id, stable(resource));
  for (const entity of feature.entities ?? []) put('entity', entity.id, stable(entity));

  for (const surface of feature.surfaces ?? []) {
    put(
      'surface',
      surface.id,
      own(surface, 'actions', 'rules', 'invariants', 'transitions', 'stateDefinitions')
    );
    for (const def of surface.stateDefinitions ?? []) put('state', def.path, stable(def));
    for (const rule of surface.rules ?? []) put('rule', rule.id, stable(rule));
    for (const inv of surface.invariants ?? []) put('invariant', inv.id, stable(inv));
    for (const transition of surface.transitions ?? []) put('transition', transition.id, stable(transition));
    for (const action of surface.actions ?? []) {
      put('action', action.id, own(action, 'rules', 'invariants', 'transitions', 'scenarios'));
      for (const rule of action.rules ?? []) put('rule', rule.id, stable(rule));
      for (const inv of action.invariants ?? []) put('invariant', inv.id, stable(inv));
      for (const transition of action.transitions ?? []) put('transition', transition.id, stable(transition));
      for (const scenario of action.scenarios ?? []) put('scenario', scenario.id, stable(scenario));
    }
  }

  return digests;
};

/**
 * The stamps `next` should carry, given what `previous` looked like and when the
 * write happened. Changed and new elements get `now`; untouched ones keep the
 * stamp they had, or inherit the feature's previous `updatedAt` when they have
 * none yet (the calibration pass described at the top of this file). Removed
 * elements drop out, so the map never outgrows the feature.
 */
export const nextElementVersions = (
  previous: Feature | null,
  next: Feature,
  now: string
): ElementVersions => {
  const before = previous ? elementDigests(previous) : new Map<string, string>();
  const carried = previous?.elementVersions ?? {};
  const fallback = previous?.updatedAt;
  const versions: Record<string, string> = {};

  for (const [key, digest] of elementDigests(next)) {
    const unchanged = before.get(key) === digest;
    const inherited = unchanged ? (carried[key] ?? fallback) : undefined;
    versions[key] = inherited ?? now;
  }
  return versions;
};

/** `next` with its element stamps recomputed against `previous`. */
export const stampElementVersions = (
  previous: Feature | null,
  next: Feature,
  now: string
): Feature => ({ ...next, elementVersions: nextElementVersions(previous, next, now) });

/**
 * When the element behind an index key last changed, or undefined when this
 * feature carries no stamp for it. Resolution mirrors drift's own key handling:
 * the exact type first, then its alias, then any element with that identifier
 * (an index written with a type this vocabulary does not name still resolves).
 */
export const elementVersionOf = (
  feature: Feature,
  key: ElementVersionKey
): string | undefined => {
  const versions = feature.elementVersions;
  if (!versions) return undefined;
  const direct = versions[key];
  if (direct) return direct;

  const sep = key.indexOf(':');
  if (sep < 0) return undefined;
  const suffix = key.slice(sep + 1);
  const aliased = versions[`${canonicalType(key.slice(0, sep))}:${suffix}`];
  if (aliased) return aliased;

  const tail = `:${suffix}`;
  for (const [candidate, stamp] of Object.entries(versions)) {
    if (candidate.endsWith(tail)) return stamp;
  }
  return undefined;
};
