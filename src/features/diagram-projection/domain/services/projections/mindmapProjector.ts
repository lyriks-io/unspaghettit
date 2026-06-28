import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { DiagramEdge, DiagramNode, DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource, Projector } from '../../ports/Projector';

/**
 * Projects the containment hierarchy as a mindmap: root (project or feature) ->
 * features -> surfaces -> actions. Always has content when a model is loaded.
 * Pure.
 */

const surfaceNode = (featureId: string, surfaceId: string): string => `${featureId}::surface::${surfaceId}`;
const actionNode = (featureId: string, actionId: string): string => `${featureId}::action::${actionId}`;

export const mindmapProjector: Projector = {
  format: 'mindmap',
  label: 'Mindmap',
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

    const rootLabel = project?.name ?? features[0]?.name ?? 'Model';
    const rootId = project ? `project::${String(project.id)}` : `feature::${String(features[0]?.id ?? 'root')}`;
    add({ id: rootId, label: rootLabel, kind: 'root' });

    for (const feature of features) {
      const fid = String(feature.id);
      let parent = rootId;
      if (project) {
        const fNode = `feature::${fid}`;
        add({ id: fNode, label: feature.name, kind: 'feature' });
        edges.push({ from: rootId, to: fNode });
        parent = fNode;
      }
      for (const surface of feature.surfaces) {
        const sNode = surfaceNode(fid, String(surface.id));
        add({ id: sNode, label: surface.name, kind: 'surface' });
        edges.push({ from: parent, to: sNode });
        for (const action of committedActions(surface.actions)) {
          const aNode = actionNode(fid, String(action.id));
          add({ id: aNode, label: action.name, kind: 'action' });
          edges.push({ from: sNode, to: aNode });
        }
      }
    }

    const title = rootLabel;
    return { format: 'mindmap', title, nodes, edges };
  }
};
