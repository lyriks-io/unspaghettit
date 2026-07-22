import type { Feature } from '../../entities/Feature';
import { ALL_EFFECT_TYPES } from '../../value-objects/Effect';
import type { Expression } from '../../value-objects/Expression';
import { isExpression } from '../../value-objects/Expression';
import { CLOCK_NOW_PATH } from '../../value-objects/SimulationClock';
import { effectiveEnumValues } from '../EnumValues';
import {
  flattenLeafConditions,
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition,
  type LeafRuleCondition,
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
    case 'const':
      // const references a feature-level constant by name, not a state path;
      // its existence is validated separately (see collectExpressionConstNames).
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

/**
 * Collect every `{kind:'const', name}` reference reachable from an expression.
 * Mirrors `collectExpressionStatePaths` but gathers constant names (a
 * feature-global reference key) instead of state paths, so the validator can
 * flag a const reference that names no declared `feature.constants` entry.
 */
const collectExpressionConstNames = (expr: Expression, out: Set<string>): void => {
  if (!isExpression(expr)) return;
  switch (expr.kind) {
    case 'literal':
    case 'state':
    case 'param':
      return;
    case 'const':
      out.add(expr.name);
      return;
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      collectExpressionConstNames(expr.operand, out);
      return;
    case 'count_where':
      collectExpressionConstNames(expr.operand, out);
      collectExpressionConstNames(expr.equals, out);
      return;
    case 'switch':
      for (const c of expr.cases) {
        for (const leaf of flattenLeafConditions(c.when)) {
          if (isExpression(leaf.right)) collectExpressionConstNames(leaf.right, out);
        }
        collectExpressionConstNames(c.then, out);
      }
      collectExpressionConstNames(expr.default, out);
      return;
    default:
      collectExpressionConstNames(expr.left, out);
      collectExpressionConstNames(expr.right, out);
  }
};

/**
 * Collect every `{kind:'param', name}` reference reachable from an expression,
 * including param-lefts inside a `switch`'s `when` conditions. Mirrors the
 * const/state walkers. Feeds the scope-aware param check: a param reference is
 * only valid inside an action's own rules/invariants/effects, and must name a
 * parameter of that action. Anywhere else (surface rules, feature invariants,
 * goals, derived state) there is no parameter scope, so ANY param node is a bug.
 */
const collectExpressionParamNames = (expr: Expression, out: Set<string>): void => {
  if (!isExpression(expr)) return;
  switch (expr.kind) {
    case 'literal':
    case 'state':
    case 'const':
      return;
    case 'param':
      out.add(expr.name);
      return;
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      collectExpressionParamNames(expr.operand, out);
      return;
    case 'count_where':
      collectExpressionParamNames(expr.operand, out);
      collectExpressionParamNames(expr.equals, out);
      return;
    case 'switch':
      for (const c of expr.cases) {
        for (const leaf of flattenLeafConditions(c.when)) {
          if (isParamLeft(leaf.left)) out.add(leaf.left.name);
          if (isExpression(leaf.right)) collectExpressionParamNames(leaf.right, out);
        }
        collectExpressionParamNames(c.then, out);
      }
      collectExpressionParamNames(expr.default, out);
      return;
    default:
      collectExpressionParamNames(expr.left, out);
      collectExpressionParamNames(expr.right, out);
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

  // Allowed values for every enum-typed path, resolved through valueSets. An
  // enum names the CLOSED set of values a path may hold, but that promise was
  // only enforced on `defaultValue` (see featureShape): nothing checked the
  // values that rules and effects actually push through it. So a `set_state`
  // could write a value outside the domain, and a condition could compare
  // against one — a comparison that is then provably dead, since the path can
  // never hold that value. Both read as ordinary behavior and cost real money:
  // a plan enum of [free, premium] whose upgrade action writes "family" leaves
  // every `plan == "premium"` gate silently denying a paying customer.
  const enumDomainByPath = new Map<string, readonly string[]>();
  for (const s of feature.surfaces) {
    for (const def of s.stateDefinitions) {
      if (def.type !== 'enum') continue;
      const allowed = effectiveEnumValues(def, feature.valueSets);
      if (allowed && allowed.length > 0) enumDomainByPath.set(String(def.path), allowed);
    }
  }
  /**
   * Check one literal against an enum path's domain. Only raw string literals
   * are checkable: an Expression resolves at run time, so its value is not
   * knowable here and is left alone rather than guessed at.
   */
  const checkEnumMember = (
    path: unknown,
    value: unknown,
    label: string,
    what: string
  ): void => {
    if (typeof path !== 'string' || typeof value !== 'string') return;
    const allowed = enumDomainByPath.get(path);
    if (!allowed || allowed.includes(value)) return;
    errors.push(
      `${label}: ${what} "${value}" is not one of the values "${path}" can hold (${allowed.map((v) => `"${v}"`).join(', ')}).`
    );
  };

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

  // Reverse index: which surface(s) DECLARE a given path in their own
  // stateDefinitions (ignoring sharing). Lets an out-of-scope-path error name
  // the surface that already declares it and the exact sharedWith fix, instead
  // of the terse "not declared here" that leaves the author guessing.
  const declaringSurfacesByPath = new Map<string, string[]>();
  for (const s of feature.surfaces) {
    for (const d of s.stateDefinitions) {
      const key = String(d.path);
      const owners = declaringSurfacesByPath.get(key) ?? [];
      owners.push(String(s.id));
      declaringSurfacesByPath.set(key, owners);
    }
  }
  // When `path` is declared on ANOTHER surface but not shared into `surfaceId`,
  // returns the prescriptive fix (names the declaring surface + the sharedWith
  // edit). Returns undefined when it's declared nowhere else, so callers keep
  // their existing "declared nowhere" wording for that genuinely-undeclared case.
  const sharedWithFix = (path: string, surfaceId: string): string | undefined => {
    const declaredElsewhere = (declaringSurfacesByPath.get(path) ?? []).filter(
      (id) => id !== surfaceId
    );
    if (declaredElsewhere.length === 0) return undefined;
    const owner = declaredElsewhere[0]!;
    return `is declared on surface "${owner}" but not shared into "${surfaceId}". Add "${surfaceId}" to that StateDefinition's sharedWith.`;
  };

  // Taken from the effect value object, never re-listed here: a hand-copied
  // list silently drifted once already (`invoke_operation` shipped in the write
  // path and the simulator while this set still rejected it, so a legitimately
  // authored boundary call failed validation on the way back in).
  const KNOWN_EFFECT_TYPES = new Set<string>(ALL_EFFECT_TYPES);

  // Dependency catalog for `invoke_operation`. Nothing validated these before:
  // the effect type was rejected outright by the stale set above, so the case
  // below was unreachable and the references it names went unchecked.
  const dependencyById = new Map(
    (feature.dependencies ?? []).map((dependency) => [String(dependency.id), dependency])
  );

  // Scope-aware param-reference check. `paramNames` is the set of parameters in
  // scope (an action's own parameters), or undefined where no parameters exist
  // (surface rules, feature invariants, goals, derived state). A `{kind:'param'}`
  // node in a no-param scope, or one naming a parameter the action doesn't have,
  // silently evaluates to `undefined` at runtime — the same footgun as a bad
  // const reference — so reject it at write time.
  const checkExpressionParams = (
    value: unknown,
    paramNames: ReadonlySet<string> | undefined,
    label: string
  ): void => {
    if (!isExpression(value)) return;
    const names = new Set<string>();
    collectExpressionParamNames(value as Expression, names);
    for (const name of names) {
      if (!paramNames) {
        errors.push(
          `${label}: references parameter "${name}" but this scope has no parameters (a {kind:"param"} reference only works inside an action's rules, invariants, or effects).`
        );
      } else if (!paramNames.has(name)) {
        errors.push(
          `${label}: references parameter "${name}" but the action has no parameter with that name.`
        );
      }
    }
  };

  // A ref is element-scoped when it names, or is nested under, a quantifier's
  // bound element (`as`). Those are resolved by the evaluator's binding, not by
  // the declared state, so they must be skipped when validating a body.
  const isBoundRef = (ref: string, bound: ReadonlySet<string>): boolean => {
    for (const b of bound) {
      if (ref === b || ref.startsWith(`${b}.`)) return true;
    }
    return false;
  };

  // Validate the OUTER references inside quantifier bodies (all_match/any_match
  // `where`). flattenLeafConditions surfaces a quantifier's overPath but never
  // descends into its body, because the body's leaves may reference the scoped
  // `as` binding, which isn't a declared outer path. Here we DO descend: skip
  // element-scoped refs and validate the rest (real outer state paths + params)
  // the same way a normal leaf is. `paths` is the declared-path set for the
  // scope (per-surface, or the any-surface union for feature invariants/goals).
  const checkQuantifierBodies = (
    condition: RuleCondition | undefined,
    paths: Set<string>,
    label: string,
    paramNames: ReadonlySet<string> | undefined
  ): void => {
    const checkOuterExpr = (value: unknown, bound: ReadonlySet<string>): void => {
      if (!isExpression(value)) return;
      const acc: string[] = [];
      collectExpressionStatePaths(value, acc);
      for (const p of acc) {
        if (!isBoundRef(p, bound) && !paths.has(p)) {
          errors.push(`${label}: quantifier body references unknown state path "${p}".`);
        }
      }
      checkExpressionParams(value, paramNames, `${label}: quantifier body`);
    };
    const checkLeaf = (leaf: LeafRuleCondition, bound: ReadonlySet<string>): void => {
      if (isParamLeft(leaf.left)) {
        const name = leaf.left.name;
        if (!paramNames) {
          errors.push(
            `${label}: quantifier body references parameter "${name}" but this scope has no parameters.`
          );
        } else if (!paramNames.has(name)) {
          errors.push(
            `${label}: quantifier body references parameter "${name}" but the action has no parameter with that name.`
          );
        }
      } else if (
        typeof leaf.left === 'string' &&
        !isBoundRef(leaf.left, bound) &&
        !paths.has(leaf.left)
      ) {
        errors.push(`${label}: quantifier body condition.left "${leaf.left}" is not a declared state path.`);
      }
      checkOuterExpr(leaf.right, bound);
    };
    const walk = (node: RuleCondition, bound: ReadonlySet<string>, inBody: boolean): void => {
      if (isCompositeCondition(node)) {
        if (node.kind === 'not') walk(node.condition, bound, inBody);
        else for (const sub of node.conditions) walk(sub, bound, inBody);
        return;
      }
      if (isQuantifierCondition(node)) {
        // A nested quantifier's overPath is an outer array ref (unless scoped by
        // an enclosing binding). Top-level overPaths are already validated by
        // the caller via flattenLeafConditions, so only check when in a body.
        if (inBody && !isBoundRef(String(node.overPath), bound) && !paths.has(String(node.overPath))) {
          errors.push(`${label}: quantifier body overPath "${node.overPath}" is not a declared state path.`);
        }
        const nextBound = new Set(bound);
        nextBound.add(node.as);
        walk(node.where, nextBound, true);
        return;
      }
      // Plain leaf: the caller validates top-level leaves; we only own the ones
      // reached inside a quantifier body.
      if (inBody) checkLeaf(node, bound);
    };
    if (condition) walk(condition, new Set(), false);
  };

  const checkEffect = (
    effect: { readonly id: string; readonly type: string } & Record<string, unknown>,
    surfaceId: string,
    paths: Set<string>,
    label: string,
    /** Parameters in scope for this effect's expressions (action effects only). */
    paramNames?: ReadonlySet<string>
  ): void => {
    // Belt-and-suspenders: even with Zod-side enum validation, data loaded
    // from disk needs a final type check before it reaches the simulator
    // (which crashes on unknown effect types in its switch default).
    if (!KNOWN_EFFECT_TYPES.has(effect.type)) {
      errors.push(
        `${label} effect ${effect.id}: unknown effect.type "${effect.type}". Valid: ${ALL_EFFECT_TYPES.join(', ')}.`
      );
      return;
    }
    // Shared path-existence check for the effects that target a state path.
    const checkTargetPath = (verb: string): void => {
      const path = effect.path as string | undefined;
      if (typeof path === 'string' && !paths.has(path)) {
        const fix = sharedWithFix(path, surfaceId);
        errors.push(
          fix
            ? `${label} effect ${effect.id}: ${verb} path "${path}" ${fix}`
            : `${label} effect ${effect.id}: ${verb} path "${path}" is not declared on surface ${surfaceId} (or shared into it).`
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
      checkExpressionParams(value, paramNames, `${label} effect ${effect.id}: ${verb}`);
    };
    switch (effect.type) {
      case 'set_state': {
        checkTargetPath('set_state');
        checkValuePaths('set_state value', effect.value);
        // The write that puts a path outside its own declared domain.
        checkEnumMember(effect.path, effect.value, `${label} effect ${effect.id}`, 'set_state writes');
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
      case 'invoke_operation': {
        // The boundary call: its dependency and operation must exist, and its
        // resultPath is a state WRITE, so it answers to the same scope rules as
        // set_state (declared on or shared into this surface, never derived).
        const dependencyId = effect.dependencyId as string | undefined;
        const operation = effect.operation as string | undefined;
        const dependency =
          typeof dependencyId === 'string' ? dependencyById.get(dependencyId) : undefined;
        if (typeof dependencyId === 'string' && !dependency) {
          const known = [...dependencyById.values()]
            .map((d) => `${d.name} (${String(d.id)})`)
            .join(', ');
          errors.push(
            `${label} effect ${effect.id}: invoke_operation dependencyId "${dependencyId}" does not resolve to a dependency on this feature. ${
              dependencyById.size === 0
                ? 'The feature declares none — add one with add_dependency.'
                : `Declared dependencies: ${known}.`
            }`
          );
        }
        if (dependency && typeof operation === 'string') {
          const names = dependency.operations.map((op) => op.name);
          if (!names.includes(operation)) {
            errors.push(
              `${label} effect ${effect.id}: invoke_operation "${operation}" is not an operation on dependency "${dependency.name}". Declared operations: ${
                names.length === 0 ? '<none>' : names.join(', ')
              }.`
            );
          }
        }
        if (effect.resultPath !== undefined) {
          const path = effect.resultPath as string;
          if (typeof path === 'string' && !paths.has(path)) {
            const fix = sharedWithFix(path, surfaceId);
            errors.push(
              fix
                ? `${label} effect ${effect.id}: invoke_operation resultPath "${path}" ${fix}`
                : `${label} effect ${effect.id}: invoke_operation resultPath "${path}" is not declared on surface ${surfaceId} (or shared into it).`
            );
          }
          if (typeof path === 'string' && derivedPaths.has(path)) {
            errors.push(
              `${label} effect ${effect.id}: invoke_operation writes derived path "${path}", which is computed from its \`derived\` expression and cannot be set by an effect.`
            );
          }
        }
        checkValuePaths('invoke_operation resultValue', effect.resultValue);
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
      // A comparison against a value outside the path's enum domain can never
      // be true — the rule is dead on arrival. Typically a typo, or a value the
      // author added to the product but not to the enum.
      checkEnumMember(leaf.left, leaf.right, label, 'condition compares against');
      checkExpressionParams(leaf.right, paramNames, `${label}: condition.right`);
    }
    checkQuantifierBodies(condition, paths, label, paramNames);
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
      // Derived expressions run outside any action, so a param reference here
      // can never resolve.
      checkExpressionParams(def.derived, undefined, `Surface ${surface.id} derived state "${def.path}"`);
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
      // A parameter's bindToStatePath writes the param value into the snapshot
      // before rules run, so it must target a path declared on (or shared into)
      // this surface — otherwise the write lands nowhere the rules can read.
      for (const param of cap.parameters) {
        if (param.bindToStatePath !== undefined && !paths.has(String(param.bindToStatePath))) {
          const bound = String(param.bindToStatePath);
          const fix = sharedWithFix(bound, String(surface.id));
          errors.push(
            fix
              ? `Action ${cap.id} on surface ${surface.id}: parameter "${param.name}" bindToStatePath "${bound}" ${fix}`
              : `Action ${cap.id} on surface ${surface.id}: parameter "${param.name}" bindToStatePath "${bound}" is not a declared state path on this surface (or shared into it).`
          );
        }
      }
      for (const rule of cap.rules) {
        const label = `Action ${cap.id} rule ${rule.id}`;
        checkCondition(rule.condition, paths, surface.id, label, capParamNames);
        checkEffect(
          rule.effect as { id: string; type: string } & Record<string, unknown>,
          surface.id,
          paths,
          label,
          capParamNames
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
          `Action ${cap.id}`,
          capParamNames
        );
      }
      for (const e of cap.onBlockedEffects ?? []) {
        checkEffect(
          e as { id: string; type: string } & Record<string, unknown>,
          surface.id,
          paths,
          `Action ${cap.id} onBlocked`,
          capParamNames
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
      // Feature invariants walk their leaves inline (paths resolve across every
      // surface), so the enum-domain check has to be repeated here or they would
      // be the one place a dead comparison still slips through.
      checkEnumMember(leaf.left, leaf.right, `Feature invariant ${inv.id}`, 'condition compares against');
      checkExpressionParams(leaf.right, undefined, `Feature invariant ${inv.id}: condition.right`);
    }
    checkQuantifierBodies(inv.condition, anySurfacePaths, `Feature invariant ${inv.id}`, undefined);
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
      checkExpressionParams(leaf.right, undefined, `Reachability goal ${goal.id}: condition.right`);
    }
    checkQuantifierBodies(goal.condition, anySurfacePaths, `Reachability goal ${goal.id}`, undefined);
  }

  // Constant reference integrity. A `{kind:'const', name}` node resolves to a
  // feature-level Constant by name; an unknown name evaluates to `undefined` at
  // runtime (silently degrading a comparison/arithmetic), so catch a typo'd or
  // removed constant at write time. Names are feature-global, so unlike state
  // paths there is no per-surface scope: collect every referenced name across
  // conditions, effect values, and derived expressions, then flag the ones that
  // don't resolve. Diff-aware like the rest: a pre-existing dangling const on a
  // legacy snapshot only blocks the mutation that reintroduces it.
  const declaredConstNames = new Set<string>();
  for (const c of feature.constants ?? []) declaredConstNames.add(c.name);
  const undeclaredConst = new Map<string, string>(); // name -> first label seen
  const noteConstExpr = (value: unknown, label: string): void => {
    if (!isExpression(value)) return;
    const names = new Set<string>();
    collectExpressionConstNames(value, names);
    for (const name of names) {
      if (!declaredConstNames.has(name) && !undeclaredConst.has(name)) {
        undeclaredConst.set(name, label);
      }
    }
  };
  const noteConstCondition = (condition: RuleCondition | undefined, label: string): void => {
    if (!condition) return;
    for (const leaf of flattenLeafConditions(condition)) noteConstExpr(leaf.right, label);
  };
  const noteConstEffect = (
    effect: Record<string, unknown>,
    label: string
  ): void => {
    noteConstExpr(effect.value, label);
    noteConstExpr(effect.item, label);
    noteConstExpr(effect.by, label);
    const where = effect.where as { equals?: unknown } | undefined;
    if (where) noteConstExpr(where.equals, label);
  };
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      if (def.derived !== undefined) {
        noteConstExpr(def.derived, `Surface ${surface.id} derived state "${def.path}"`);
      }
    }
    for (const rule of surface.rules) {
      const label = `Surface ${surface.id} rule ${rule.id}`;
      noteConstCondition(rule.condition, label);
      noteConstEffect(rule.effect as Record<string, unknown>, label);
    }
    for (const inv of surface.invariants) {
      noteConstCondition(inv.condition, `Surface ${surface.id} invariant ${inv.id}`);
    }
    for (const cap of surface.actions) {
      for (const rule of cap.rules) {
        const label = `Action ${cap.id} rule ${rule.id}`;
        noteConstCondition(rule.condition, label);
        noteConstEffect(rule.effect as Record<string, unknown>, label);
      }
      for (const inv of cap.invariants) {
        noteConstCondition(inv.condition, `Action ${cap.id} invariant ${inv.id}`);
      }
      for (const e of cap.effects) noteConstEffect(e as Record<string, unknown>, `Action ${cap.id}`);
      for (const e of cap.onBlockedEffects ?? []) {
        noteConstEffect(e as Record<string, unknown>, `Action ${cap.id} onBlocked`);
      }
    }
  }
  for (const inv of feature.featureInvariants ?? []) {
    noteConstCondition(inv.condition, `Feature invariant ${inv.id}`);
  }
  for (const goal of feature.reachabilityGoals ?? []) {
    noteConstCondition(goal.condition, `Reachability goal ${goal.id}`);
  }
  for (const [name, label] of undeclaredConst) {
    errors.push(
      `${label}: references undeclared constant "${name}" (no feature-level constant with that name — declare it with add_constant or fix the reference).`
    );
  }

  // Scenario reference integrity. A scenario's stateOverrides arrange the
  // initial snapshot and its expectedAssertions read the post-run snapshot, both
  // by state path; expectedTransition names the surface the action should route
  // to. Paths are feature-wide (the simulation spans the feature), so validate
  // against the any-surface union — a typo'd path silently arranges or asserts
  // the wrong state and the scenario passes/fails meaninglessly (parameterName
  // is already checked structurally; these were the gap).
  const checkScenarioAssertions = (
    assertions: readonly { readonly path: unknown }[] | undefined,
    label: string
  ): void => {
    for (const a of assertions ?? []) {
      if (typeof a.path === 'string' && !anySurfacePaths.has(a.path)) {
        errors.push(
          `${label}: expected-assertion path "${a.path}" is not declared on any surface in the feature.`
        );
      }
    }
  };
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const scenario of cap.scenarios ?? []) {
        const base = `Action ${cap.id} scenario ${scenario.id}`;
        for (const ov of scenario.stateOverrides ?? []) {
          if (!anySurfacePaths.has(String(ov.path))) {
            errors.push(
              `${base}: stateOverride path "${ov.path}" is not declared on any surface in the feature.`
            );
          }
        }
        checkScenarioAssertions(scenario.expectedAssertions, base);
        if (
          typeof scenario.expectedTransition === 'string' &&
          !surfaceIds.has(scenario.expectedTransition)
        ) {
          errors.push(
            `${base}: expectedTransition "${scenario.expectedTransition}" is not a known surface id.`
          );
        }
        for (const [i, step] of (scenario.steps ?? []).entries()) {
          checkScenarioAssertions(step.expectedAssertions, `${base} step[${i}]`);
        }
      }
    }
  }

  // Resource back-references. Entity.resourceId and Parameter.resourceId point
  // at a feature-level Resource for compliance/provenance; they don't drive the
  // simulation, but a dangling id is still a broken link. Diff-aware, so a
  // legacy dangling ref only blocks the edit that reintroduces it.
  const resourceIds = new Set<string>();
  for (const r of feature.resources) resourceIds.add(String(r.id));
  for (const entity of feature.entities) {
    if (entity.resourceId !== undefined && !resourceIds.has(String(entity.resourceId))) {
      errors.push(
        `Entity "${entity.namespace}": resourceId "${entity.resourceId}" does not resolve to a declared feature resource.`
      );
    }
  }
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const param of cap.parameters) {
        if (param.resourceId !== undefined && !resourceIds.has(String(param.resourceId))) {
          errors.push(
            `Action ${cap.id} parameter "${param.name}": resourceId "${param.resourceId}" does not resolve to a declared feature resource.`
          );
        }
      }
    }
  }

  // Persona state overrides arrange the initial snapshot by state path (feature-
  // wide, applied before any scenario overrides). A path declared nowhere
  // silently sets junk state, the same class as a scenario stateOverride typo.
  for (const persona of feature.personas) {
    for (const ov of persona.stateOverrides ?? []) {
      if (!anySurfacePaths.has(String(ov.path))) {
        errors.push(
          `Persona ${persona.id} ("${persona.name}"): stateOverride path "${ov.path}" is not declared on any surface in the feature.`
        );
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
