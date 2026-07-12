import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Rule } from '../../../src/features/behavior-model/domain/entities/Rule';
import type { Effect } from '../../../src/features/behavior-model/domain/value-objects/Effect';
import {
  asAcceptanceCriterionId,
  asActionId,
  asEffectId,
  asInvariantId,
  asReachabilityGoalId,
  asRuleId,
  asSurfaceId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import {
  buildAcceptanceCriterion,
  buildAcceptanceCriterionPatch,
  buildInvariant as buildInvariantBody,
  buildInvariantPatch,
  buildReachabilityGoal,
  buildReachabilityGoalPatch
} from '../_entity_builders';
import { buildEffect, buildRule, resolve, type Op, type OpContext } from './opHelpers';

/**
 * Rule, Effect, Invariant (action, surface, and feature level), and
 * reachability goal op families. Returns the next Feature when it handled
 * op.kind and null when the op belongs to another family.
 */
export const applyRuleInvariantOps = (op: Op, ctx: OpContext): Feature | null => {
  const { refs, mintId, remember } = ctx;
  let exp = ctx.feature;
  switch (op.kind) {
    // ── Rules ───────────────────────────────────────────────────────
    case 'add_action_rule': {
      const rule = buildRule(mintId, (op.rule as Op) ?? op, refs);
      exp = T.addRuleToCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        rule
      );
      remember(op.ref, rule.id);
      break;
    }
    case 'update_action_rule': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      const cid = asActionId(resolve(op, refs, 'actionRef', 'actionId'));
      const rid = asRuleId(op.ruleId as string);
      const surface = exp.surfaces.find((s) => s.id === sid);
      const cap = surface?.actions.find((c) => c.id === cid);
      const existing = cap?.rules.find((r) => r.id === rid);
      if (!existing) break;
      const patch = (op.patch as Record<string, unknown> | undefined) ?? {};
      const merged: Rule = {
        ...existing,
        ...(patch.category !== undefined ? { category: patch.category as Rule['category'] } : {}),
        ...(patch.condition !== undefined
          ? { condition: patch.condition as unknown as Rule['condition'] }
          : {}),
        ...(patch.effect !== undefined
          ? {
              effect: {
                ...(patch.effect as object),
                id: asEffectId(
                  ((patch.effect as { id?: string }).id ?? existing.effect.id) as string
                )
              } as unknown as Rule['effect']
            }
          : {}),
        ...(typeof patch.description === 'string' ? { description: patch.description } : {})
      };
      exp = T.updateRuleOnCapability(exp, sid, cid, merged);
      break;
    }
    case 'remove_action_rule':
      exp = T.removeRuleFromCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asRuleId(op.ruleId as string)
      );
      break;
    case 'add_surface_rule': {
      const rule = buildRule(mintId, (op.rule as Op) ?? op, refs);
      exp = T.addRuleToSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        rule
      );
      remember(op.ref, rule.id);
      break;
    }
    case 'update_surface_rule': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      const rid = asRuleId(op.ruleId as string);
      const surface = exp.surfaces.find((s) => s.id === sid);
      const existing = surface?.rules.find((r) => r.id === rid);
      if (!existing) break;
      const patch = (op.patch as Record<string, unknown> | undefined) ?? {};
      const merged: Rule = {
        ...existing,
        ...(patch.category !== undefined ? { category: patch.category as Rule['category'] } : {}),
        ...(patch.condition !== undefined
          ? { condition: patch.condition as unknown as Rule['condition'] }
          : {}),
        ...(patch.effect !== undefined
          ? {
              effect: {
                ...(patch.effect as object),
                id: asEffectId(
                  ((patch.effect as { id?: string }).id ?? existing.effect.id) as string
                )
              } as unknown as Rule['effect']
            }
          : {}),
        ...(typeof patch.description === 'string' ? { description: patch.description } : {})
      };
      exp = T.updateRuleOnSurface(exp, sid, merged);
      break;
    }
    case 'remove_surface_rule':
      exp = T.removeRuleFromSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asRuleId(op.ruleId as string)
      );
      break;

    // ── Effects ─────────────────────────────────────────────────────
    // `onBlocked:true` targets the action's onBlockedEffects (the blocked-path
    // fallback the simulator runs) instead of the success-path effects.
    case 'add_effect': {
      const effect = buildEffect(mintId, (op.effect as Record<string, unknown>) ?? {}, refs);
      exp = (op.onBlocked ? T.addOnBlockedEffectToCapability : T.addEffectToCapability)(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        effect
      );
      remember(op.ref, effect.id);
      break;
    }
    case 'update_effect':
      exp = (op.onBlocked ? T.updateOnBlockedEffectOnCapability : T.updateEffectOnCapability)(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asEffectId(op.effectId as string),
        (op.patch as Partial<Effect>) ?? {}
      );
      break;
    case 'remove_effect':
      exp = (op.onBlocked ? T.removeOnBlockedEffectFromCapability : T.removeEffectFromCapability)(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asEffectId(op.effectId as string)
      );
      break;

    // ── Invariants ──────────────────────────────────────────────────
    case 'add_action_invariant': {
      const inv = buildInvariantBody(
        (op.invariant as Record<string, unknown>) ?? op,
        mintId
      );
      exp = T.addInvariantToCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        inv
      );
      remember(op.ref, inv.id);
      break;
    }
    case 'update_action_invariant':
      exp = T.updateInvariantOnCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asInvariantId(op.invariantId as string),
        buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
      );
      break;
    case 'remove_action_invariant':
      exp = T.removeInvariantFromCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asInvariantId(op.invariantId as string)
      );
      break;
    case 'add_surface_invariant': {
      const inv = buildInvariantBody(
        (op.invariant as Record<string, unknown>) ?? op,
        mintId
      );
      exp = T.addInvariantToSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        inv
      );
      remember(op.ref, inv.id);
      break;
    }
    case 'update_surface_invariant':
      exp = T.updateInvariantOnSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asInvariantId(op.invariantId as string),
        buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
      );
      break;
    case 'remove_surface_invariant':
      exp = T.removeInvariantFromSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asInvariantId(op.invariantId as string)
      );
      break;

    // ── Feature invariants ──────────────────────────────────────────
    // Cross-surface invariants live at the feature level so a single
    // declaration covers every action, no matter which surface it sits
    // on. Use for accounting / global referential properties.
    case 'add_feature_invariant': {
      const inv = buildInvariantBody(
        (op.invariant as Record<string, unknown>) ?? op,
        mintId
      );
      exp = T.addFeatureInvariant(exp, inv);
      remember(op.ref, inv.id);
      break;
    }
    case 'update_feature_invariant':
      exp = T.updateFeatureInvariant(
        exp,
        asInvariantId(op.invariantId as string),
        buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
      );
      break;
    case 'remove_feature_invariant':
      exp = T.removeFeatureInvariant(
        exp,
        asInvariantId(op.invariantId as string)
      );
      break;

    // ── Reachability / liveness goals ───────────────────────────────
    // Feature-level liveness: "this target state is reachable" or "stays
    // reachable from everywhere". The complement to feature invariants.
    case 'add_reachability_goal': {
      const goal = buildReachabilityGoal(
        (op.goal as Record<string, unknown>) ?? op,
        mintId
      );
      exp = T.addReachabilityGoal(exp, goal);
      remember(op.ref, goal.id);
      break;
    }
    case 'update_reachability_goal':
      exp = T.updateReachabilityGoal(
        exp,
        asReachabilityGoalId(op.goalId as string),
        buildReachabilityGoalPatch((op.patch as Record<string, unknown>) ?? {})
      );
      break;
    case 'remove_reachability_goal':
      exp = T.removeReachabilityGoal(
        exp,
        asReachabilityGoalId(op.goalId as string)
      );
      break;

    // ── Acceptance criteria ─────────────────────────────────────────
    // Feature-level prose acceptance tests (Given/When/Then), the
    // documentation complement to the model-checked action-level Scenario.
    // Not simulated or scored; the only hard rule is a non-empty title.
    case 'add_acceptance_criterion': {
      const criterion = buildAcceptanceCriterion(
        (op.criterion as Record<string, unknown>) ?? op,
        mintId
      );
      exp = T.addAcceptanceCriterion(exp, criterion);
      remember(op.ref, criterion.id);
      break;
    }
    case 'update_acceptance_criterion':
      exp = T.updateAcceptanceCriterion(
        exp,
        asAcceptanceCriterionId(op.criterionId as string),
        buildAcceptanceCriterionPatch((op.patch as Record<string, unknown>) ?? {})
      );
      break;
    case 'remove_acceptance_criterion':
      exp = T.removeAcceptanceCriterion(
        exp,
        asAcceptanceCriterionId(op.criterionId as string)
      );
      break;

    default:
      return null;
  }
  return exp;
};
