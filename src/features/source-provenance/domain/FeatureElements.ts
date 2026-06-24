import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ElementType } from '$features/source-provenance/domain/Provenance';

export type FeatureElement = {
  readonly id: string;
  readonly type: ElementType;
  /** Human label for the element, for tooltips and the untraced-elements list. */
  readonly label: string;
};

/**
 * The canonical set of "extracted elements" a source span can be traced to:
 * every surface, action, state, rule, invariant, transition, event and entity
 * in the feature. (Effects are sub-parts of an action/rule and reachability
 * goals/personas/resources are not source-derived, so they aren't tracked
 * individually here.) Used to validate `record_element_span`, to size the
 * finalize gate, and by the viewer to label each span with the element it
 * produced.
 */
export const enumerateFeatureElements = (feature: Feature): readonly FeatureElement[] => {
  const out: FeatureElement[] = [];
  const add = (id: string, type: ElementType, label: string): void => {
    out.push({ id, type, label });
  };

  for (const surface of feature.surfaces) {
    add(String(surface.id), 'surface', surface.name);
    for (const sd of surface.stateDefinitions) add(String(sd.id), 'state', String(sd.path));
    for (const rule of surface.rules) add(String(rule.id), 'rule', rule.description ?? rule.category);
    for (const inv of surface.invariants) add(String(inv.id), 'invariant', inv.name);
    for (const t of surface.transitions) {
      add(String(t.id), 'transition', t.label ?? t.description ?? 'Transition');
    }
    for (const action of surface.actions) {
      add(String(action.id), 'action', action.name);
      for (const rule of action.rules) add(String(rule.id), 'rule', rule.description ?? rule.category);
      for (const inv of action.invariants) add(String(inv.id), 'invariant', inv.name);
      for (const t of action.transitions) {
        add(String(t.id), 'transition', t.label ?? t.description ?? 'Transition');
      }
    }
  }
  for (const inv of feature.featureInvariants ?? []) add(String(inv.id), 'invariant', inv.name);
  for (const ev of feature.events ?? []) add(String(ev.id), 'event', String(ev.name));
  for (const entity of feature.entities) add(String(entity.id), 'entity', entity.namespace);
  return out;
};

export const featureElementCount = (feature: Feature): number =>
  enumerateFeatureElements(feature).length;
