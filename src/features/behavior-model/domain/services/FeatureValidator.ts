import type { Feature } from '../entities/Feature';
import { isEventName } from '../value-objects/EventName';
import type { Expression } from '../value-objects/Expression';
import { isExpression } from '../value-objects/Expression';
import { parameterTypeToStateType } from '../value-objects/ParameterType';
import { ALL_RULE_CATEGORIES } from '../value-objects/RuleCategory';
import {
  flattenLeafConditions,
  isParamLeft,
  type RuleCondition
} from '../value-objects/RuleCondition';
import { LEGACY_CATEGORY_MAP } from './FeatureRuleCategoryNormalizer';
import {
  isStateValueAssignableTo,
  typeOfStateValue,
  type StateType,
  type StateValue
} from '../value-objects/StateValue';

const VALID_RULE_CATEGORIES = new Set<string>(ALL_RULE_CATEGORIES);

const categoryHint = (category: string): string => {
  // Known legacy / pre-canonical names get a precise "did you mean" pointing
  // at the canonical replacement.
  if (category in LEGACY_CATEGORY_MAP) {
    return `Did you mean "${LEGACY_CATEGORY_MAP[category]!}"?`;
  }
  return `Valid categories: ${[...VALID_RULE_CATEGORIES].join(', ')}.`;
};

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const valueLabel = (value: StateValue): string => {
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
};

const defaultValueHint = (value: StateValue, type: StateType): string => {
  const actual = typeOfStateValue(value);
  const base = `Received ${valueLabel(value)} (${actual}); expected ${type}.`;
  if (typeof value !== 'string') return base;

  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return `${base} Use ${value} instead of "${value}".`;
  }
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return `${base} Use ${Number(value)} instead of "${value}".`;
  }
  if (type === 'array' && value.trim().startsWith('[')) {
    return `${base} Use a JSON array value, not a JSON-encoded string.`;
  }
  if (type === 'object' && value.trim().startsWith('{')) {
    return `${base} Use a JSON object value, not a JSON-encoded string.`;
  }
  return base;
};

const hasDescription = (value: { readonly description?: string } | undefined): boolean =>
  typeof value?.description === 'string' && value.description.trim().length > 0;

const requireDescription = (
  errors: string[],
  label: string,
  value: { readonly description?: string } | undefined
): void => {
  if (!hasDescription(value)) errors.push(`${label} is missing a description.`);
};

/**
 * Validate an Feature for structural integrity before persistence:
 *  - required string fields are present
 *  - IDs are unique within their parent scope
 *  - cross-references resolve (transitions, parent surfaces)
 *
 * Format-level validation of individual IDs is already enforced by the
 * `asXxxId(...)` value-object constructors when the data is built
 * programmatically. This service catches the higher-level issues that
 * those branded types cannot see.
 */
export const validateFeature = (feature: Feature): ValidationResult => {
  const errors: string[] = [];
  const personaIds = new Set<string>();
  for (const p of feature.personas) {
    if (personaIds.has(p.id)) errors.push(`Duplicate persona id "${p.id}"`);
    personaIds.add(p.id);
    requireDescription(errors, `Persona ${p.id}`, p);
  }

  if (!feature.id || feature.id.trim().length === 0) {
    errors.push('Feature id is required.');
  }
  if (!feature.name || feature.name.trim().length === 0) {
    errors.push('Feature name is required.');
  }
  requireDescription(errors, `Feature ${feature.id || '(new)'}`, feature);

  const surfaceIds = new Set<string>();
  for (const surface of feature.surfaces) {
    if (surfaceIds.has(surface.id)) {
      errors.push(`Duplicate surface id: ${surface.id}`);
    }
    surfaceIds.add(surface.id);
    if (!surface.name || surface.name.trim().length === 0) {
      errors.push(`Surface ${surface.id} is missing a name.`);
    }
    requireDescription(errors, `Surface ${surface.id}`, surface);
  }

  for (const surface of feature.surfaces) {
    if (surface.parentSurfaceId) {
      if (!surfaceIds.has(surface.parentSurfaceId)) {
        errors.push(
          `Surface ${surface.id} parentSurfaceId "${surface.parentSurfaceId}" does not exist.`
        );
      }
      if (surface.parentSurfaceId === surface.id) {
        errors.push(`Surface ${surface.id} cannot be its own parent.`);
      }
    }

    const stateDefIds = new Set<string>();
    const stateDefPaths = new Set<string>();
    for (const def of surface.stateDefinitions) {
      if (stateDefIds.has(def.id)) {
        errors.push(`Duplicate stateDefinition id "${def.id}" in surface ${surface.id}`);
      }
      stateDefIds.add(def.id);
      if (stateDefPaths.has(def.path)) {
        errors.push(
          `Duplicate state path "${def.path}" in surface ${surface.id}. Only one stateDefinition per path is allowed.`
        );
      }
      stateDefPaths.add(def.path);
      requireDescription(errors, `State definition "${def.path}" in surface ${surface.id}`, def);
      // Type/value contract: rules and invariants compare values by JS type
      // (e.g. greater_than requires both sides to be `typeof number`). A
      // defaultValue stored as `"365"` instead of `365` silently falsifies
      // every condition that touches it. Reject at write time so the bug
      // can't reach disk.
      if (!isStateValueAssignableTo(def.defaultValue, def.type)) {
        errors.push(
          `State "${def.path}" in surface ${surface.id}: defaultValue is not assignable to declared type "${def.type}". ${defaultValueHint(def.defaultValue, def.type)}`
        );
      } else if (
        def.type === 'enum' &&
        def.enumValues &&
        typeof def.defaultValue === 'string' &&
        !def.enumValues.includes(def.defaultValue)
      ) {
        errors.push(
          `State "${def.path}" in surface ${surface.id}: defaultValue "${def.defaultValue}" is not one of enumValues.`
        );
      }
      if (def.sharedWith) {
        for (const otherSurfaceId of def.sharedWith) {
          if (otherSurfaceId === surface.id) {
            errors.push(
              `State "${def.path}" sharedWith references its own surface ${surface.id}. Drop it.`
            );
          } else if (!surfaceIds.has(otherSurfaceId)) {
            errors.push(
              `State "${def.path}" in surface ${surface.id}: sharedWith references unknown surface "${otherSurfaceId}".`
            );
          }
        }
      }
    }

    const ruleIds = new Set<string>();
    for (const rule of surface.rules) {
      if (ruleIds.has(rule.id)) {
        errors.push(`Duplicate surface rule id "${rule.id}" in surface ${surface.id}`);
      }
      ruleIds.add(rule.id);
      requireDescription(errors, `Surface rule ${rule.id} in surface ${surface.id}`, rule);
      if (!VALID_RULE_CATEGORIES.has(String(rule.category))) {
        errors.push(
          `Surface rule ${rule.id} in surface ${surface.id} has unknown category "${rule.category}". ${categoryHint(String(rule.category))}`
        );
      }
    }

    const invariantIds = new Set<string>();
    for (const inv of surface.invariants) {
      if (invariantIds.has(inv.id)) {
        errors.push(`Duplicate surface invariant id "${inv.id}" in surface ${surface.id}`);
      }
      invariantIds.add(inv.id);
      requireDescription(errors, `Surface invariant ${inv.id} in surface ${surface.id}`, inv);
    }

    const transitionIds = new Set<string>();
    for (const trans of surface.transitions) {
      if (transitionIds.has(trans.id)) {
        errors.push(`Duplicate transition id "${trans.id}" in surface ${surface.id}`);
      }
      transitionIds.add(trans.id);
      requireDescription(errors, `Transition ${trans.id} in surface ${surface.id}`, trans);
      if (!surfaceIds.has(trans.target)) {
        errors.push(
          `Transition ${trans.id} in surface ${surface.id} targets unknown surface "${trans.target}"`
        );
      }
    }

    const actionIds = new Set<string>();
    for (const cap of surface.actions) {
      if (actionIds.has(cap.id)) {
        errors.push(`Duplicate action id "${cap.id}" in surface ${surface.id}`);
      }
      actionIds.add(cap.id);
      if (!cap.name || cap.name.trim().length === 0) {
        errors.push(`Action ${cap.id} is missing a name.`);
      }
      if (!cap.intent || cap.intent.trim().length === 0) {
        errors.push(`Action ${cap.id} is missing an intent.`);
      }

      const paramIds = new Set<string>();
      for (const p of cap.parameters) {
        if (paramIds.has(p.id)) {
          errors.push(`Duplicate parameter id "${p.id}" in action ${cap.id}`);
        }
        paramIds.add(p.id);
        requireDescription(errors, `Parameter "${p.name}" in action ${cap.id}`, p);
        if (
          p.defaultValue !== undefined &&
          !isStateValueAssignableTo(p.defaultValue, parameterTypeToStateType(p.type))
        ) {
          const expectedType = parameterTypeToStateType(p.type);
          errors.push(
            `Parameter "${p.name}" in action ${cap.id}: defaultValue is not assignable to declared type "${p.type}". ${defaultValueHint(p.defaultValue, expectedType)}`
          );
        } else if (
          p.type === 'enum' &&
          p.enumValues &&
          typeof p.defaultValue === 'string' &&
          !p.enumValues.includes(p.defaultValue)
        ) {
          errors.push(
            `Parameter "${p.name}" in action ${cap.id}: defaultValue "${p.defaultValue}" is not one of enumValues.`
          );
        }
      }

      const capRuleIds = new Set<string>();
      for (const rule of cap.rules) {
        if (capRuleIds.has(rule.id)) {
          errors.push(`Duplicate rule id "${rule.id}" in action ${cap.id}`);
        }
        capRuleIds.add(rule.id);
        requireDescription(errors, `Rule ${rule.id} in action ${cap.id}`, rule);
        if (!VALID_RULE_CATEGORIES.has(String(rule.category))) {
          errors.push(
            `Rule ${rule.id} in action ${cap.id} has unknown category "${rule.category}". ${categoryHint(String(rule.category))}`
          );
        }
      }

      const effectIds = new Set<string>();
      for (const effect of cap.effects) {
        if (effectIds.has(effect.id)) {
          errors.push(`Duplicate effect id "${effect.id}" in action ${cap.id}`);
        }
        effectIds.add(effect.id);
        requireDescription(errors, `Effect ${effect.id} in action ${cap.id}`, effect);
      }

      const onBlockedEffectIds = new Set<string>();
      for (const effect of cap.onBlockedEffects ?? []) {
        if (onBlockedEffectIds.has(effect.id)) {
          errors.push(`Duplicate onBlockedEffect id "${effect.id}" in action ${cap.id}`);
        }
        onBlockedEffectIds.add(effect.id);
        requireDescription(errors, `onBlockedEffect ${effect.id} in action ${cap.id}`, effect);
      }

      const capInvariantIds = new Set<string>();
      for (const inv of cap.invariants) {
        if (capInvariantIds.has(inv.id)) {
          errors.push(`Duplicate invariant id "${inv.id}" in action ${cap.id}`);
        }
        capInvariantIds.add(inv.id);
        requireDescription(errors, `Invariant ${inv.id} in action ${cap.id}`, inv);
      }

      const scenarioIds = new Set<string>();
      const actionParameterNames = new Set(cap.parameters.map((p) => p.name));
      for (const scenario of cap.scenarios ?? []) {
        if (scenarioIds.has(scenario.id)) {
          errors.push(`Duplicate scenario id "${scenario.id}" in action ${cap.id}`);
        }
        scenarioIds.add(scenario.id);
        requireDescription(errors, `Scenario ${scenario.id} in action ${cap.id}`, scenario);
        if (scenario.personaId && !personaIds.has(String(scenario.personaId))) {
          errors.push(
            `Scenario ${scenario.id} in action ${cap.id} references unknown personaId "${scenario.personaId}".`
          );
        }
        // Catch the silent-noop pattern where parameterOverrides reference a
        // name that doesn't exist on the action - the simulator blocks for
        // missing-required-param and the scenario "passes" by skipping every
        // assertion. We'd rather fail loudly at validation time.
        for (const override of scenario.parameterOverrides ?? []) {
          if (
            typeof override.parameterName !== 'string' ||
            !actionParameterNames.has(override.parameterName)
          ) {
            errors.push(
              `Scenario ${scenario.id} in action ${cap.id}: parameterOverrides entry references unknown parameter "${String(override.parameterName)}". Declared parameters: ${
                cap.parameters.length === 0
                  ? '<none>'
                  : cap.parameters.map((p) => p.name).join(', ')
              }.`
            );
          }
        }
        for (const assertion of scenario.expectedAssertions ?? []) {
          requireDescription(
            errors,
            `Scenario assertion for "${assertion.path}" in scenario ${scenario.id}`,
            assertion
          );
        }
      }
    }
  }

  const resourceIds = new Set<string>();
  for (const r of feature.resources) {
    if (resourceIds.has(r.id)) errors.push(`Duplicate resource id "${r.id}"`);
    resourceIds.add(r.id);
    requireDescription(errors, `Resource ${r.id}`, r);
  }

  const dataIds = new Set<string>();
  for (const d of feature.entities) {
    if (dataIds.has(d.id)) errors.push(`Duplicate data id "${d.id}"`);
    dataIds.add(d.id);
    requireDescription(errors, `Entity "${d.namespace}"`, d);
    const checkEntityField = (field: { readonly name: string; readonly description?: string; readonly fields?: readonly unknown[]; readonly items?: unknown }): void => {
      requireDescription(errors, `Entity field "${field.name}" in entity ${d.namespace}`, field);
      for (const child of field.fields ?? []) {
        checkEntityField(child as {
          readonly name: string;
          readonly description?: string;
          readonly fields?: readonly unknown[];
          readonly items?: unknown;
        });
      }
      if (field.items) {
        checkEntityField(field.items as {
          readonly name: string;
          readonly description?: string;
          readonly fields?: readonly unknown[];
          readonly items?: unknown;
        });
      }
    };
    for (const field of d.fields) checkEntityField(field);
  }

  const eventIds = new Set<string>();
  const eventNames = new Set<string>();
  for (const event of feature.events ?? []) {
    if (eventIds.has(event.id)) errors.push(`Duplicate event id "${event.id}"`);
    eventIds.add(event.id);
    requireDescription(errors, `Event ${event.id}`, event);
    for (const field of event.payloadSchema ?? []) {
      requireDescription(errors, `Event payload field "${field.name}" in event ${event.id}`, field);
    }
    const name = String(event.name);
    if (eventNames.has(name)) {
      errors.push(`Duplicate event name "${name}". Event names must be unique within an feature.`);
    }
    eventNames.add(name);
    if (!isEventName(name)) {
      errors.push(eventNameError(name, `Event ${event.id}`));
    }
  }

  // Walk every event-name slot on actions: emittedEvents[] and any
  // emit_event effect's `event` field (action.effects, action.onBlockedEffects,
  // and rule effects). Names that fail isEventName silently saved before but
  // crashed `importFeatureFromJson` on the next read, the feature would then
  // vanish from list_features with no error. Catching it on write surfaces
  // the typo immediately.
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const eventName of cap.emittedEvents) {
        const name = String(eventName);
        if (!isEventName(name)) {
          errors.push(eventNameError(name, `Action ${cap.id} emittedEvents`));
        }
      }
      const checkEffect = (effect: { type: string; event?: unknown }, where: string) => {
        if (effect.type === 'emit_event' && effect.event !== undefined) {
          const name = String(effect.event);
          if (!isEventName(name)) errors.push(eventNameError(name, where));
        }
      };
      for (const eff of cap.effects) checkEffect(eff, `Effect in action ${cap.id}`);
      for (const eff of cap.onBlockedEffects ?? []) {
        checkEffect(eff, `onBlockedEffect in action ${cap.id}`);
      }
      for (const r of cap.rules) checkEffect(r.effect, `Rule ${r.id} effect in action ${cap.id}`);
    }
    for (const r of surface.rules) {
      if (r.effect.type === 'emit_event' && r.effect.event !== undefined) {
        const name = String(r.effect.event);
        if (!isEventName(name)) {
          errors.push(eventNameError(name, `Surface rule ${r.id} effect`));
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};

const eventNameError = (name: string, where: string): string =>
  `${where}: invalid event name "${name}". Use lowercase dot-separated form like "selection.deleted". Example fixes: "${suggestEventName(name)}".`;

const suggestEventName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const collectExpressionStatePaths = (expr: Expression, out: string[]): void => {
  // Defensive: legacy snapshots can hold malformed Expression children (e.g.
  // `right: 1` instead of `{kind:"literal",value:1}`). The normalizer rewrites
  // them on write/import, but guard here too so the validator can't crash on
  // data that slipped past either boundary (which would also break unrelated
  // mutations like move_surface that pass through validation).
  if (!isExpression(expr)) return;
  switch (expr.kind) {
    case 'literal':
    case 'param':
      return;
    case 'state':
      out.push(expr.path);
      return;
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      collectExpressionStatePaths(expr.operand, out);
      return;
    case 'count_where':
      collectExpressionStatePaths(expr.operand, out);
      collectExpressionStatePaths(expr.equals, out);
      return;
    case 'switch':
      for (const c of expr.cases) {
        for (const leaf of flattenLeafConditions(c.when)) {
          // Skip param-lefts: they reference an action parameter, not a
          // state path on the surface.
          if (!isParamLeft(leaf.left)) out.push(leaf.left as string);
          if (isExpression(leaf.right)) collectExpressionStatePaths(leaf.right, out);
        }
        collectExpressionStatePaths(c.then, out);
      }
      collectExpressionStatePaths(expr.default, out);
      return;
    default:
      collectExpressionStatePaths(expr.left, out);
      collectExpressionStatePaths(expr.right, out);
  }
};

const statePathsFromConditionRight = (right: unknown): readonly string[] => {
  if (!isExpression(right)) return [];
  const acc: string[] = [];
  collectExpressionStatePaths(right, acc);
  return acc;
};

const statePathsFromEffectValue = (value: unknown): readonly string[] => {
  if (!isExpression(value)) return [];
  const acc: string[] = [];
  collectExpressionStatePaths(value, acc);
  return acc;
};

/**
 * Reference-integrity check. Catches dangling pointers the structural
 * validator above doesn't see:
 *
 *  - emittedEvents / emit_event effects name an EventName that is registered
 *    in `feature.events` (only enforced when at least one event is
 *    declared, otherwise the feature hasn't opted into the catalog yet).
 *  - requiredStates, condition.left, state-kind Expression nodes, and
 *    set_state effect paths reference state paths that exist on the owning
 *    surface (declared there or shared into it via another surface's
 *    `sharedWith`).
 *  - transition_surface effects target a known surface.
 *  - Parent-surface chains do not form a cycle.
 *
 * Kept separate from `validateFeature` because the mutate use case treats
 * these as "diff-aware": a mutation is blocked only when it *introduces* a
 * new dangling reference. Pre-existing dangling refs on legacy snapshots
 * remain editable so the LLM can fix them in subsequent ops.
 */
export const validateReferenceIntegrity = (feature: Feature): ValidationResult => {
  const errors: string[] = [];

  const surfaceIds = new Set<string>();
  for (const s of feature.surfaces) surfaceIds.add(s.id);

  const eventNames = new Set<string>();
  for (const e of feature.events ?? []) eventNames.add(String(e.name));
  const enforceEvents = eventNames.size > 0;

  // Per-surface set of reachable paths: declared on this surface OR declared
  // on another surface whose stateDefinition.sharedWith includes this one.
  const ownPathsBySurface = new Map<string, Set<string>>();
  for (const s of feature.surfaces) {
    const set = new Set<string>();
    for (const d of s.stateDefinitions) set.add(d.path);
    ownPathsBySurface.set(s.id, set);
  }
  const sharedIntoBySurface = new Map<string, Set<string>>();
  for (const s of feature.surfaces) sharedIntoBySurface.set(s.id, new Set());
  for (const owner of feature.surfaces) {
    for (const def of owner.stateDefinitions) {
      for (const other of def.sharedWith ?? []) {
        const set = sharedIntoBySurface.get(other);
        if (set) set.add(def.path);
      }
    }
  }
  const pathsFor = (surfaceId: string): Set<string> => {
    const own = ownPathsBySurface.get(surfaceId) ?? new Set<string>();
    const shared = sharedIntoBySurface.get(surfaceId) ?? new Set<string>();
    return new Set([...own, ...shared]);
  };

  const KNOWN_EFFECT_TYPES = new Set([
    'set_state',
    'show_message',
    'emit_event',
    'block_action',
    'allow_action',
    'transition_surface'
  ]);

  const checkEffect = (
    effect: { readonly id: string; readonly type: string } & Record<string, unknown>,
    surfaceId: string,
    paths: Set<string>,
    label: string
  ): void => {
    // Belt-and-suspenders: even with Zod-side enum validation, data loaded
    // from disk needs a final type check before it reaches the simulator
    // (which crashes on unknown effect types in its switch default).
    if (!KNOWN_EFFECT_TYPES.has(effect.type)) {
      errors.push(
        `${label} effect ${effect.id}: unknown effect.type "${effect.type}". Valid: set_state, show_message, emit_event, block_action, allow_action, transition_surface.`
      );
      return;
    }
    switch (effect.type) {
      case 'set_state': {
        const path = effect.path as string | undefined;
        if (typeof path === 'string' && !paths.has(path)) {
          errors.push(
            `${label} effect ${effect.id}: set_state path "${path}" is not declared on surface ${surfaceId} (or shared into it).`
          );
        }
        for (const p of statePathsFromEffectValue(effect.value)) {
          if (!paths.has(p)) {
            errors.push(
              `${label} effect ${effect.id}: set_state value references unknown state path "${p}" on surface ${surfaceId}.`
            );
          }
        }
        return;
      }
      case 'emit_event': {
        const name = effect.event as string | undefined;
        if (enforceEvents && typeof name === 'string' && !eventNames.has(name)) {
          errors.push(
            `${label} effect ${effect.id}: emit_event "${name}" is not registered in feature.events.`
          );
        }
        return;
      }
      case 'transition_surface': {
        const target = effect.target as string | undefined;
        if (typeof target === 'string' && !surfaceIds.has(target)) {
          errors.push(
            `${label} effect ${effect.id}: transition_surface target "${target}" is not a known surface id.`
          );
        }
        return;
      }
    }
  };

  const checkCondition = (
    condition: RuleCondition | undefined,
    paths: Set<string>,
    surfaceId: string,
    label: string,
    /**
     * Parameter names available to the condition. ONLY action rules /
     * action invariants pass this; surface rules and feature invariants
     * have no parameter scope and therefore can't put a `{kind:"param"}`
     * on the left. When undefined, param-left is rejected.
     */
    paramNames?: ReadonlySet<string>
  ): void => {
    if (!condition) return;
    // Composite (`all`/`any`/`not`) and unconditional rules fan out into
    // zero-or-more leaves. Each leaf gets the same left/right path-existence
    // check the flat shape used to get.
    for (const leaf of flattenLeafConditions(condition)) {
      if (isParamLeft(leaf.left)) {
        if (!paramNames) {
          errors.push(
            `${label}: condition.left references parameter "${leaf.left.name}" but this scope has no parameters. Param-on-left only works for action rules / action invariants.`
          );
        } else if (!paramNames.has(leaf.left.name)) {
          errors.push(
            `${label}: condition.left references parameter "${leaf.left.name}" but the action has no parameter with that name.`
          );
        }
      } else if (typeof leaf.left !== 'string') {
        errors.push(
          `${label}: condition.left must be a state-path string or a {kind:"param", name} object (got ${JSON.stringify(leaf.left)}).`
        );
      } else if (!paths.has(leaf.left)) {
        errors.push(
          `${label}: condition.left "${leaf.left}" is not a declared state path on surface ${surfaceId}.`
        );
      }
      for (const p of statePathsFromConditionRight(leaf.right)) {
        if (!paths.has(p)) {
          errors.push(
            `${label}: condition.right references unknown state path "${p}" on surface ${surfaceId}.`
          );
        }
      }
    }
  };

  for (const surface of feature.surfaces) {
    const paths = pathsFor(surface.id);

    for (const rule of surface.rules) {
      const label = `Surface ${surface.id} rule ${rule.id}`;
      checkCondition(rule.condition, paths, surface.id, label);
      checkEffect(
        rule.effect as { id: string; type: string } & Record<string, unknown>,
        surface.id,
        paths,
        label
      );
    }

    for (const inv of surface.invariants) {
      checkCondition(
        inv.condition,
        paths,
        surface.id,
        `Surface ${surface.id} invariant ${inv.id}`
      );
    }

    for (const cap of surface.actions) {
      for (const rs of cap.requiredStates) {
        if (typeof rs !== 'string') {
          // Authoring slip: passing a `{path, operator, value}` condition
          // object where the schema wants a state-path string. Without this
          // branch the template literal would render the object as
          // `[object Object]`, which is useless.
          errors.push(
            `Action ${cap.id} on surface ${surface.id}: requiredStates entries must be state-path strings (got ${JSON.stringify(rs)}). Use rules or invariants if you need conditions on those paths.`
          );
          continue;
        }
        if (!paths.has(rs)) {
          errors.push(
            `Action ${cap.id} on surface ${surface.id}: requiredStates references unknown state path "${rs}".`
          );
        }
      }
      if (enforceEvents) {
        for (const ev of cap.emittedEvents) {
          if (!eventNames.has(String(ev))) {
            errors.push(
              `Action ${cap.id} on surface ${surface.id}: emittedEvents contains "${ev}" which is not registered in feature.events.`
            );
          }
        }
      }
      // Event-handler integrity: a `triggeredByEvent` subscription must
      // name an event that exists in the feature (when any event is
      // registered, same gate as emittedEvents). Required parameters with
      // no default would never get a value because cascades don't carry
      // payload yet, so flag those too.
      if (cap.triggeredByEvent !== undefined) {
        const evName = String(cap.triggeredByEvent);
        if (enforceEvents && !eventNames.has(evName)) {
          errors.push(
            `Action ${cap.id} on surface ${surface.id}: triggeredByEvent "${evName}" is not registered in feature.events.`
          );
        }
        for (const param of cap.parameters) {
          if (param.required && param.defaultValue === undefined) {
            errors.push(
              `Action ${cap.id} on surface ${surface.id}: handler (triggeredByEvent="${evName}") has required parameter "${param.name}" with no default. Handlers receive no input from cascades; give the parameter a default or make it optional.`
            );
          }
        }
      }
      const capParamNames = new Set(cap.parameters.map((p) => p.name));
      for (const rule of cap.rules) {
        const label = `Action ${cap.id} rule ${rule.id}`;
        checkCondition(rule.condition, paths, surface.id, label, capParamNames);
        checkEffect(
          rule.effect as { id: string; type: string } & Record<string, unknown>,
          surface.id,
          paths,
          label
        );
      }
      for (const inv of cap.invariants) {
        checkCondition(
          inv.condition,
          paths,
          surface.id,
          `Action ${cap.id} invariant ${inv.id}`,
          capParamNames
        );
      }
      for (const e of cap.effects) {
        checkEffect(
          e as { id: string; type: string } & Record<string, unknown>,
          surface.id,
          paths,
          `Action ${cap.id}`
        );
      }
      for (const e of cap.onBlockedEffects ?? []) {
        checkEffect(
          e as { id: string; type: string } & Record<string, unknown>,
          surface.id,
          paths,
          `Action ${cap.id} onBlocked`
        );
      }
    }
  }

  // Feature-level invariants run against the union of every surface's
  // declared paths (own + everything everybody else shares anywhere) since
  // the invariant isn't bound to one surface. We re-use the leaf walker via
  // an "any-surface" path set.
  const anySurfacePaths = new Set<string>();
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) anySurfacePaths.add(String(def.path));
  }
  for (const inv of feature.featureInvariants ?? []) {
    for (const leaf of flattenLeafConditions(inv.condition)) {
      // Feature invariants have no parameter scope; param-left is invalid here.
      if (isParamLeft(leaf.left)) {
        errors.push(
          `Feature invariant ${inv.id}: condition.left references parameter "${leaf.left.name}" but feature invariants run outside any action scope and have no parameters available.`
        );
        continue;
      }
      if (!anySurfacePaths.has(leaf.left as string)) {
        errors.push(
          `Feature invariant ${inv.id}: condition.left "${leaf.left}" is not declared on any surface in the feature.`
        );
      }
      for (const p of statePathsFromConditionRight(leaf.right)) {
        if (!anySurfacePaths.has(p)) {
          errors.push(
            `Feature invariant ${inv.id}: condition.right references unknown state path "${p}".`
          );
        }
      }
    }
  }

  // Transitive parent cycle detection. Self-parent is caught by the
  // structural validator; here we follow each chain and flag the first
  // surface that closes a loop.
  const parentOf = new Map<string, string | undefined>();
  for (const s of feature.surfaces) parentOf.set(s.id, s.parentSurfaceId);
  for (const s of feature.surfaces) {
    const visited = new Set<string>([s.id]);
    let cursor: string | undefined = s.parentSurfaceId;
    while (cursor) {
      if (visited.has(cursor)) {
        errors.push(
          `Surface ${s.id} is part of a parent-surface cycle (reached "${cursor}" again following parentSurfaceId chain).`
        );
        break;
      }
      visited.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};
