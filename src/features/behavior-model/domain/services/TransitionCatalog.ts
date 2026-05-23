import type { Feature } from '../entities/Feature';

/**
 * Where a surface→surface transition was authored. Used by the UI to deep-link
 * back to the source and to show *why* a navigation can happen.
 */
export type TransitionOrigin =
  | 'declared'
  | 'action_effect'
  | 'action_rule_effect'
  | 'surface_rule_effect';

export type TransitionSource = {
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId?: string;
  readonly actionName?: string;
  readonly origin: TransitionOrigin;
  /** Optional rationale (rule.description, transition.label, …) */
  readonly description?: string;
};

export type TransitionEntry = {
  readonly fromSurfaceId: string;
  readonly fromSurfaceName: string;
  readonly toSurfaceId: string;
  readonly toSurfaceName: string;
  readonly sources: readonly TransitionSource[];
};

/**
 * Walk every surface and collect every authored transition between two
 * surfaces, regardless of where it lives in the model:
 *  - `surface.transitions` (declared navigation hints)
 *  - action default effects of type `transition_surface`
 *  - action rule effects of type `transition_surface`
 *  - surface-level rule effects of type `transition_surface`
 *
 * Edges with the same (from, to) pair collapse into one entry whose
 * `sources` lists every contribution. Output is sorted by source surface
 * order (matches the feature editor's surface list), then by target surface name.
 */
export const buildTransitionCatalog = (
  feature: Feature
): readonly TransitionEntry[] => {
  const surfaceById = new Map<string, { name: string; index: number }>();
  feature.surfaces.forEach((s, index) => {
    surfaceById.set(s.id as unknown as string, { name: s.name, index });
  });

  type Acc = { sources: TransitionSource[]; fromIndex: number };
  const byEdge = new Map<string, Acc>();

  const targetExists = (id: string | undefined): id is string =>
    id !== undefined && surfaceById.has(id);

  const push = (
    fromId: string,
    toId: string,
    source: TransitionSource
  ) => {
    if (!targetExists(toId)) return; // dangling targets don't make a real edge
    const key = `${fromId}__${toId}`;
    let acc = byEdge.get(key);
    if (!acc) {
      acc = { sources: [], fromIndex: surfaceById.get(fromId)?.index ?? 0 };
      byEdge.set(key, acc);
    }
    acc.sources.push(source);
  };

  for (const surface of feature.surfaces) {
    const fromId = surface.id as unknown as string;
    const fromName = surface.name;

    for (const transition of surface.transitions) {
      push(fromId, transition.target as unknown as string, {
        surfaceId: fromId,
        surfaceName: fromName,
        origin: 'declared',
        description: transition.label ?? transition.description
      });
    }

    for (const cap of surface.actions) {
      // Default effects.
      for (const effect of cap.effects) {
        if (effect.type === 'transition_surface') {
          push(fromId, effect.target as unknown as string, {
            surfaceId: fromId,
            surfaceName: fromName,
            actionId: cap.id as unknown as string,
            actionName: cap.name,
            origin: 'action_effect',
            description: effect.description
          });
        }
      }
      // Rule effects.
      for (const rule of cap.rules) {
        if (rule.effect.type === 'transition_surface') {
          push(fromId, rule.effect.target as unknown as string, {
            surfaceId: fromId,
            surfaceName: fromName,
            actionId: cap.id as unknown as string,
            actionName: cap.name,
            origin: 'action_rule_effect',
            description: rule.description
          });
        }
      }
    }

    for (const rule of surface.rules) {
      if (rule.effect.type === 'transition_surface') {
        push(fromId, rule.effect.target as unknown as string, {
          surfaceId: fromId,
          surfaceName: fromName,
          origin: 'surface_rule_effect',
          description: rule.description
        });
      }
    }
  }

  const entries: TransitionEntry[] = [];
  for (const [key, acc] of byEdge) {
    const [fromId, toId] = key.split('__') as [string, string];
    const from = surfaceById.get(fromId);
    const to = surfaceById.get(toId);
    if (!from || !to) continue;
    entries.push({
      fromSurfaceId: fromId,
      fromSurfaceName: from.name,
      toSurfaceId: toId,
      toSurfaceName: to.name,
      sources: acc.sources
    });
  }
  entries.sort((a, b) => {
    const fa = surfaceById.get(a.fromSurfaceId)?.index ?? 0;
    const fb = surfaceById.get(b.fromSurfaceId)?.index ?? 0;
    if (fa !== fb) return fa - fb;
    const ta = surfaceById.get(a.toSurfaceId)?.index ?? 0;
    const tb = surfaceById.get(b.toSurfaceId)?.index ?? 0;
    return ta - tb;
  });
  return entries;
};

export type TransitionGroup = {
  readonly fromSurfaceId: string;
  readonly fromSurfaceName: string;
  readonly transitions: readonly TransitionEntry[];
};

export const groupTransitionCatalog = (
  entries: readonly TransitionEntry[]
): readonly TransitionGroup[] => {
  const map = new Map<string, TransitionGroup>();
  for (const entry of entries) {
    let group = map.get(entry.fromSurfaceId);
    if (!group) {
      group = {
        fromSurfaceId: entry.fromSurfaceId,
        fromSurfaceName: entry.fromSurfaceName,
        transitions: []
      };
      map.set(entry.fromSurfaceId, group);
    }
    (group.transitions as TransitionEntry[]).push(entry);
  }
  return Array.from(map.values());
};
