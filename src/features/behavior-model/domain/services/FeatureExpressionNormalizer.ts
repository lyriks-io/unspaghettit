import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Invariant } from '../entities/Invariant';
import type { Rule } from '../entities/Rule';
import type { Scenario, ScenarioAssertion } from '../entities/Scenario';
import type { Surface } from '../entities/Surface';
import type {
  AdvanceTimeEffect,
  AppendToListEffect,
  Effect,
  RemoveFromListEffect,
  SetStateEffect,
  UpdateListItemEffect
} from '../value-objects/Effect';
import { normalizeExpression } from '../value-objects/Expression';
import {
  isCompositeCondition,
  isQuantifierCondition,
  type RuleCondition
} from '../value-objects/RuleCondition';

/**
 * Walk a Feature and rewrite every Expression-bearing slot so its nested
 * children are well-formed Expression nodes. JSON authoring is forgiving on
 * the outer slot (a `right`/`value` field can be either a raw literal or an
 * Expression), but the *children* of arithmetic Expression nodes are typed
 * `Expression` and any consumer (evaluator, scorer, scenario runner) recurses
 * unconditionally. A raw scalar buried in `add.right` silently breaks the
 * evaluator (returns undefined) and crashes the maturity scorer's recursive
 * walker. Running this normalizer once on the transformed Feature, before
 * validation and persistence, ensures every downstream walker can assume
 * well-formed trees.
 *
 * The transform is shallow-copy and idempotent.
 */
export const normalizeFeatureExpressions = (feature: Feature): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map(normalizeSurfaceExpressions)
});

const normalizeSurfaceExpressions = (surface: Surface): Surface => ({
  ...surface,
  stateDefinitions: surface.stateDefinitions.map((def) =>
    def.derived === undefined
      ? def
      : { ...def, derived: normalizeExpression(def.derived) as typeof def.derived }
  ),
  rules: surface.rules.map(normalizeRule),
  invariants: surface.invariants.map(normalizeInvariant),
  actions: surface.actions.map(normalizeAction)
});

const normalizeAction = (action: Action): Action => ({
  ...action,
  rules: action.rules.map(normalizeRule),
  invariants: action.invariants.map(normalizeInvariant),
  effects: action.effects.map(normalizeEffect),
  onBlockedEffects: action.onBlockedEffects?.map(normalizeEffect),
  scenarios: action.scenarios?.map(normalizeScenario)
});

const normalizeRule = (rule: Rule): Rule =>
  rule.condition === undefined
    ? { ...rule, effect: normalizeEffect(rule.effect) }
    : {
        ...rule,
        condition: normalizeCondition(rule.condition),
        effect: normalizeEffect(rule.effect)
      };

const normalizeInvariant = (invariant: Invariant): Invariant => ({
  ...invariant,
  condition: normalizeCondition(invariant.condition)
});

// Composite conditions normalize each inner condition recursively. Leaf
// conditions normalize the Expression slot on `.right` as before.
const normalizeCondition = (condition: RuleCondition): RuleCondition => {
  if (isCompositeCondition(condition)) {
    if (condition.kind === 'not') {
      return { kind: 'not', condition: normalizeCondition(condition.condition) };
    }
    return {
      kind: condition.kind,
      conditions: condition.conditions.map(normalizeCondition)
    };
  }
  if (isQuantifierCondition(condition)) {
    return { ...condition, where: normalizeCondition(condition.where) };
  }
  return condition.right === undefined
    ? condition
    : { ...condition, right: normalizeExpression(condition.right) };
};

const normalizeEffect = (effect: Effect): Effect => {
  switch (effect.type) {
    case 'set_state':
      return { ...effect, value: normalizeExpression(effect.value) } as SetStateEffect;
    case 'append_to_list':
      return { ...effect, item: normalizeExpression(effect.item) } as AppendToListEffect;
    case 'remove_from_list':
      return {
        ...effect,
        ...(effect.where !== undefined
          ? { where: { ...effect.where, equals: normalizeExpression(effect.where.equals) } }
          : {}),
        ...(effect.value !== undefined ? { value: normalizeExpression(effect.value) } : {})
      } as RemoveFromListEffect;
    case 'update_list_item':
      return {
        ...effect,
        where: { ...effect.where, equals: normalizeExpression(effect.where.equals) },
        value: normalizeExpression(effect.value)
      } as UpdateListItemEffect;
    case 'advance_time':
      return { ...effect, by: normalizeExpression(effect.by) } as AdvanceTimeEffect;
    default:
      return effect;
  }
};

const normalizeScenario = (scenario: Scenario): Scenario =>
  scenario.expectedAssertions
    ? { ...scenario, expectedAssertions: scenario.expectedAssertions.map(normalizeAssertion) }
    : scenario;

const normalizeAssertion = (assertion: ScenarioAssertion): ScenarioAssertion =>
  assertion.value === undefined
    ? assertion
    : { ...assertion, value: normalizeExpression(assertion.value) };
