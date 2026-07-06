import type { Feature } from '../../entities/Feature';
import type { Expression } from '../../value-objects/Expression';
import { isExpression } from '../../value-objects/Expression';
import { CLOCK_NOW_PATH } from '../../value-objects/SimulationClock';
import {
  flattenLeafConditions,
  isParamLeft,
  type RuleCondition
} from '../../value-objects/RuleCondition';
import { requireDescription, type ValidationResult } from './shared';

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

  // Derived (computed) paths — declared anywhere via a stateDefinition with a
  // `derived` expression. Effects must not write these: the engine recomputes
  // them, and a stray write would be silently overwritten.
  const derivedPaths = new Set<string>();
  for (const s of feature.surfaces) {
    for (const def of s.stateDefinitions) {
      if (def.derived !== undefined) derivedPaths.add(String(def.path));
    }
  }

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
    // The simulation clock is a reserved, engine-seeded path readable from any
    // surface — always in scope, never something the author has to declare.
    return new Set([...own, ...shared, String(CLOCK_NOW_PATH)]);
  };

  const KNOWN_EFFECT_TYPES = new Set([
    'set_state',
    'show_message',
    'emit_event',
    'block_action',
    'allow_action',
    'transition_surface',
    'append_to_list',
    'remove_from_list',
    'update_list_item',
    'advance_time'
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
        `${label} effect ${effect.id}: unknown effect.type "${effect.type}". Valid: set_state, show_message, emit_event, block_action, allow_action, transition_surface, append_to_list, remove_from_list, update_list_item.`
      );
      return;
    }
    // Shared path-existence check for the effects that target a state path.
    const checkTargetPath = (verb: string): void => {
      const path = effect.path as string | undefined;
      if (typeof path === 'string' && !paths.has(path)) {
        errors.push(
          `${label} effect ${effect.id}: ${verb} path "${path}" is not declared on surface ${surfaceId} (or shared into it).`
        );
      }
      if (typeof path === 'string' && derivedPaths.has(path)) {
        errors.push(
          `${label} effect ${effect.id}: ${verb} writes derived path "${path}", which is computed from its \`derived\` expression and cannot be set by an effect. Remove the write (the engine maintains it) or drop the path's \`derived\` expression to make it author-controlled.`
        );
      }
    };
    const checkValuePaths = (verb: string, value: unknown): void => {
      for (const p of statePathsFromEffectValue(value)) {
        if (!paths.has(p)) {
          errors.push(
            `${label} effect ${effect.id}: ${verb} references unknown state path "${p}" on surface ${surfaceId}.`
          );
        }
      }
    };
    switch (effect.type) {
      case 'set_state': {
        checkTargetPath('set_state');
        checkValuePaths('set_state value', effect.value);
        return;
      }
      case 'append_to_list': {
        checkTargetPath('append_to_list');
        checkValuePaths('append_to_list item', effect.item);
        return;
      }
      case 'remove_from_list': {
        checkTargetPath('remove_from_list');
        const where = effect.where as { equals?: unknown } | undefined;
        if (where) checkValuePaths('remove_from_list where.equals', where.equals);
        if (effect.value !== undefined) checkValuePaths('remove_from_list value', effect.value);
        return;
      }
      case 'update_list_item': {
        checkTargetPath('update_list_item');
        const where = effect.where as { equals?: unknown } | undefined;
        if (where) checkValuePaths('update_list_item where.equals', where.equals);
        checkValuePaths('update_list_item value', effect.value);
        return;
      }
      case 'advance_time': {
        // Targets the reserved clock.now path; only the `by` duration can carry
        // state references that need validating.
        checkValuePaths('advance_time by', effect.by);
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

    // Derived state expressions read state — every path they touch must be
    // declared on (or shared into) this surface, same as a condition/effect.
    for (const def of surface.stateDefinitions) {
      if (def.derived === undefined) continue;
      for (const p of statePathsFromEffectValue(def.derived)) {
        if (!paths.has(p)) {
          errors.push(
            `Surface ${surface.id} derived state "${def.path}": expression references unknown state path "${p}" (not declared on or shared into this surface).`
          );
        }
      }
    }

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
  const anySurfacePaths = new Set<string>([String(CLOCK_NOW_PATH)]);
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

  // Reachability/liveness goals: like feature invariants, they run outside any
  // action scope against the union of declared paths. Mirror the same leaf
  // checks (declared left/right paths, no param-left) plus a kind enum guard.
  const goalIds = new Set<string>();
  for (const goal of feature.reachabilityGoals ?? []) {
    if (goalIds.has(goal.id)) {
      errors.push(`Duplicate reachability goal id "${goal.id}"`);
    }
    goalIds.add(goal.id);
    requireDescription(errors, `Reachability goal ${goal.id}`, goal);
    if (goal.kind !== 'reachable' && goal.kind !== 'always_reachable') {
      errors.push(
        `Reachability goal ${goal.id}: kind must be "reachable" or "always_reachable" (got ${JSON.stringify(goal.kind)}).`
      );
    }
    if (!goal.condition) {
      errors.push(`Reachability goal ${goal.id}: a condition is required (the target state to reach).`);
      continue;
    }
    for (const leaf of flattenLeafConditions(goal.condition)) {
      if (isParamLeft(leaf.left)) {
        errors.push(
          `Reachability goal ${goal.id}: condition.left references parameter "${leaf.left.name}" but goals run outside any action scope and have no parameters available.`
        );
        continue;
      }
      if (!anySurfacePaths.has(leaf.left as string)) {
        errors.push(
          `Reachability goal ${goal.id}: condition.left "${leaf.left}" is not declared on any surface in the feature.`
        );
      }
      for (const p of statePathsFromConditionRight(leaf.right)) {
        if (!anySurfacePaths.has(p)) {
          errors.push(
            `Reachability goal ${goal.id}: condition.right references unknown state path "${p}".`
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
