import type { DiagramEdge, DiagramNode, DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource, Projector } from '../../ports/Projector';

/**
 * Projects the behavior model as a statechart: each surface is a state, and
 * every transition between surfaces is an edge. Transitions are gathered from
 * the three places the model expresses navigation:
 *   - surface-level transitions (`surface.transitions`),
 *   - action-level transitions (`action.transitions`),
 *   - `transition_surface` effects on an action (success or on-blocked).
 *
 * Pure: reads the model, returns a `DiagramSpec`, mutates nothing.
 */

const nodeId = (featureId: string, surfaceId: string): string => `${featureId}::${surfaceId}`;

export const statechartProjector: Projector = {
  format: 'statechart',
  label: 'Statechart',
  supportsText: true,

  project({ features, project }: ProjectionSource): DiagramSpec {
    const nodes: DiagramNode[] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const fid = String(feature.id);
      for (const surface of feature.surfaces) {
        const id = nodeId(fid, String(surface.id));
        if (seen.has(id)) continue;
        seen.add(id);
        nodes.push({ id, label: surface.name, kind: surface.type });
      }
    }

    const edges: DiagramEdge[] = [];
    const addEdge = (fid: string, from: string, to: string, label?: string): void => {
      const fromId = nodeId(fid, from);
      const toId = nodeId(fid, to);
      // Only wire edges between surfaces we actually emitted as nodes.
      if (!seen.has(fromId) || !seen.has(toId)) return;
      edges.push({ from: fromId, to: toId, label });
    };

    for (const feature of features) {
      const fid = String(feature.id);
      for (const surface of feature.surfaces) {
        const sid = String(surface.id);

        for (const transition of surface.transitions) {
          addEdge(fid, sid, String(transition.target), transition.label);
        }

        for (const action of surface.actions) {
          for (const transition of action.transitions) {
            addEdge(fid, sid, String(transition.target), transition.label ?? action.name);
          }
          for (const effect of [...action.effects, ...(action.onBlockedEffects ?? [])]) {
            if (effect.type === 'transition_surface') {
              addEdge(fid, sid, String(effect.target), action.name);
            }
          }
        }
      }
    }

    const title = project?.name ?? features[0]?.name ?? 'Statechart';
    return { format: 'statechart', title, nodes, edges };
  }
};
