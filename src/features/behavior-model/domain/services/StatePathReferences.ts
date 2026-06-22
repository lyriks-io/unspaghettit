import type { Feature } from '../entities/Feature';
import type { Effect } from '../value-objects/Effect';
import { isExpression, type Expression } from '../value-objects/Expression';
import {
  flattenLeafConditions,
  type RuleCondition
} from '../value-objects/RuleCondition';
import type { StatePath } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

/**
 * Counts every place a state path is referenced across the feature.
 * Useful before a destructive action (e.g. removing a Entity field) so the
 * user can see what will become "dangling".
 *
 * The references themselves are not affected by removing the metadata -
 * the underlying state still exists if a StateDefinition holds it. The
 * count is informational.
 */
export type StatePathReferences = {
  readonly path: StatePath;
  readonly stateDefinitions: number;
  readonly parameterBindings: number;
  readonly parameterResources: number;
  readonly actionRequiredStates: number;
  readonly ruleConditions: number;
  readonly setStateEffects: number;
  readonly invariantConditions: number;
  readonly personaStateOverrides: number;
  readonly otherDataFields: number;
};

const empty = (path: StatePath): StatePathReferences => ({
  path,
  stateDefinitions: 0,
  parameterBindings: 0,
  parameterResources: 0,
  actionRequiredStates: 0,
  ruleConditions: 0,
  setStateEffects: 0,
  invariantConditions: 0,
  personaStateOverrides: 0,
  otherDataFields: 0
});

const eq = (a: string | undefined, b: string): boolean => a === b;

/**
 * Walk an Expression tree counting how many times `target` appears in
 * `{ kind: 'state', path }` nodes. Literals/params/operators recurse into
 * their children. Non-Expression values short-circuit to 0 (raw literals
 * don't reference state paths).
 */
const countStateRefsInExpression = (
  value: StateValue | Expression | undefined,
  target: string
): number => {
  if (!isExpression(value)) return 0;
  const expr = value;
  switch (expr.kind) {
    case 'literal':
      return 0;
    case 'param':
      return 0;
    case 'state':
      return String(expr.path) === target ? 1 : 0;
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      return countStateRefsInExpression(expr.operand, target);
    case 'count_where':
      return (
        countStateRefsInExpression(expr.operand, target) +
        countStateRefsInExpression(expr.equals, target)
      );
    case 'switch': {
      let total = 0;
      for (const c of expr.cases) {
        for (const leaf of flattenLeafConditions(c.when)) {
          if (eq(String(leaf.left), target)) total += 1;
          total += countStateRefsInExpression(leaf.right, target);
        }
        total += countStateRefsInExpression(c.then, target);
      }
      total += countStateRefsInExpression(expr.default, target);
      return total;
    }
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max':
      return (
        countStateRefsInExpression(expr.left, target) +
        countStateRefsInExpression(expr.right, target)
      );
  }
};

/**
 * Count how many times `target` is written or referenced by a single effect.
 * Covers `set_state` and the three collection mutations, each of which targets
 * a state `path` and may bury state refs in an Expression-valued slot. Effects
 * that don't touch state (messages, events, transitions, blocks) contribute 0.
 */
const countRefsInEffect = (effect: Effect, target: string): number => {
  switch (effect.type) {
    case 'set_state':
      return (
        (eq(String(effect.path), target) ? 1 : 0) +
        countStateRefsInExpression(effect.value, target)
      );
    case 'append_to_list':
      return (
        (eq(String(effect.path), target) ? 1 : 0) +
        countStateRefsInExpression(effect.item, target)
      );
    case 'remove_from_list':
      return (
        (eq(String(effect.path), target) ? 1 : 0) +
        (effect.where ? countStateRefsInExpression(effect.where.equals, target) : 0) +
        countStateRefsInExpression(effect.value, target)
      );
    case 'update_list_item':
      return (
        (eq(String(effect.path), target) ? 1 : 0) +
        countStateRefsInExpression(effect.where.equals, target) +
        countStateRefsInExpression(effect.value, target)
      );
    default:
      return 0;
  }
};

// Walks a condition tree and counts every leaf `left == target` plus every
// state ref buried in a `right`-side Expression. Composite combinators
// (`all`/`any`/`not`) just fan out; an unconditional rule contributes 0.
const countRefsInCondition = (
  condition: RuleCondition | undefined,
  target: string
): number => {
  let n = 0;
  for (const leaf of flattenLeafConditions(condition)) {
    if (eq(String(leaf.left), target)) n += 1;
    n += countStateRefsInExpression(leaf.right, target);
  }
  return n;
};

export const countStatePathReferences = (
  feature: Feature,
  path: StatePath
): StatePathReferences => {
  const target = String(path);
  const refs: StatePathReferences = { ...empty(path) };
  let mut = refs as { -readonly [K in keyof StatePathReferences]: StatePathReferences[K] };

  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      if (eq(String(def.path), target)) mut.stateDefinitions += 1;
    }
    for (const cap of surface.actions) {
      for (const required of cap.requiredStates) {
        if (eq(String(required), target)) mut.actionRequiredStates += 1;
      }
      for (const param of cap.parameters) {
        if (eq(param.bindToStatePath ? String(param.bindToStatePath) : undefined, target)) {
          mut.parameterBindings += 1;
        }
      }
      for (const rule of cap.rules) {
        mut.ruleConditions += countRefsInCondition(rule.condition, target);
        mut.setStateEffects += countRefsInEffect(rule.effect, target);
      }
      for (const effect of cap.effects) {
        mut.setStateEffects += countRefsInEffect(effect, target);
      }
      for (const effect of cap.onBlockedEffects ?? []) {
        mut.setStateEffects += countRefsInEffect(effect, target);
      }
      for (const invariant of cap.invariants) {
        mut.invariantConditions += countRefsInCondition(invariant.condition, target);
      }
    }
    for (const rule of surface.rules) {
      mut.ruleConditions += countRefsInCondition(rule.condition, target);
      mut.setStateEffects += countRefsInEffect(rule.effect, target);
    }
    for (const invariant of surface.invariants) {
      mut.invariantConditions += countRefsInCondition(invariant.condition, target);
    }
  }

  for (const persona of feature.personas) {
    for (const override of persona.stateOverrides) {
      if (eq(String(override.path), target)) mut.personaStateOverrides += 1;
    }
  }

  for (const data of feature.entities) {
    for (const f of data.fields) {
      if (eq(f.path ? String(f.path) : undefined, target)) mut.otherDataFields += 1;
    }
  }

  return mut;
};

export const totalReferences = (refs: StatePathReferences): number =>
  refs.stateDefinitions +
  refs.parameterBindings +
  refs.parameterResources +
  refs.actionRequiredStates +
  refs.ruleConditions +
  refs.setStateEffects +
  refs.invariantConditions +
  refs.personaStateOverrides +
  refs.otherDataFields;

export const formatReferenceBreakdown = (refs: StatePathReferences): string => {
  const parts: string[] = [];
  const push = (n: number, label: string) => {
    if (n > 0) parts.push(`${n} ${label}`);
  };
  // The Entity field itself is "self". Exclude it from the headline by
  // subtracting one from otherDataFields when called with the field's own
  // path. Callers can adjust if needed.
  push(refs.stateDefinitions, refs.stateDefinitions === 1 ? 'state definition' : 'state definitions');
  push(refs.ruleConditions, refs.ruleConditions === 1 ? 'rule condition' : 'rule conditions');
  push(refs.setStateEffects, refs.setStateEffects === 1 ? 'set_state effect' : 'set_state effects');
  push(refs.parameterBindings, refs.parameterBindings === 1 ? 'parameter binding' : 'parameter bindings');
  push(
    refs.actionRequiredStates,
    refs.actionRequiredStates === 1 ? 'action requirement' : 'action requirements'
  );
  push(refs.invariantConditions, refs.invariantConditions === 1 ? 'invariant' : 'invariants');
  push(
    refs.personaStateOverrides,
    refs.personaStateOverrides === 1 ? 'persona override' : 'persona overrides'
  );
  push(refs.otherDataFields, refs.otherDataFields === 1 ? 'data field' : 'data fields');
  return parts.join(', ');
};
