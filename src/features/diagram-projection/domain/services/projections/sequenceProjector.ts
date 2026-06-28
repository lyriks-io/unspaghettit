import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { DiagramEdge, DiagramNode, DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource, Projector } from '../../ports/Projector';

/**
 * Projects event-driven choreography as a sequence: when one action emits an
 * event and another action handles it (`triggeredByEvent`), draw an edge from
 * emitter to handler labelled with the event. A model with no event handlers
 * yields an empty diagram (nothing to sequence). Pure.
 */

const actionNode = (featureId: string, actionId: string): string => `${featureId}::action::${actionId}`;

export const sequenceProjector: Projector = {
  format: 'sequence',
  label: 'Sequence',
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
      const handlersByEvent = new Map<string, { id: string; name: string }[]>();
      const emitters: { id: string; name: string; event: string }[] = [];

      for (const surface of feature.surfaces) {
        for (const action of committedActions(surface.actions)) {
          const aNode = actionNode(fid, String(action.id));
          if (action.triggeredByEvent) {
            const event = String(action.triggeredByEvent);
            const list = handlersByEvent.get(event) ?? [];
            list.push({ id: aNode, name: action.name });
            handlersByEvent.set(event, list);
          }
          for (const event of action.emittedEvents) {
            emitters.push({ id: aNode, name: action.name, event: String(event) });
          }
        }
      }

      for (const emitter of emitters) {
        for (const handler of handlersByEvent.get(emitter.event) ?? []) {
          add({ id: emitter.id, label: emitter.name, kind: 'action' });
          add({ id: handler.id, label: handler.name, kind: 'action' });
          edges.push({ from: emitter.id, to: handler.id, label: emitter.event });
        }
      }
    }

    const title = project?.name ?? features[0]?.name ?? 'Sequence';
    return { format: 'sequence', title, nodes, edges };
  }
};
