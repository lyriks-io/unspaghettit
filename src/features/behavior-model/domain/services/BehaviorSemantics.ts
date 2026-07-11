import type { Action } from '../entities/Action';
import type { Rule } from '../entities/Rule';
import type { Effect } from '../value-objects/Effect';
import { isExpression, type Expression } from '../value-objects/Expression';
import type { EventName } from '../value-objects/EventName';
import {
  flattenLeafConditions,
  isParamLeft,
  type RuleCondition
} from '../value-objects/RuleCondition';
import type { StatePath } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

/**
 * Canonical semantic dependency analysis for behavior-model entities.
 *
 * Keep this in the domain layer: maturity, validation, graph projection and
 * impact analysis must agree on what an action reads, writes and emits. A
 * previous collection of local, partial walkers caused list mutations and
 * rule-carried effects to disappear from some reports.
 */

const unique = <T>(values: readonly T[], key: (value: T) => string): readonly T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const expressionStateReads = (value: StateValue | Expression): readonly StatePath[] => {
  if (!isExpression(value)) return [];
  switch (value.kind) {
    case 'state':
      return [value.path];
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max':
      return [...expressionStateReads(value.left), ...expressionStateReads(value.right)];
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      return expressionStateReads(value.operand);
    case 'count_where':
      return [...expressionStateReads(value.operand), ...expressionStateReads(value.equals)];
    case 'switch':
      return [
        ...value.cases.flatMap((entry) => [
          ...conditionStateReads(entry.when),
          ...expressionStateReads(entry.then)
        ]),
        ...expressionStateReads(value.default)
      ];
    case 'literal':
    case 'param':
    case 'const':
      return [];
  }
};

export const conditionStateReads = (
  condition: RuleCondition | undefined
): readonly StatePath[] =>
  unique(
    flattenLeafConditions(condition).flatMap((leaf) => [
      ...(isParamLeft(leaf.left) ? [] : [leaf.left as StatePath]),
      ...(leaf.right !== undefined ? expressionStateReads(leaf.right) : [])
    ]),
    String
  );

export const effectStateReads = (effect: Effect): readonly StatePath[] => {
  switch (effect.type) {
    case 'set_state':
      return expressionStateReads(effect.value);
    case 'append_to_list':
      return [effect.path, ...expressionStateReads(effect.item)];
    case 'remove_from_list':
      return [
        effect.path,
        ...(effect.where ? expressionStateReads(effect.where.equals) : []),
        ...(effect.value !== undefined ? expressionStateReads(effect.value) : [])
      ];
    case 'update_list_item':
      return [
        effect.path,
        ...expressionStateReads(effect.where.equals),
        ...expressionStateReads(effect.value)
      ];
    case 'advance_time':
      return expressionStateReads(effect.by);
    case 'invoke_operation':
      return effect.resultValue !== undefined ? expressionStateReads(effect.resultValue) : [];
    case 'show_message':
    case 'emit_event':
    case 'block_action':
    case 'allow_action':
    case 'transition_surface':
      return [];
  }
};

export const effectStateWrites = (effect: Effect): readonly StatePath[] => {
  switch (effect.type) {
    case 'set_state':
    case 'append_to_list':
    case 'remove_from_list':
    case 'update_list_item':
      return [effect.path];
    case 'advance_time':
      return ['clock.now' as StatePath];
    case 'invoke_operation':
      return effect.resultPath !== undefined ? [effect.resultPath] : [];
    case 'show_message':
    case 'emit_event':
    case 'block_action':
    case 'allow_action':
    case 'transition_surface':
      return [];
  }
};

export const actionEffects = (action: Action): readonly Effect[] => [
  ...action.effects,
  ...(action.onBlockedEffects ?? []),
  ...action.rules.map((rule) => rule.effect),
  ...(action.outcomes ?? []).flatMap((outcome) => outcome.effects ?? [])
];

const ruleStateReads = (rule: Rule): readonly StatePath[] => [
  ...conditionStateReads(rule.condition),
  ...effectStateReads(rule.effect)
];

export const actionStateReads = (action: Action): readonly StatePath[] =>
  unique(
    [
      ...action.rules.flatMap(ruleStateReads),
      ...action.invariants.flatMap((invariant) => conditionStateReads(invariant.condition)),
      ...action.effects.flatMap(effectStateReads),
      ...(action.onBlockedEffects ?? []).flatMap(effectStateReads),
      ...(action.outcomes ?? []).flatMap((outcome) => [
        ...conditionStateReads(outcome.condition),
        ...(outcome.effects ?? []).flatMap(effectStateReads)
      ])
    ],
    String
  );

export const actionStateWrites = (action: Action): readonly StatePath[] =>
  unique(
    [
      ...action.parameters.flatMap((parameter) =>
        parameter.bindToStatePath ? [parameter.bindToStatePath] : []
      ),
      ...actionEffects(action).flatMap(effectStateWrites)
    ],
    String
  );

export const actionEmittedEvents = (action: Action): readonly EventName[] =>
  unique(
    actionEffects(action).flatMap((effect) =>
      effect.type === 'emit_event' ? [effect.event] : []
    ),
    String
  );

