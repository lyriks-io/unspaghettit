import { buildBehaviorGraph } from '$features/behavior-model/domain/services/BehaviorGraphModel';
import type { DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource } from '../../ports/Projector';

/**
 * Adapts the existing free behavior graph (projector #1) into a `DiagramSpec`
 * so the interactive graph can also be exported as DOT / SVG. Display still
 * uses the vis-network renderer; this is purely the export bridge. Pure.
 */
export const graphToDiagramSpec = ({ features, project }: ProjectionSource): DiagramSpec => {
  const graph = buildBehaviorGraph(features, project);
  return {
    format: 'graph',
    title: project?.name ?? features[0]?.name ?? 'Behavior graph',
    nodes: graph.nodes.map((node) => ({ id: node.id, label: node.label, kind: node.type })),
    edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.kind }))
  };
};
