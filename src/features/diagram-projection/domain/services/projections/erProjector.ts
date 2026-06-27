import type { DiagramNode, DiagramSpec } from '../../DiagramSpec';
import type { ProjectionSource, Projector } from '../../ports/Projector';

/**
 * Projects the data model as an entity-relationship diagram: each entity is a
 * node labelled with its fields. The model declares no entity-to-entity foreign
 * keys, so this is a structural view (no edges); content is "has entities".
 * Pure.
 */
export const erProjector: Projector = {
  format: 'er',
  label: 'ER diagram',
  supportsText: true,

  project({ features, project }: ProjectionSource): DiagramSpec {
    const nodes: DiagramNode[] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const fid = String(feature.id);
      for (const entity of feature.entities) {
        const id = `${fid}::entity::${String(entity.id)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const fields = entity.fields.map((field) => field.name).join(', ');
        nodes.push({
          id,
          label: fields ? `${entity.namespace} (${fields})` : entity.namespace,
          kind: 'entity'
        });
      }
    }

    const title = project?.name ?? features[0]?.name ?? 'ER diagram';
    return { format: 'er', title, nodes, edges: [] };
  }
};
