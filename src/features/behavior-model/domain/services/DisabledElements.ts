import type { Action } from '../entities/Action';
import type { Disabled } from '../entities/Disabled';
import type { Feature } from '../entities/Feature';
import type { Invariant } from '../entities/Invariant';
import type { ReachabilityGoal } from '../entities/ReachabilityGoal';
import type { Rule } from '../entities/Rule';
import type { Scenario } from '../entities/Scenario';
import type { Surface } from '../entities/Surface';

/**
 * Disabling an element: it stays in the model under its id, readable, and
 * every reading of the engine leaves it out. Pure: the marker is a field of the
 * element, and the operative model (what every reading takes) is derived here,
 * in one place, so no reading can forget it.
 *
 * What can be disabled: the feature itself, an action, a rule (of an action or
 * of a surface), an always-true statement (an invariant of an action, a surface
 * or the feature), a scenario and a reachability goal. Disabling an action or
 * the feature disables what it holds.
 */

export type DisableableKind = 'feature' | 'action' | 'rule' | 'invariant' | 'scenario' | 'reachability_goal';

/** The refusals, in the words the specification gives them. */
export const DISABLE_REFUSALS = {
  unknown: (id: string): string => `No element of this feature has that id: ${id}`,
  noReason: 'Say why the element is disabled.',
  disabledAlready: 'This element is disabled already.',
  enabledAlready: 'This element is enabled already.'
} as const;

/** A disabled element as the readings count it apart: its own marker, or the one of what holds it. */
export type DisabledElement = {
  readonly kind: DisableableKind;
  readonly id: string;
  readonly name: string;
  readonly disabled: Disabled;
  /** Set when the element has no marker of its own and is disabled with the action or feature holding it. */
  readonly heldBy?: { readonly kind: 'feature' | 'action'; readonly id: string };
};

type Marked = { readonly disabled?: Disabled };

const isDisabled = (element: Marked | undefined): boolean => element?.disabled !== undefined;

const withMarker = <T extends Marked>(element: T, marker: Disabled | null): T => {
  if (marker) return { ...element, disabled: marker };
  const { disabled: _removed, ...rest } = element;
  return rest as T;
};

type Update = <T extends Marked>(element: T) => T;

/** Replace the one element of the list whose id is `id`; null when none is. */
const mapOne = <T extends Marked & { readonly id: unknown }>(
  list: readonly T[] | undefined,
  id: string,
  update: Update
): readonly T[] | null => {
  if (!list) return null;
  const at = list.findIndex((e) => String(e.id) === id);
  if (at < 0) return null;
  return list.map((e, i) => (i === at ? update(e) : e));
};

const mapInAction = (action: Action, id: string, update: Update): Action | null => {
  if (String(action.id) === id) return update(action);
  const rules = mapOne(action.rules, id, update);
  if (rules) return { ...action, rules: rules as readonly Rule[] };
  const invariants = mapOne(action.invariants, id, update);
  if (invariants) return { ...action, invariants: invariants as readonly Invariant[] };
  const scenarios = mapOne(action.scenarios, id, update);
  if (scenarios) return { ...action, scenarios: scenarios as readonly Scenario[] };
  return null;
};

const mapInSurface = (surface: Surface, id: string, update: Update): Surface | null => {
  const rules = mapOne(surface.rules, id, update);
  if (rules) return { ...surface, rules: rules as readonly Rule[] };
  const invariants = mapOne(surface.invariants, id, update);
  if (invariants) return { ...surface, invariants: invariants as readonly Invariant[] };
  for (let i = 0; i < surface.actions.length; i += 1) {
    const next = mapInAction(surface.actions[i]!, id, update);
    if (next) return { ...surface, actions: surface.actions.map((a, j) => (j === i ? next : a)) };
  }
  return null;
};

/** The feature with the element named `id` passed through `update`; null when the feature holds no such element. */
const mapElement = (feature: Feature, id: string, update: Update): Feature | null => {
  if (String(feature.id) === id) return update(feature);
  const invariants = mapOne(feature.featureInvariants, id, update);
  if (invariants) return { ...feature, featureInvariants: invariants as readonly Invariant[] };
  const goals = mapOne(feature.reachabilityGoals, id, update);
  if (goals) return { ...feature, reachabilityGoals: goals as readonly ReachabilityGoal[] };
  for (let i = 0; i < feature.surfaces.length; i += 1) {
    const next = mapInSurface(feature.surfaces[i]!, id, update);
    if (next) return { ...feature, surfaces: feature.surfaces.map((s, j) => (j === i ? next : s)) };
  }
  return null;
};

/** The element named `id`, as the marker sees it; null when the feature holds none it can disable. */
export const disableableElement = (feature: Feature, id: string): Marked | null => {
  let found: Marked | null = null;
  mapElement(feature, id, (element) => {
    found = element;
    return element;
  });
  return found;
};

/**
 * Disable one element. Refused, changing nothing, when the reason is empty,
 * when the feature holds no such element, or when it is disabled already: a
 * second marker would overwrite who disabled it, when and why.
 */
export const disableElement = (feature: Feature, id: string, marker: Disabled): Feature => {
  if (marker.reason.trim() === '') throw new Error(DISABLE_REFUSALS.noReason);
  const element = disableableElement(feature, id);
  if (!element) throw new Error(DISABLE_REFUSALS.unknown(id));
  if (isDisabled(element)) throw new Error(DISABLE_REFUSALS.disabledAlready);
  return mapElement(feature, id, (e) => withMarker(e, { ...marker, reason: marker.reason.trim() }))!;
};

/** Enable one element again, as it was, under its id. Refused, changing nothing, when it is in force. */
export const enableElement = (feature: Feature, id: string): Feature => {
  const element = disableableElement(feature, id);
  if (!element) throw new Error(DISABLE_REFUSALS.unknown(id));
  if (!isDisabled(element)) throw new Error(DISABLE_REFUSALS.enabledAlready);
  return mapElement(feature, id, (e) => withMarker(e, null))!;
};

/**
 * Disable elements for one trial, in memory: what simulate_steps does with its
 * `disable` list. An id the feature does not hold refuses the trial with that
 * id; one disabled already simply stays so.
 */
export const disableInMemory = (feature: Feature, ids: readonly string[], marker: Disabled): Feature => {
  let next = feature;
  for (const id of ids) {
    const element = disableableElement(next, id);
    if (!element) throw new Error(DISABLE_REFUSALS.unknown(id));
    if (!isDisabled(element)) next = mapElement(next, id, (e) => withMarker(e, marker))!;
  }
  return next;
};

const operativeAction = (action: Action): Action => ({
  ...action,
  rules: action.rules.filter((r) => !isDisabled(r)),
  invariants: action.invariants.filter((i) => !isDisabled(i)),
  ...(action.scenarios ? { scenarios: action.scenarios.filter((s) => !isDisabled(s)) } : {})
});

/**
 * A scenario that replays a disabled action as one of its steps cannot run
 * without it: it is left out with that action.
 */
const replaysAny = (scenario: Scenario, actionIds: ReadonlySet<string>): boolean =>
  (scenario.steps ?? []).some((step) => actionIds.has(String(step.actionId)));

/**
 * The operative model: the feature as every reading takes it, without its
 * disabled elements and what a disabled action or feature holds. The ONE place
 * readings filter disabled elements; a model with none comes back unchanged.
 */
export const operativeFeature = (feature: Feature): Feature => {
  if (isDisabled(feature)) {
    return {
      ...feature,
      surfaces: feature.surfaces.map((s) => ({ ...s, actions: [], rules: [], invariants: [] })),
      featureInvariants: [],
      reachabilityGoals: []
    };
  }
  if (disabledElements(feature).length === 0) return feature;
  const offActions = new Set(
    feature.surfaces.flatMap((s) => s.actions.filter(isDisabled).map((a) => String(a.id)))
  );
  return {
    ...feature,
    surfaces: feature.surfaces.map((surface) => ({
      ...surface,
      rules: surface.rules.filter((r) => !isDisabled(r)),
      invariants: surface.invariants.filter((i) => !isDisabled(i)),
      actions: surface.actions
        .filter((a) => !isDisabled(a))
        .map(operativeAction)
        .map((a) =>
          a.scenarios && offActions.size > 0
            ? { ...a, scenarios: a.scenarios.filter((s) => !replaysAny(s, offActions)) }
            : a
        )
    })),
    ...(feature.featureInvariants
      ? { featureInvariants: feature.featureInvariants.filter((i) => !isDisabled(i)) }
      : {}),
    ...(feature.reachabilityGoals
      ? { reachabilityGoals: feature.reachabilityGoals.filter((g) => !isDisabled(g)) }
      : {})
  };
};

/**
 * Every disabled element of the feature, the ones disabled on their own and
 * the ones a disabled action or feature holds, so a reading can count them
 * apart instead of reading them as absent.
 */
export const disabledElements = (feature: Feature): readonly DisabledElement[] => {
  const out: DisabledElement[] = [];
  const featureHolder = feature.disabled ? { kind: 'feature' as const, id: String(feature.id) } : null;
  const put = (
    kind: DisableableKind,
    element: Marked & { readonly id: unknown },
    name: string,
    holder: { readonly marker: Disabled; readonly ref: DisabledElement['heldBy'] } | null
  ) => {
    if (element.disabled) out.push({ kind, id: String(element.id), name, disabled: element.disabled });
    else if (holder) out.push({ kind, id: String(element.id), name, disabled: holder.marker, heldBy: holder.ref });
  };
  const byFeature = feature.disabled ? { marker: feature.disabled, ref: featureHolder! } : null;
  if (feature.disabled) out.push({ kind: 'feature', id: String(feature.id), name: feature.name, disabled: feature.disabled });
  for (const inv of feature.featureInvariants ?? []) put('invariant', inv, inv.name, byFeature);
  for (const goal of feature.reachabilityGoals ?? []) put('reachability_goal', goal, goal.name, byFeature);
  for (const surface of feature.surfaces) {
    for (const rule of surface.rules) put('rule', rule, rule.description ?? String(rule.id), byFeature);
    for (const inv of surface.invariants) put('invariant', inv, inv.name, byFeature);
    for (const action of surface.actions) {
      put('action', action, action.name, byFeature);
      const holder = action.disabled
        ? { marker: action.disabled, ref: { kind: 'action' as const, id: String(action.id) } }
        : byFeature;
      for (const rule of action.rules) put('rule', rule, rule.description ?? String(rule.id), holder);
      for (const inv of action.invariants) put('invariant', inv, inv.name, holder);
      for (const scenario of action.scenarios ?? []) put('scenario', scenario, scenario.name, holder);
    }
  }
  return out;
};

/** How many disabled elements of each kind the feature holds, the ones held by a disabled holder included. */
export const disabledCounts = (
  feature: Feature
): Readonly<Record<DisableableKind, number>> & { readonly total: number } => {
  const counts: Record<DisableableKind, number> = {
    feature: 0,
    action: 0,
    rule: 0,
    invariant: 0,
    scenario: 0,
    reachability_goal: 0
  };
  const all = disabledElements(feature);
  for (const e of all) counts[e.kind] += 1;
  return { ...counts, total: all.length };
};

/**
 * The implementation-index keys of everything disabled, so the gaps, the
 * status and the drift read it disabled, neither missing nor drifting. An
 * action's transitions and events go with it; a disabled feature takes every
 * key it holds, its screens and states included.
 */
export const disabledIndexKeys = (feature: Feature): ReadonlySet<string> => {
  const keys = new Set<string>();
  const offFeature = isDisabled(feature);
  for (const inv of feature.featureInvariants ?? []) if (offFeature || isDisabled(inv)) keys.add(`invariant:${inv.id}`);
  for (const surface of feature.surfaces) {
    if (offFeature) {
      keys.add(`surface:${surface.id}`);
      for (const state of surface.stateDefinitions) keys.add(`state:${state.path}`);
      for (const t of surface.transitions ?? []) keys.add(`transition:${t.id}`);
    }
    for (const rule of surface.rules) if (offFeature || isDisabled(rule)) keys.add(`surface_rule:${rule.id}`);
    for (const inv of surface.invariants) if (offFeature || isDisabled(inv)) keys.add(`surface_invariant:${inv.id}`);
    for (const action of surface.actions) {
      const off = offFeature || isDisabled(action);
      if (off) {
        keys.add(`action:${action.id}`);
        for (const t of action.transitions) keys.add(`transition:${t.id}`);
        for (const e of action.exposures ?? []) keys.add(`exposure:${e.id}`);
      }
      for (const rule of action.rules) if (off || isDisabled(rule)) keys.add(`rule:${rule.id}`);
      for (const inv of action.invariants) if (off || isDisabled(inv)) keys.add(`invariant:${inv.id}`);
    }
  }
  if (offFeature) for (const event of feature.events ?? []) keys.add(`event:${event.name}`);
  return keys;
};

/** A scenario the operative model leaves out, with the marker that puts it aside. */
export type LeftOutScenario = {
  readonly scenarioId: string;
  readonly name: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly disabled: Disabled;
};

/**
 * The scenarios no reading runs: the disabled ones, the ones of a disabled
 * action or feature, and the ones that replay a disabled action as a step. A
 * scenario run counts them apart, so a feature with an element put aside never
 * reads as one whose scenarios vanished.
 */
export const scenariosLeftOut = (feature: Feature): readonly LeftOutScenario[] => {
  const offActions = new Map<string, Disabled>();
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      const marker = action.disabled ?? feature.disabled;
      if (marker) offActions.set(String(action.id), marker);
    }
  }
  const out: LeftOutScenario[] = [];
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      for (const scenario of action.scenarios ?? []) {
        const replayed = (scenario.steps ?? [])
          .map((step) => offActions.get(String(step.actionId)))
          .find((m): m is Disabled => m !== undefined);
        const marker = scenario.disabled ?? offActions.get(String(action.id)) ?? replayed;
        if (!marker) continue;
        out.push({
          scenarioId: String(scenario.id),
          name: scenario.name,
          actionId: String(action.id),
          actionName: action.name,
          disabled: marker
        });
      }
    }
  }
  return out;
};

/** Why an action cannot be run: the sentence that names it disabled, or null when it is in force. */
export const disabledActionRefusal = (feature: Feature, actionId: string): string | null => {
  for (const surface of feature.surfaces) {
    const action = surface.actions.find((a) => String(a.id) === actionId);
    if (!action) continue;
    const marker = action.disabled ?? feature.disabled;
    return marker
      ? `The action "${action.name}" is disabled (${marker.reason}): enable it to run it.`
      : null;
  }
  return null;
};
