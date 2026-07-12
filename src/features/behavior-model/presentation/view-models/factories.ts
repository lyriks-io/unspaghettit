import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { AcceptanceCriterion } from '$features/behavior-model/domain/entities/AcceptanceCriterion';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type {
  ReachabilityGoal,
  ReachabilityGoalKind
} from '$features/behavior-model/domain/entities/ReachabilityGoal';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface, SurfaceType } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import type { Operator } from '$features/behavior-model/domain/value-objects/Operator';
import {
  asAcceptanceCriterionId,
  asActionId,
  asDependencyId,
  asEffectId,
  asInvariantId,
  asReachabilityGoalId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { IdGenerator } from '$shared/domain/IdGenerator';

export const newSurface = (
  ids: IdGenerator,
  init: { name: string; type: SurfaceType; description?: string }
): Surface => ({
  id: asSurfaceId(ids()),
  name: init.name,
  type: init.type,
  description: init.description,
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

export const newAction = (
  ids: IdGenerator,
  init: { name: string; intent?: string }
): Action => ({
  id: asActionId(ids()),
  name: init.name,
  intent: init.intent ?? '',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
});

export const newStateDefinition = (
  ids: IdGenerator,
  init: { path: string; type: StateDefinition['type'] }
): StateDefinition => {
  const defaultValue =
    init.type === 'number'
      ? 0
      : init.type === 'boolean'
        ? false
        : init.type === 'object'
          ? {}
          : init.type === 'array'
            ? []
        : init.type === 'enum'
          ? ''
          : '';
  return {
    id: asStateDefinitionId(ids()),
    path: asStatePath(init.path),
    type: init.type,
    defaultValue
  };
};

export const newRule = (
  ids: IdGenerator,
  init: { category: Rule['category']; left: string; operator: Operator }
): Rule => ({
  id: asRuleId(ids()),
  category: init.category,
  condition: {
    left: asStatePath(init.left),
    operator: init.operator
  },
  effect: {
    id: asEffectId(ids()),
    type: 'block_action',
    reason: ''
  }
});

export const newEffect = (ids: IdGenerator, type: Effect['type']): Effect => {
  switch (type) {
    case 'set_state':
      return {
        id: asEffectId(ids()),
        type: 'set_state',
        path: asStatePath('state.path'),
        value: ''
      };
    case 'show_message':
      return { id: asEffectId(ids()), type: 'show_message', message: '', tone: 'info' };
    case 'emit_event':
      return {
        id: asEffectId(ids()),
        type: 'emit_event',
        event: 'event.name' as never
      };
    case 'block_action':
      return { id: asEffectId(ids()), type: 'block_action', reason: '' };
    case 'allow_action':
      return { id: asEffectId(ids()), type: 'allow_action' };
    case 'transition_surface':
      return {
        id: asEffectId(ids()),
        type: 'transition_surface',
        target: asSurfaceId('')
      };
    case 'append_to_list':
      return {
        id: asEffectId(ids()),
        type: 'append_to_list',
        path: asStatePath('state.path'),
        item: ''
      };
    case 'remove_from_list':
      return {
        id: asEffectId(ids()),
        type: 'remove_from_list',
        path: asStatePath('state.path'),
        where: { field: '', equals: '' }
      };
    case 'update_list_item':
      return {
        id: asEffectId(ids()),
        type: 'update_list_item',
        path: asStatePath('state.path'),
        where: { field: '', equals: '' },
        field: '',
        value: ''
      };
    case 'advance_time':
      return {
        id: asEffectId(ids()),
        type: 'advance_time',
        by: 0
      };
    case 'invoke_operation':
      return {
        id: asEffectId(ids()),
        type: 'invoke_operation',
        dependencyId: asDependencyId(''),
        operation: ''
      };
  }
};

export const newInvariant = (
  ids: IdGenerator,
  init: { name: string; left: string }
): Invariant => ({
  id: asInvariantId(ids()),
  name: init.name,
  condition: {
    left: asStatePath(init.left),
    operator: 'exists'
  },
  message: ''
});

export const newReachabilityGoal = (
  ids: IdGenerator,
  init: { name: string; kind: ReachabilityGoalKind; left: string }
): ReachabilityGoal => ({
  id: asReachabilityGoalId(ids()),
  name: init.name,
  kind: init.kind,
  condition: {
    left: asStatePath(init.left),
    operator: 'is_true'
  },
  description: '',
  message: ''
});

export const newAcceptanceCriterion = (
  ids: IdGenerator,
  init?: { title?: string }
): AcceptanceCriterion => ({
  id: asAcceptanceCriterionId(ids()),
  title: init?.title ?? 'New acceptance criterion',
  given: '',
  when: '',
  then: '',
  expectedOutcome: 'success'
});
