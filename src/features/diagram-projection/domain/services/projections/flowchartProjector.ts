import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { DiagramEdge, DiagramNode, DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource, Projector } from '../../ports/Projector';

/**
 * Projects the model as a flowchart of structure and navigation: each feature
 * groups its surfaces, surfaces contain their actions, and an action that
 * transitions to another surface draws a "go to" edge. The feature level gives
 * the chart a real hierarchy (feature -> surface -> action) instead of a flat
 * cloud of surfaces. Evolution proposals are excluded. Pure.
 */

const featureNode = (featureId: string): string => `feature::${featureId}`;
const surfaceNode = (featureId: string, surfaceId: string): string => `${featureId}::surface::${surfaceId}`;
const actionNode = (featureId: string, actionId: string): string => `${featureId}::action::${actionId}`;

export const flowchartProjector: Projector = {
  format: 'flowchart',
  label: 'Flowchart',
  supportsText: true,

  project({ features, project }: ProjectionSource): DiagramSpec {
    const nodes: DiagramNode[] = [];
    const edges: DiagramEdge[] = [];
    const ids = new Set<string>();
    const add = (node: DiagramNode): void => {
      if (ids.has(node.id)) return;
      ids.add(node.id);
      nodes.push(node);
    };

    for (const feature of features) {
      const fid = String(feature.id);
      const fNode = featureNode(fid);
      add({ id: fNode, label: feature.name, kind: 'feature' });
      for (const surface of feature.surfaces) {
        const sNode = surfaceNode(fid, String(surface.id));
        add({ id: sNode, label: surface.name, kind: 'surface' });
        edges.push({ from: fNode, to: sNode });
        for (const action of committedActions(surface.actions)) {
          const aNode = actionNode(fid, String(action.id));
          add({ id: aNode, label: action.name, kind: 'action' });
          edges.push({ from: sNode, to: aNode });
          for (const effect of [...action.effects, ...(action.onBlockedEffects ?? [])]) {
            if (effect.type === 'transition_surface') {
              edges.push({ from: aNode, to: surfaceNode(fid, String(effect.target)), label: 'go to' });
            }
          }
        }
      }
    }

    const safeEdges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const title = project?.name ?? features[0]?.name ?? 'Flowchart';
    return { format: 'flowchart', title, nodes, edges: safeEdges };
  }
};
