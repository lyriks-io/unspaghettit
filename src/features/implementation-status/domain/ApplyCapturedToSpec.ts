import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import {
  isCompositeCondition,
  type LeafRuleCondition,
  type RuleCondition
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import type { ResourceId } from '$features/behavior-model/domain/value-objects/ids';
import type { Operator } from '$features/behavior-model/domain/value-objects/Operator';
import { ALL_OPERATORS } from '$features/behavior-model/domain/value-objects/Operator';
import type { RuleCategory } from '$features/behavior-model/domain/value-objects/RuleCategory';
import { ALL_RULE_CATEGORIES } from '$features/behavior-model/domain/value-objects/RuleCategory';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import {
  updateAction,
  updateEntity,
  updateInvariantOnCapability,
  updateInvariantOnSurface,
  updateRuleOnCapability,
  updateRuleOnSurface,
  updateStateDefinition
} from '$features/behavior-model/domain/services/FeatureTransforms';
import type { EntityType } from './ImplementationStatus';

/**
 * Whitelist of diff paths safe to copy from captured code back into the spec.
 * Excludes structural fields where overwriting would corrupt cross-references
 * (state paths, transition targets, effect discriminants, data field schemas).
 */
const APPLICABLE_PATHS: Readonly<Record<EntityType, readonly string[]>> = {
  action: ['name', 'intent', 'requiredStates', 'emittedEvents'],
  event: [],
  rule: [
    'category',
    'description',
    'condition.left',
    'condition.operator',
    'condition.right'
  ],
  invariant: [
    'name',
    'description',
    'message',
    'condition.left',
    'condition.operator',
    'condition.right'
  ],
  transition: ['label', 'description'],
  state: ['defaultValue', 'enumValues', 'description'],
  data: ['namespace', 'description', 'resourceId'],
  surface_rule: [
    'category',
    'description',
    'condition.left',
    'condition.operator',
    'condition.right'
  ],
  surface_invariant: [
    'name',
    'description',
    'message',
    'condition.left',
    'condition.operator',
    'condition.right'
  ]
};

export const isPathApplicable = (entityType: EntityType, path: string): boolean =>
  APPLICABLE_PATHS[entityType].includes(path);

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const asStringArray = (v: unknown): readonly string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as readonly string[]) : null;

const asOperator = (v: unknown): Operator | null =>
  typeof v === 'string' && (ALL_OPERATORS as readonly string[]).includes(v) ? (v as Operator) : null;

const asRuleCategory = (v: unknown): RuleCategory | null =>
  typeof v === 'string' && (ALL_RULE_CATEGORIES as readonly string[]).includes(v)
    ? (v as RuleCategory)
    : null;

// `condition.left/operator/right` paths only apply to leaf conditions.
// For composite (`all`/`any`/`not`) or unconditional rules they're a
// no-op, callers should reach into the structured condition via the
// `condition` path instead.
const asLeafCondition = (
  c: RuleCondition | undefined
): LeafRuleCondition | null =>
  c === undefined || isCompositeCondition(c) ? null : c;

const ruleWithFieldSet = (rule: Rule, path: string, value: unknown): Rule | null => {
  switch (path) {
    case 'category': {
      const cat = asRuleCategory(value);
      return cat ? { ...rule, category: cat } : null;
    }
    case 'description': {
      const s = asString(value);
      return s === null ? null : { ...rule, description: s };
    }
    case 'condition.left': {
      const leaf = asLeafCondition(rule.condition);
      const s = asString(value);
      if (leaf === null || s === null) return null;
      return { ...rule, condition: { ...leaf, left: s as StatePath } };
    }
    case 'condition.operator': {
      const leaf = asLeafCondition(rule.condition);
      const op = asOperator(value);
      if (leaf === null || !op) return null;
      return { ...rule, condition: { ...leaf, operator: op } };
    }
    case 'condition.right': {
      const leaf = asLeafCondition(rule.condition);
      if (leaf === null) return null;
      return { ...rule, condition: { ...leaf, right: value as StateValue } };
    }
    default:
      return null;
  }
};

const invariantWithFieldSet = (
  invariant: Invariant,
  path: string,
  value: unknown
): Invariant | null => {
  switch (path) {
    case 'name':
    case 'description':
    case 'message': {
      const s = asString(value);
      return s === null ? null : { ...invariant, [path]: s };
    }
    case 'condition.left': {
      const leaf = asLeafCondition(invariant.condition);
      const s = asString(value);
      if (leaf === null || s === null) return null;
      return { ...invariant, condition: { ...leaf, left: s as StatePath } };
    }
    case 'condition.operator': {
      const leaf = asLeafCondition(invariant.condition);
      const op = asOperator(value);
      if (leaf === null || !op) return null;
      return { ...invariant, condition: { ...leaf, operator: op } };
    }
    case 'condition.right': {
      const leaf = asLeafCondition(invariant.condition);
      if (leaf === null) return null;
      return {
        ...invariant,
        condition: { ...leaf, right: value as StateValue }
      };
    }
    default:
      return null;
  }
};

/**
 * Apply a single captured field value back to the spec. Returns the original
 * feature unchanged when the path isn't applicable, the entity can't be
 * located, or the captured value has the wrong shape. Callers never see a
 * thrown error from a malformed LLM extraction.
 */
export const applyCapturedFieldToSpec = (
  feature: Feature,
  entityType: EntityType,
  entityId: string,
  path: string,
  capturedValue: unknown
): Feature => {
  if (!isPathApplicable(entityType, path)) return feature;

  switch (entityType) {
    case 'action': {
      for (const surface of feature.surfaces) {
        const cap = surface.actions.find((c) => String(c.id) === entityId);
        if (!cap) continue;
        if (path === 'name' || path === 'intent') {
          const s = asString(capturedValue);
          return s === null
            ? feature
            : updateAction(feature, surface.id, cap.id, { [path]: s });
        }
        if (path === 'requiredStates') {
          const arr = asStringArray(capturedValue);
          return arr === null
            ? feature
            : updateAction(feature, surface.id, cap.id, {
                requiredStates: arr as readonly StatePath[]
              });
        }
        if (path === 'emittedEvents') {
          const arr = asStringArray(capturedValue);
          return arr === null
            ? feature
            : updateAction(feature, surface.id, cap.id, {
                emittedEvents: arr as Action['emittedEvents']
              });
        }
        return feature;
      }
      return feature;
    }

    case 'rule': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const r = cap.rules.find((x) => String(x.id) === entityId);
          if (!r) continue;
          const next = ruleWithFieldSet(r, path, capturedValue);
          return next ? updateRuleOnCapability(feature, surface.id, cap.id, next) : feature;
        }
      }
      return feature;
    }

    case 'surface_rule': {
      for (const surface of feature.surfaces) {
        const r = surface.rules.find((x) => String(x.id) === entityId);
        if (!r) continue;
        const next = ruleWithFieldSet(r, path, capturedValue);
        return next ? updateRuleOnSurface(feature, surface.id, next) : feature;
      }
      return feature;
    }

    case 'invariant': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const inv = cap.invariants.find((x) => String(x.id) === entityId);
          if (!inv) continue;
          const next = invariantWithFieldSet(inv, path, capturedValue);
          return next
            ? updateInvariantOnCapability(feature, surface.id, cap.id, inv.id, next)
            : feature;
        }
      }
      return feature;
    }

    case 'surface_invariant': {
      for (const surface of feature.surfaces) {
        const inv = surface.invariants.find((x) => String(x.id) === entityId);
        if (!inv) continue;
        const next = invariantWithFieldSet(inv, path, capturedValue);
        return next
          ? updateInvariantOnSurface(feature, surface.id, inv.id, next)
          : feature;
      }
      return feature;
    }

    case 'state': {
      for (const surface of feature.surfaces) {
        const s = surface.stateDefinitions.find((x) => String(x.id) === entityId);
        if (!s) continue;
        if (path === 'description') {
          const v = asString(capturedValue);
          return v === null
            ? feature
            : updateStateDefinition(feature, surface.id, s.id, { description: v });
        }
        if (path === 'enumValues') {
          const arr = asStringArray(capturedValue);
          return arr === null
            ? feature
            : updateStateDefinition(feature, surface.id, s.id, { enumValues: arr });
        }
        if (path === 'defaultValue') {
          return updateStateDefinition(feature, surface.id, s.id, {
            defaultValue: capturedValue as StateValue
          });
        }
        return feature;
      }
      return feature;
    }

    case 'data': {
      const d = feature.entities.find((x) => String(x.id) === entityId);
      if (!d) return feature;
      if (path === 'namespace' || path === 'description') {
        const v = asString(capturedValue);
        return v === null ? feature : updateEntity(feature, { ...d, [path]: v });
      }
      if (path === 'resourceId') {
        const v = asString(capturedValue);
        return v === null
          ? feature
          : updateEntity(feature, { ...d, resourceId: v as ResourceId });
      }
      return feature;
    }

    case 'transition': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const t = cap.transitions.find((x) => String(x.id) === entityId);
          if (!t) continue;
          const v = asString(capturedValue);
          if (v === null) return feature;
          return updateAction(feature, surface.id, cap.id, {
            transitions: cap.transitions.map((existing) =>
              existing.id === t.id ? { ...existing, [path]: v } : existing
            )
          });
        }
      }
      return feature;
    }

    case 'event':
      return feature;
  }
};
