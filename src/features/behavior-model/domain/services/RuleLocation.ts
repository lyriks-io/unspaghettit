import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ActionId, SurfaceId } from '$features/behavior-model/domain/value-objects/ids';

/**
 * Where a rule lives inside a feature. A rule is either a surface-level rule
 * (fires before every action on the surface) or an action-level rule (guards
 * one action). Both render through the same RuleEditor, but revealing one to a
 * deep link differs: a surface rule needs the surface panel's "rules" tab; an
 * action rule needs its owning action's card expanded.
 */
export type RuleLocation =
  | { readonly kind: 'surface'; readonly surfaceId: SurfaceId }
  | { readonly kind: 'action'; readonly surfaceId: SurfaceId; readonly actionId: ActionId };

/**
 * Resolve a rule id to its home surface (and owning action, if any). Rule ids
 * are unique within a feature, so this is enough to drive `?focus=rule:<id>`
 * deep linking from the id alone — the caller need not know whether it points
 * at a surface rule or an action rule. Returns null when no rule matches.
 */
export const locateRule = (feature: Feature, ruleId: string): RuleLocation | null => {
  for (const surface of feature.surfaces) {
    if (surface.rules.some((rule) => String(rule.id) === ruleId)) {
      return { kind: 'surface', surfaceId: surface.id };
    }
    for (const action of surface.actions) {
      if (action.rules.some((rule) => String(rule.id) === ruleId)) {
        return { kind: 'action', surfaceId: surface.id, actionId: action.id };
      }
    }
  }
  return null;
};
