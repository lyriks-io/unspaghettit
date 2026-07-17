import type { Action, ActionRole } from '../entities/Action';
import { ALL_CAPABILITY_ROLES, isEvolution } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { ActionId, FeatureId, SurfaceId } from '../value-objects/ids';

export type ActionStats = {
  readonly actions: number;
  readonly committedActions: number;
  readonly evolutions: number;
  readonly parameters: number;
  readonly rules: number;
  readonly effects: number;
  readonly invariants: number;
  readonly scenarios: number;
  readonly transitions: number;
  readonly outcomes: number;
  readonly requiredStateReferences: number;
  readonly emittedEventReferences: number;
  readonly eventHandlers: number;
  readonly uniqueStatePaths: number;
  readonly uniqueEvents: number;
  readonly uniqueParameterNames: number;
  readonly roles: Readonly<Record<ActionRole, number>>;
  readonly effectTypes: Readonly<Record<string, number>>;
};

export type ActionCatalogEntry = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly surfaceId: SurfaceId;
  readonly surfaceName: string;
  readonly actionId: ActionId;
  readonly actionName: string;
  readonly intent: string;
  readonly evolution: boolean;
  readonly roles: readonly ActionRole[];
  readonly counts: {
    readonly parameters: number;
    readonly rules: number;
    readonly effects: number;
    readonly invariants: number;
    readonly scenarios: number;
    readonly transitions: number;
    readonly outcomes: number;
  };
  /** Reusable references are visible above the action with full provenance. */
  readonly references: {
    readonly statePaths: readonly string[];
    readonly events: readonly string[];
    readonly resources: readonly string[];
    readonly valueSets: readonly string[];
    readonly parameterNames: readonly string[];
    readonly effectTypes: readonly string[];
  };
};

export type ActionConceptKind =
  | 'state'
  | 'event'
  | 'resource'
  | 'value_set'
  | 'parameter'
  | 'role'
  | 'effect_type';

export type ActionConcept = {
  readonly kind: ActionConceptKind;
  readonly value: string;
  readonly occurrences: number;
  readonly featureIds: readonly FeatureId[];
  readonly actionIds: readonly ActionId[];
  readonly crossFeature: boolean;
};

export type ActionRollup = {
  readonly stats: ActionStats;
  readonly actions: readonly ActionCatalogEntry[];
  readonly concepts: readonly ActionConcept[];
};

const strings = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const collectDeep = (value: unknown, key: string, output: Set<string>): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectDeep(item, key, output);
    return;
  }
  for (const [candidate, nested] of Object.entries(value as Record<string, unknown>)) {
    if (candidate === key && typeof nested === 'string') output.add(nested);
    collectDeep(nested, key, output);
  }
};

const actionEffectTypes = (action: Action): readonly string[] => {
  const types: string[] = [];
  for (const effect of action.effects) types.push(effect.type);
  for (const effect of action.onBlockedEffects ?? []) types.push(effect.type);
  for (const rule of action.rules) types.push(rule.effect.type);
  for (const outcome of action.outcomes ?? []) {
    for (const effect of outcome.effects ?? []) types.push(effect.type);
  }
  return types;
};

const actionReferences = (action: Action): ActionCatalogEntry['references'] => {
  const statePaths = new Set(action.requiredStates.map(String));
  collectDeep(action, 'path', statePaths);
  collectDeep(action, 'resultPath', statePaths);
  for (const parameter of action.parameters) {
    if (parameter.bindToStatePath) statePaths.add(String(parameter.bindToStatePath));
  }

  const events = new Set(action.emittedEvents.map(String));
  if (action.triggeredByEvent) events.add(String(action.triggeredByEvent));
  collectDeep(action.effects, 'event', events);
  collectDeep(action.onBlockedEffects, 'event', events);
  collectDeep(action.rules, 'event', events);
  collectDeep(action.outcomes, 'event', events);

  return {
    statePaths: strings(statePaths),
    events: strings(events),
    resources: strings(
      action.parameters.flatMap((parameter) =>
        parameter.resourceId ? [String(parameter.resourceId)] : []
      )
    ),
    valueSets: strings(
      action.parameters.flatMap((parameter) =>
        parameter.valueSetId ? [String(parameter.valueSetId)] : []
      )
    ),
    parameterNames: strings(action.parameters.map((parameter) => parameter.name)),
    effectTypes: strings(actionEffectTypes(action))
  };
};

const effectCount = (action: Action): number =>
  action.effects.length +
  (action.onBlockedEffects?.length ?? 0) +
  action.rules.length +
  (action.outcomes ?? []).reduce((count, outcome) => count + (outcome.effects?.length ?? 0), 0);

const emptyRoleCounts = (): Record<ActionRole, number> =>
  Object.fromEntries(ALL_CAPABILITY_ROLES.map((role) => [role, 0])) as Record<ActionRole, number>;

export const rollupActions = (features: readonly Feature[]): ActionRollup => {
  const actions: ActionCatalogEntry[] = [];
  const roles = emptyRoleCounts();
  const effectTypes: Record<string, number> = {};

  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const action of surface.actions) {
        const references = actionReferences(action);
        for (const role of action.roles ?? []) roles[role] += 1;
        for (const type of actionEffectTypes(action))
          effectTypes[type] = (effectTypes[type] ?? 0) + 1;
        actions.push({
          featureId: feature.id,
          featureName: feature.name,
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: action.id,
          actionName: action.name,
          intent: action.intent,
          evolution: isEvolution(action),
          roles: action.roles ?? [],
          counts: {
            parameters: action.parameters.length,
            rules: action.rules.length,
            effects: effectCount(action),
            invariants: action.invariants.length,
            scenarios: action.scenarios?.length ?? 0,
            transitions: action.transitions.length,
            outcomes: action.outcomes?.length ?? 0
          },
          references
        });
      }
    }
  }

  const conceptMap = new Map<
    string,
    {
      kind: ActionConceptKind;
      value: string;
      occurrences: number;
      features: Set<FeatureId>;
      actions: Set<ActionId>;
    }
  >();
  const addConcept = (entry: ActionCatalogEntry, kind: ActionConceptKind, value: string) => {
    const key = `${kind}:${value}`;
    const concept = conceptMap.get(key) ?? {
      kind,
      value,
      occurrences: 0,
      features: new Set<FeatureId>(),
      actions: new Set<ActionId>()
    };
    concept.occurrences += 1;
    concept.features.add(entry.featureId);
    concept.actions.add(entry.actionId);
    conceptMap.set(key, concept);
  };
  for (const entry of actions) {
    for (const value of entry.references.statePaths) addConcept(entry, 'state', value);
    for (const value of entry.references.events) addConcept(entry, 'event', value);
    for (const value of entry.references.resources) addConcept(entry, 'resource', value);
    for (const value of entry.references.valueSets) addConcept(entry, 'value_set', value);
    for (const value of entry.references.parameterNames) addConcept(entry, 'parameter', value);
    for (const value of entry.references.effectTypes) addConcept(entry, 'effect_type', value);
    for (const value of entry.roles) addConcept(entry, 'role', value);
  }

  const concepts = [...conceptMap.values()]
    .map((concept) => ({
      kind: concept.kind,
      value: concept.value,
      occurrences: concept.occurrences,
      featureIds: [...concept.features],
      actionIds: [...concept.actions],
      crossFeature: concept.features.size > 1
    }))
    .sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)
    );
  const allStates = new Set(actions.flatMap((entry) => entry.references.statePaths));
  const allEvents = new Set(actions.flatMap((entry) => entry.references.events));
  const allParameters = new Set(actions.flatMap((entry) => entry.references.parameterNames));

  return {
    stats: {
      actions: actions.length,
      committedActions: actions.filter((action) => !action.evolution).length,
      evolutions: actions.filter((action) => action.evolution).length,
      parameters: actions.reduce((count, action) => count + action.counts.parameters, 0),
      rules: actions.reduce((count, action) => count + action.counts.rules, 0),
      effects: actions.reduce((count, action) => count + action.counts.effects, 0),
      invariants: actions.reduce((count, action) => count + action.counts.invariants, 0),
      scenarios: actions.reduce((count, action) => count + action.counts.scenarios, 0),
      transitions: actions.reduce((count, action) => count + action.counts.transitions, 0),
      outcomes: actions.reduce((count, action) => count + action.counts.outcomes, 0),
      requiredStateReferences: actions.reduce(
        (count, action) => count + action.references.statePaths.length,
        0
      ),
      emittedEventReferences: actions.reduce(
        (count, action) => count + action.references.events.length,
        0
      ),
      eventHandlers: features.reduce(
        (count, feature) =>
          count +
          feature.surfaces.reduce(
            (surfaceCount, surface) =>
              surfaceCount + surface.actions.filter((action) => action.triggeredByEvent).length,
            0
          ),
        0
      ),
      uniqueStatePaths: allStates.size,
      uniqueEvents: allEvents.size,
      uniqueParameterNames: allParameters.size,
      roles,
      effectTypes
    },
    actions,
    concepts
  };
};
