import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Transition } from '$features/behavior-model/domain/entities/Transition';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { EntityType } from './ImplementationStatus';

/** A single field comparison row. `path` is dot-notation (e.g. `condition.left`). */
export type FieldDiff = {
  readonly path: string;
  readonly spec: unknown;
  readonly captured: unknown;
  readonly equal: boolean;
  /** True when the captured side is `undefined` (LLM didn't extract this field). */
  readonly missingFromCaptured: boolean;
};

/**
 * Subset of the spec entity we project for diff. We only project the fields
 * that are interesting to compare against code. Keeping ids and other
 * spec-internal fields out of the diff. Each `EntityType` has its own
 * projection function.
 */
export type ProjectedSpec = Readonly<Record<string, unknown>>;

// Composite / undefined conditions don't have a flat left/operator/right
// shape. Project the full condition tree under one key for those; for the
// common leaf-condition case, keep the flat fields so older diff harnesses
// see the same shape they always did.
const projectConditionFields = (
  c: Rule['condition'] | Invariant['condition']
): Record<string, unknown> => {
  if (!c) return { condition: null };
  // Any kinded condition (composite all/any/not OR quantifier all_match/
  // any_match) lacks the flat left/operator/right shape — project the whole
  // tree under one key. Only true leaf conditions get the flat fields.
  if ('kind' in c) {
    return { condition: c };
  }
  return {
    'condition.left': String(c.left),
    'condition.operator': c.operator,
    'condition.right': c.right
  };
};

const projectRule = (r: Rule): ProjectedSpec => ({
  category: r.category,
  description: r.description,
  ...projectConditionFields(r.condition),
  'effect.type': r.effect.type,
  effect: r.effect
});

const projectInvariant = (inv: Invariant): ProjectedSpec => ({
  name: inv.name,
  description: inv.description,
  ...projectConditionFields(inv.condition),
  message: inv.message
});

const projectState = (s: StateDefinition): ProjectedSpec => ({
  path: String(s.path),
  type: s.type,
  defaultValue: s.defaultValue,
  enumValues: s.enumValues,
  description: s.description
});

const projectData = (d: Entity): ProjectedSpec => ({
  namespace: d.namespace,
  description: d.description,
  fields: d.fields,
  resourceId: d.resourceId
});

const projectCapability = (c: Action): ProjectedSpec => ({
  name: c.name,
  intent: c.intent,
  requiredStates: c.requiredStates.map((p) => String(p)),
  emittedEvents: c.emittedEvents.map((e) => String(e))
});

const projectTransition = (t: Transition): ProjectedSpec => ({
  target: String(t.target),
  label: t.label,
  description: t.description
});

const projectEvent = (name: string): ProjectedSpec => ({
  name
});

/**
 * Look up the spec entity by id within the feature and return its
 * projected field map. Returns null when the entity has been removed from
 * the spec since the audit ran (drift the UI surfaces explicitly).
 */
export const projectSpecEntity = (
  feature: Feature,
  entityType: EntityType,
  entityId: string
): ProjectedSpec | null => {
  switch (entityType) {
    case 'action': {
      for (const surface of feature.surfaces) {
        const cap = surface.actions.find((c) => String(c.id) === entityId);
        if (cap) return projectCapability(cap);
      }
      return null;
    }
    case 'event': {
      // Events are referenced by name; if any action still emits this name we keep it.
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          if (cap.emittedEvents.some((e) => String(e) === entityId)) return projectEvent(entityId);
        }
      }
      return null;
    }
    case 'rule': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const r = cap.rules.find((x) => String(x.id) === entityId);
          if (r) return projectRule(r);
        }
      }
      return null;
    }
    case 'invariant': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const inv = cap.invariants.find((x) => String(x.id) === entityId);
          if (inv) return projectInvariant(inv);
        }
      }
      return null;
    }
    case 'transition': {
      for (const surface of feature.surfaces) {
        for (const cap of surface.actions) {
          const t = cap.transitions.find((x) => String(x.id) === entityId);
          if (t) return projectTransition(t);
        }
      }
      return null;
    }
    case 'state': {
      for (const surface of feature.surfaces) {
        const s = surface.stateDefinitions.find((x) => String(x.id) === entityId);
        if (s) return projectState(s);
      }
      return null;
    }
    case 'data': {
      for (const d of feature.entities) {
        if (String(d.id) === entityId) return projectData(d);
      }
      return null;
    }
    case 'surface_rule': {
      for (const surface of feature.surfaces) {
        const r = surface.rules.find((x) => String(x.id) === entityId);
        if (r) return projectRule(r);
      }
      return null;
    }
    case 'surface_invariant': {
      for (const surface of feature.surfaces) {
        const inv = surface.invariants.find((x) => String(x.id) === entityId);
        if (inv) return projectInvariant(inv);
      }
      return null;
    }
  }
};

/**
 * Look up an arbitrary nested key in a captured-fields blob. Supports dotted
 * paths so `condition.operator` walks into the object even when the LLM
 * structured the capture nestedly. Falls back to the raw top-level key if
 * the dotted lookup fails (lets the LLM use either flat or nested shape).
 */
const readCapturedField = (captured: unknown, key: string): unknown => {
  if (captured === null || captured === undefined) return undefined;
  if (typeof captured !== 'object') return undefined;
  const obj = captured as Record<string, unknown>;
  if (key in obj) return obj[key];
  if (!key.includes('.')) return undefined;
  const segments = key.split('.');
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
};

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Compute the per-field diff between a projected spec entity and the captured
 * blob the LLM extracted from code. Walks every key in the projection so a
 * field that is `undefined` in capturedFields surfaces as `missingFromCaptured`.
 */
export const diffSpecAndCaptured = (
  spec: ProjectedSpec,
  captured: unknown
): readonly FieldDiff[] => {
  const out: FieldDiff[] = [];
  for (const key of Object.keys(spec)) {
    const specValue = spec[key];
    const capturedValue = readCapturedField(captured, key);
    const missingFromCaptured = capturedValue === undefined;
    out.push({
      path: key,
      spec: specValue,
      captured: capturedValue,
      equal: !missingFromCaptured && isEqual(specValue, capturedValue),
      missingFromCaptured
    });
  }
  return out;
};
