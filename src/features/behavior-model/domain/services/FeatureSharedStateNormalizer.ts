import type { Feature } from '../entities/Feature';
import type { StateDefinition } from '../entities/StateDefinition';
import type { Surface } from '../entities/Surface';
import type { Effect } from '../value-objects/Effect';
import { isExpression, type Expression } from '../value-objects/Expression';
import {
  flattenLeafConditions,
  type RuleCondition
} from '../value-objects/RuleCondition';
import { asSurfaceId, type SurfaceId } from '../value-objects/ids';

/**
 * When a surface's rules / actions / invariants read or write a state path
 * declared on a *sibling* surface, automatically add the reading surface
 * to that StateDefinition's `sharedWith`. This kills the most common
 * "unshared state" recommended issue without forcing the author to keep a
 * sharedWith list in their head across every cross-surface reference.
 *
 * Behaviour:
 *   - Only adds. Never removes. If the human deliberately broadened sharing
 *     beyond what the spec references, we keep that.
 *   - Only fires when a path is declared on exactly one surface and a
 *     different surface references it. Multi-declarations (rare; usually
 *     a modelling error) are left alone.
 *   - Idempotent: the writer surface is added only if not already present.
 */
export const normalizeFeatureSharedState = (feature: Feature): Feature => {
  // Build path → owning surfaceId map. If a path is declared on multiple
  // surfaces, skip it (ambiguous, let the validator surface that).
  const ownerByPath = new Map<string, SurfaceId | null>();
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      const path = String(def.path);
      ownerByPath.set(path, ownerByPath.has(path) ? null : surface.id);
    }
  }

  // For each surface, collect every state path it references.
  // surfaceId → set of paths referenced from that surface.
  const referencesBySurface = new Map<string, Set<string>>();
  for (const surface of feature.surfaces) {
    referencesBySurface.set(String(surface.id), collectStatePathsOnSurface(surface));
  }

  // For each (owner, path), find which other surfaces reference the path
  // and add them to sharedWith if missing.
  let touched = false;
  const nextSurfaces = feature.surfaces.map((surface) => {
    const nextDefs = surface.stateDefinitions.map((def): StateDefinition => {
      const path = String(def.path);
      const owner = ownerByPath.get(path);
      if (owner === null || owner !== surface.id) return def;
      const readers: SurfaceId[] = [];
      for (const other of feature.surfaces) {
        if (other.id === surface.id) continue;
        if (referencesBySurface.get(String(other.id))?.has(path)) {
          readers.push(asSurfaceId(String(other.id)));
        }
      }
      if (readers.length === 0) return def;
      const existing = new Set((def.sharedWith ?? []).map(String));
      const additions = readers.filter((id) => !existing.has(String(id)));
      if (additions.length === 0) return def;
      touched = true;
      return {
        ...def,
        sharedWith: [...(def.sharedWith ?? []), ...additions]
      };
    });
    if (nextDefs.every((d, i) => d === surface.stateDefinitions[i])) return surface;
    return { ...surface, stateDefinitions: nextDefs };
  });
  if (!touched) return feature;
  return { ...feature, surfaces: nextSurfaces };
};

const collectStatePathsOnSurface = (surface: Surface): Set<string> => {
  const out = new Set<string>();
  // Recurse through composite conditions and skip unconditional rules.
  // Each leaf contributes its `.left` path and any state-reference buried
  // in a `.right` Expression.
  const addCondition = (c: RuleCondition | undefined) => {
    for (const leaf of flattenLeafConditions(c)) {
      out.add(String(leaf.left));
      if (isExpression(leaf.right)) collectExpr(leaf.right, out);
    }
  };
  const addEffect = (e: Effect) => {
    switch (e.type) {
      case 'set_state':
        out.add(String(e.path));
        if (isExpression(e.value)) collectExpr(e.value, out);
        return;
      case 'append_to_list':
        out.add(String(e.path));
        if (isExpression(e.item)) collectExpr(e.item, out);
        return;
      case 'remove_from_list':
        out.add(String(e.path));
        if (e.where && isExpression(e.where.equals)) collectExpr(e.where.equals, out);
        if (isExpression(e.value)) collectExpr(e.value, out);
        return;
      case 'update_list_item':
        out.add(String(e.path));
        if (isExpression(e.where.equals)) collectExpr(e.where.equals, out);
        if (isExpression(e.value)) collectExpr(e.value, out);
        return;
      case 'advance_time':
        if (isExpression(e.by)) collectExpr(e.by, out);
        return;
      default:
        return;
    }
  };
  for (const r of surface.rules) {
    addCondition(r.condition);
    addEffect(r.effect);
  }
  for (const i of surface.invariants) addCondition(i.condition);
  for (const a of surface.actions) {
    for (const p of a.requiredStates) out.add(String(p));
    for (const r of a.rules) {
      addCondition(r.condition);
      addEffect(r.effect);
    }
    for (const i of a.invariants) addCondition(i.condition);
    for (const e of a.effects) addEffect(e);
    for (const e of a.onBlockedEffects ?? []) addEffect(e);
  }
  return out;
};

const collectExpr = (expr: Expression, out: Set<string>): void => {
  if (!isExpression(expr)) return;
  switch (expr.kind) {
    case 'literal':
    case 'param':
    case 'const':
      return;
    case 'state':
      out.add(String(expr.path));
      return;
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
    case 'sum_pluck':
      collectExpr(expr.operand, out);
      return;
    case 'count_where':
      collectExpr(expr.operand, out);
      collectExpr(expr.equals, out);
      return;
    case 'switch':
      for (const c of expr.cases) {
        for (const leaf of flattenLeafConditions(c.when)) {
          out.add(String(leaf.left));
          if (isExpression(leaf.right)) collectExpr(leaf.right, out);
        }
        collectExpr(c.then, out);
      }
      collectExpr(expr.default, out);
      return;
    default:
      collectExpr(expr.left, out);
      collectExpr(expr.right, out);
  }
};
