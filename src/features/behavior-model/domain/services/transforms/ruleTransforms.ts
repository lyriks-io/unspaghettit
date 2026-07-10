import type { ActionOutcome } from '../../entities/ActionOutcome';
import type { Feature } from '../../entities/Feature';
import type { Invariant } from '../../entities/Invariant';
import type { Rule } from '../../entities/Rule';
import type { Effect } from '../../value-objects/Effect';
import type {
  ActionId,
  EffectId,
  InvariantId,
  OutcomeId,
  RuleId,
  SurfaceId
} from '../../value-objects/ids';
import { mustMap, updateActionIn, updateSurface } from './internal';

export const addRuleToSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({ ...s, rules: [...s.rules, rule] }));

export const removeRuleFromSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  ruleId: RuleId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    rules: s.rules.filter((r) => r.id !== ruleId)
  }));

export const updateRuleOnSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    rules: mustMap(s.rules, String(rule.id), 'rule', () => rule)
  }));

export const addRuleToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({ ...c, rules: [...c.rules, rule] }))
  );

export const removeRuleFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  ruleId: RuleId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      rules: c.rules.filter((r) => r.id !== ruleId)
    }))
  );

export const updateRuleOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  rule: Rule
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      rules: mustMap(c.rules, String(rule.id), 'rule', () => rule)
    }))
  );

export const addEffectToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effect: Effect
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({ ...c, effects: [...c.effects, effect] }))
  );

export const updateEffectOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId,
  patch: Partial<Effect>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      effects: mustMap(c.effects, String(effectId), 'effect', (e) => ({ ...e, ...patch }) as Effect)
    }))
  );

export const removeEffectFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      effects: c.effects.filter((e) => e.id !== effectId)
    }))
  );

// ─── onBlockedEffects ─────────────────────────────────────────────────────
// The "what to do when this action is blocked" fallback list the simulator
// runs (state mutations suppressed, but transitions/events/messages fire) so a
// rejected action can still redirect or notify. Same add/update/remove shape as
// the success-path `effects`, but against `action.onBlockedEffects` (optional,
// so it defaults to []).

export const addOnBlockedEffectToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effect: Effect
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      onBlockedEffects: [...(c.onBlockedEffects ?? []), effect]
    }))
  );

export const updateOnBlockedEffectOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId,
  patch: Partial<Effect>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      onBlockedEffects: mustMap(
        c.onBlockedEffects ?? [],
        String(effectId),
        'onBlocked effect',
        (e) => ({ ...e, ...patch }) as Effect
      )
    }))
  );

export const removeOnBlockedEffectFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  effectId: EffectId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      onBlockedEffects: (c.onBlockedEffects ?? []).filter((e) => e.id !== effectId)
    }))
  );

export const addInvariantToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariant: Invariant
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: [...c.invariants, invariant]
    }))
  );

export const updateInvariantOnCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: mustMap(c.invariants, String(invariantId), 'invariant', (i) => ({ ...i, ...patch }))
    }))
  );

export const removeInvariantFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  invariantId: InvariantId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      invariants: c.invariants.filter((i) => i.id !== invariantId)
    }))
  );

export const addInvariantToSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariant: Invariant
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: [...s.invariants, invariant]
  }));

export const updateInvariantOnSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: mustMap(s.invariants, String(invariantId), 'invariant', (i) => ({ ...i, ...patch }))
  }));

export const removeInvariantFromSurface = (
  feature: Feature,
  surfaceId: SurfaceId,
  invariantId: InvariantId
): Feature =>
  updateSurface(feature, surfaceId, (s) => ({
    ...s,
    invariants: s.invariants.filter((i) => i.id !== invariantId)
  }));

// ─── Action outcomes ──────────────────────────────────────────────────────
// The terminal results an action can resolve to beyond success/blocked. Same
// add/remove shape as the other action sub-collections, against the optional
// `action.outcomes` list (defaults to []).

export const addOutcomeToCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  outcome: ActionOutcome
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      outcomes: [...(c.outcomes ?? []), outcome]
    }))
  );

export const removeOutcomeFromCapability = (
  feature: Feature,
  surfaceId: SurfaceId,
  actionId: ActionId,
  outcomeId: OutcomeId
): Feature =>
  updateSurface(feature, surfaceId, (s) =>
    updateActionIn(s, actionId, (c) => ({
      ...c,
      outcomes: (c.outcomes ?? []).filter((o) => o.id !== outcomeId)
    }))
  );

// ─── Feature-level invariants ─────────────────────────────────────────────
// Cross-surface invariants checked after every action regardless of which
// surface the action lives on. Mirrors the surface-level helpers above but
// against `feature.featureInvariants` instead of `surface.invariants`.

export const addFeatureInvariant = (feature: Feature, invariant: Invariant): Feature => ({
  ...feature,
  featureInvariants: [...(feature.featureInvariants ?? []), invariant]
});

export const updateFeatureInvariant = (
  feature: Feature,
  invariantId: InvariantId,
  patch: Partial<Invariant>
): Feature => ({
  ...feature,
  featureInvariants: mustMap(feature.featureInvariants ?? [], String(invariantId), 'featureInvariant', (i) => ({ ...i, ...patch }))
});

export const removeFeatureInvariant = (
  feature: Feature,
  invariantId: InvariantId
): Feature => ({
  ...feature,
  featureInvariants: (feature.featureInvariants ?? []).filter(
    (i) => i.id !== invariantId
  )
});
