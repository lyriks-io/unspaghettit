import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';

/**
 * Static reachability over a feature's NAVIGATION graph — the directed graph
 * whose nodes are surfaces and whose edges are "you can move from surface A to
 * surface B". Where {@link exploreStateSpace} explores the DATA state space
 * (what values state can take), this answers the structural question a modeler
 * keeps getting wrong: "can the user actually get to this screen, and can they
 * ever leave it?"
 *
 * Edges come from two places, unioned:
 *   - a surface's declared `transitions[]` (the navigation catalog), and
 *   - every `transition_surface` effect reachable from that surface (on its
 *     actions, their on-blocked fallbacks, and its surface-level rules) — the
 *     navigation that actually fires at runtime.
 *
 * The entry surface is the first declared surface (the convention the dashboard
 * and simulator already use as the starting context). Reachability is a plain
 * BFS from there. This is a PURE, COMPLETE analysis (no bound, no simulation):
 * it reasons over the declared graph, so a surface flagged unreachable has no
 * incoming edge at all. Findings are advisory — an app may legitimately expose
 * a surface through a channel the model doesn't encode (a global nav bar, a
 * deep link) — so callers surface these as warnings, not hard failures.
 */
export type UnreachableSurface = {
  readonly surfaceId: string;
  readonly surfaceName: string;
};

export type TerminalSurface = {
  readonly surfaceId: string;
  readonly surfaceName: string;
};

export type SurfaceReachabilityReport = {
  /** First declared surface; the BFS root. `null` for a feature with no surfaces. */
  readonly entrySurfaceId: string | null;
  /** Ids of surfaces reachable from the entry (includes the entry itself). */
  readonly reachableSurfaceIds: readonly string[];
  /**
   * Declared surfaces with no path from the entry. The user can never navigate
   * here through the modeled transitions — usually a missing `transition_surface`
   * effect or a dangling target.
   */
  readonly unreachableSurfaces: readonly UnreachableSurface[];
  /**
   * Surfaces with no outgoing navigation at all. Legitimate for a true end
   * state ("Order complete"), suspicious for a screen the user should be able
   * to back out of — reported so the modeler can confirm intent.
   */
  readonly terminalSurfaces: readonly TerminalSurface[];
};

const collectTransitionTarget = (effect: Effect, into: string[]): void => {
  if (effect.type === 'transition_surface') into.push(String(effect.target));
};

/** Every surface id this surface can navigate to, declared edges + effect edges. */
const outgoingTargets = (surface: Surface): readonly string[] => {
  const targets: string[] = [];
  for (const transition of surface.transitions) targets.push(String(transition.target));
  for (const action of surface.actions) collectActionTargets(action, targets);
  for (const rule of surface.rules) collectTransitionTarget(rule.effect, targets);
  return targets;
};

const collectActionTargets = (action: Action, into: string[]): void => {
  for (const effect of action.effects) collectTransitionTarget(effect, into);
  for (const effect of action.onBlockedEffects ?? []) collectTransitionTarget(effect, into);
  for (const rule of action.rules) collectTransitionTarget(rule.effect, into);
};

export const analyzeSurfaceReachability = (feature: Feature): SurfaceReachabilityReport => {
  const surfaces = feature.surfaces;
  if (surfaces.length === 0) {
    return {
      entrySurfaceId: null,
      reachableSurfaceIds: [],
      unreachableSurfaces: [],
      terminalSurfaces: []
    };
  }

  // Adjacency restricted to real surfaces — a dangling target (validator's job
  // to catch) can't make a phantom node reachable and can't be a false orphan.
  const surfaceIds = new Set(surfaces.map((s) => String(s.id)));
  const edges = new Map<string, readonly string[]>();
  for (const surface of surfaces) {
    edges.set(
      String(surface.id),
      outgoingTargets(surface).filter((t) => surfaceIds.has(t))
    );
  }

  // Safe: the empty-feature case returned above, so index 0 exists.
  const entry = String(surfaces[0]!.id);
  const reachable = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of edges.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const unreachableSurfaces: UnreachableSurface[] = [];
  const terminalSurfaces: TerminalSurface[] = [];
  for (const surface of surfaces) {
    const id = String(surface.id);
    if (!reachable.has(id)) {
      unreachableSurfaces.push({ surfaceId: id, surfaceName: surface.name });
    }
    if ((edges.get(id) ?? []).length === 0) {
      terminalSurfaces.push({ surfaceId: id, surfaceName: surface.name });
    }
  }

  return {
    entrySurfaceId: entry,
    reachableSurfaceIds: [...reachable],
    unreachableSurfaces,
    terminalSurfaces
  };
};
