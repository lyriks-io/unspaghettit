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
import {
  buildEffect,
  buildRule,
  flatFields,
  notFoundInOp,
  requireSomeChange,
  resolve,
  type Op,
  type OpContext,
  type Refs
} from './opHelpers';

/** The four patchable Rule fields, picked from either spelling. */
const pickRulePatch = (op: Op): Record<string, unknown> => {
  const src = (op.patch as Record<string, unknown> | undefined) ?? op;
  return {
    ...(src.category !== undefined ? { category: src.category } : {}),
    ...(src.condition !== undefined ? { condition: src.condition } : {}),
    ...(src.effect !== undefined ? { effect: src.effect } : {}),
    ...(typeof src.description === 'string' ? { description: src.description } : {})
  };
};

const mergeRule = (existing: Rule, picked: Record<string, unknown>): Rule => ({
  ...existing,
  ...(picked.category !== undefined ? { category: picked.category as Rule['category'] } : {}),
  ...(picked.condition !== undefined
    ? { condition: picked.condition as unknown as Rule['condition'] }
    : {}),
  ...(picked.effect !== undefined
    ? {
        effect: {
          ...(picked.effect as object),
          id: asEffectId(
            ((picked.effect as { id?: string }).id ?? existing.effect.id) as string
          )
        } as unknown as Rule['effect']
      }
    : {}),
  ...(typeof picked.description === 'string' ? { description: picked.description } : {})
});

/**
 * Resolve `relations[].criterionRef` against the batch refs into `criterionId`,
 * so a criterion can supersede one that was added earlier in the same batch. An
 * explicit `criterionId` wins. The builders only ever see ids.
 */
const resolveCriterionRelationRefs = (
  op: Op,
  input: Record<string, unknown>,
  refs: Refs
): Record<string, unknown> => {
  if (!Array.isArray(input.relations)) return input;
  return {
    ...input,
    relations: input.relations.map((raw: unknown) => {
      const relation = (raw ?? {}) as Record<string, unknown>;
      const ref = relation.criterionRef;
      if (typeof ref !== 'string' || ref.length === 0 || relation.criterionId !== undefined) {
        return relation;
      }
      const id = refs[ref];
      if (!id) throw new Error(`${op.kind}: unknown criterionRef "${ref}" in relations`);
      return { ...relation, criterionId: id };
    })
  };
};

/**
 * Rule, Effect, Invariant (action, surface, and feature level), and
 * reachability goal op families. Returns the next Feature when it handled
 * op.kind and null when the op belongs to another family.
 */

/**
 * update_effect and remove_effect address the effects of the action itself
 * (or its blocked-attempt effects with onBlocked). An id that is the effect of
 * one of its rules, of a rule of its surface or of one of its outcomes lives
 * there: refuse by naming where, and the operation that changes it there,
 * instead of "not found" or a removal that leaves it in place (criterion
 * d9212a83 of feat-mcp-authoring). An id found nowhere is left to the usual
 * path: not found for an update, idempotent for a removal.
 */
const refuseEffectLivingElsewhere = (
  exp: Feature,
  op: Op,
  refs: Refs,
  kind: 'update_effect' | 'remove_effect'
): void => {
  const effectId = String(op.effectId ?? '');
  if (!effectId) return;
  const sid = String(resolve(op, refs, 'surfaceRef', 'surfaceId'));
  const cid = String(resolve(op, refs, 'actionRef', 'actionId'));
  const surface = exp.surfaces.find((s) => String(s.id) === sid);
  const action = surface?.actions.find((a) => String(a.id) === cid);
  if (!surface || !action) return;
  const own = op.onBlocked ? (action.onBlockedEffects ?? []) : action.effects;
  if (own.some((effect) => String(effect.id) === effectId)) return;
  const label = (rule: { id: unknown; description?: string; category?: string }): string =>
    `rule ${String(rule.id)}${rule.description ? ` ("${rule.description}")` : rule.category ? ` (${rule.category})` : ''}`;
  const verb = kind === 'update_effect' ? 'change it' : 'remove it';
  const onRule = action.rules.find((rule) => rule.effect && String(rule.effect.id) === effectId);
  if (onRule) {
    throw new Error(
      `${kind}: effect ${effectId} is the effect of ${label(onRule)} of action ${cid}, not one of the action's own effects. To ${verb}, use update_action_rule { surfaceId: "${sid}", actionId: "${cid}", ruleId: "${String(onRule.id)}", patch: { effect: {...} } }${kind === 'remove_effect' ? ' with another effect, or remove_action_rule to drop the rule' : ''}.`
    );
  }
  const onSurfaceRule = surface.rules.find((rule) => rule.effect && String(rule.effect.id) === effectId);
  if (onSurfaceRule) {
    throw new Error(
      `${kind}: effect ${effectId} is the effect of surface ${label(onSurfaceRule)} of surface ${sid}. To ${verb}, use update_surface_rule { surfaceId: "${sid}", ruleId: "${String(onSurfaceRule.id)}", patch: { effect: {...} } }${kind === 'remove_effect' ? ' with another effect, or remove_surface_rule to drop the rule' : ''}.`
    );
  }
  const onOutcome = (action.outcomes ?? []).find((outcome) =>
    (outcome.effects ?? []).some((effect) => String(effect.id) === effectId)
  );
  if (onOutcome) {
    throw new Error(
      `${kind}: effect ${effectId} is an effect of outcome ${String(onOutcome.id)} ("${onOutcome.name}") of action ${cid}. An outcome's effects change with the outcome: remove_action_outcome { outcomeId: "${String(onOutcome.id)}" } then add_action_outcome with the effects it should carry.`
    );
  }
};

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
      if (!existing) {
        // The realistic miss: the id belongs to the OTHER rule level. Say so,
        // instead of the silent success that taught agents update was broken.
        const atSurfaceLevel = surface?.rules.some((r) => r.id === rid);
        throw notFoundInOp(
          op,
          'rule',
          rid,
          `on action ${String(cid)} of surface ${String(sid)}${
            atSurfaceLevel
              ? `. A rule with this id exists at SURFACE level; use update_surface_rule`
              : ''
          }`
        );
      }
      const picked = pickRulePatch(op);
      requireSomeChange(op, picked, ['category', 'condition', 'effect', 'description']);
      exp = T.updateRuleOnCapability(exp, sid, cid, mergeRule(existing, picked));
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
      if (!existing) {
        const owningAction = surface?.actions.find((c) =>
          c.rules.some((r) => r.id === rid)
        );
        throw notFoundInOp(
          op,
          'rule',
          rid,
          `on surface ${String(sid)}${
            owningAction
              ? `. A rule with this id exists on ACTION ${String(owningAction.id)}; use update_action_rule`
              : ''
          }`
        );
      }
      const picked = pickRulePatch(op);
      requireSomeChange(op, picked, ['category', 'condition', 'effect', 'description']);
      exp = T.updateRuleOnSurface(exp, sid, mergeRule(existing, picked));
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
    case 'update_effect': {
      const patch =
        (op.patch as Partial<Effect> | undefined) ??
        (flatFields(op, [
          'kind',
          'ref',
          'surfaceId',
          'surfaceRef',
          'actionId',
          'actionRef',
          'effectId',
          'onBlocked'
        ]) as Partial<Effect>);
      requireSomeChange(op, patch as Record<string, unknown>, [
        'the effect fields to change (type, path, value, event, target, message, ...)'
      ]);
      refuseEffectLivingElsewhere(exp, op, refs, 'update_effect');
      exp = (op.onBlocked ? T.updateOnBlockedEffectOnCapability : T.updateEffectOnCapability)(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asEffectId(op.effectId as string),
        patch
      );
      break;
    }
    case 'remove_effect':
      refuseEffectLivingElsewhere(exp, op, refs, 'remove_effect');
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
    case 'update_action_invariant': {
      const patch = buildInvariantPatch((op.patch as Record<string, unknown>) ?? op);
      requireSomeChange(op, patch, ['name', 'condition', 'message', 'description']);
      exp = T.updateInvariantOnCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asInvariantId(op.invariantId as string),
        patch
      );
      break;
    }
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
    case 'update_surface_invariant': {
      const patch = buildInvariantPatch((op.patch as Record<string, unknown>) ?? op);
      requireSomeChange(op, patch, ['name', 'condition', 'message', 'description']);
      exp = T.updateInvariantOnSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asInvariantId(op.invariantId as string),
        patch
      );
      break;
    }
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
    case 'update_feature_invariant': {
      const patch = buildInvariantPatch((op.patch as Record<string, unknown>) ?? op);
      requireSomeChange(op, patch, ['name', 'condition', 'message', 'description']);
      exp = T.updateFeatureInvariant(exp, asInvariantId(op.invariantId as string), patch);
      break;
    }
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
    case 'update_reachability_goal': {
      // Flat spelling cannot carry the goal's `kind` (that key is the op
      // discriminator), so it rides as `goalKind`; the nested patch uses
      // `patch.kind` as documented.
      const src =
        (op.patch as Record<string, unknown> | undefined) ??
        {
          ...flatFields(op, ['kind', 'ref', 'goalId', 'goalKind']),
          ...(typeof op.goalKind === 'string' ? { kind: op.goalKind } : {})
        };
      const patch = buildReachabilityGoalPatch(src);
      requireSomeChange(op, patch, [
        'name',
        'kind (patch.kind, or goalKind on the flat form)',
        'condition',
        'message',
        'description'
      ]);
      exp = T.updateReachabilityGoal(exp, asReachabilityGoalId(op.goalId as string), patch);
      break;
    }
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
        resolveCriterionRelationRefs(op, (op.criterion as Record<string, unknown>) ?? op, refs),
        mintId
      );
      exp = T.addAcceptanceCriterion(exp, criterion);
      remember(op.ref, criterion.id);
      break;
    }
    case 'update_acceptance_criterion': {
      const patch = buildAcceptanceCriterionPatch(
        resolveCriterionRelationRefs(op, (op.patch as Record<string, unknown>) ?? op, refs)
      );
      requireSomeChange(op, patch, [
        'title',
        'given',
        'when',
        'then',
        'expectedOutcome',
        'relatedSurfaceId',
        'description',
        'status',
        'relations'
      ]);
      exp = T.updateAcceptanceCriterion(
        exp,
        // `criterionRef` addresses a criterion added earlier in the same batch:
        // the usual move is "add the new one, mark the old one superseded".
        asAcceptanceCriterionId(resolve(op, refs, 'criterionRef', 'criterionId')),
        patch
      );
      break;
    }
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
