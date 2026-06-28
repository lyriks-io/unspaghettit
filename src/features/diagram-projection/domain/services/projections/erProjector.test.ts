import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { diagramHasContent } from '../../DiagramSpec';
import { erProjector } from './erProjector';

const feature = (entities: Feature['entities']): Feature => ({
  id: asFeatureId('f'),
  name: 'F',
  surfaces: [],
  personas: [],
  resources: [],
  entities,
  createdAt: '',
  updatedAt: ''
});

describe('erProjector', () => {
  it('emits one node per entity, labelled with its fields', () => {
    const spec = erProjector.project({
      features: [
        feature([
          {
            id: 'e1' as never,
            namespace: 'diagram',
            fields: [
              { id: 'f1' as never, name: 'format', type: 'string' },
              { id: 'f2' as never, name: 'nodeCount', type: 'number' }
            ]
          }
        ])
      ]
    });

    expect(spec.format).toBe('er');
    expect(spec.nodes).toHaveLength(1);
    expect(spec.nodes[0]?.label).toBe('diagram (format, nodeCount)');
    expect(diagramHasContent(spec)).toBe(true);
  });

  it('has no content when the model has no entities', () => {
    const spec = erProjector.project({ features: [feature([])] });
    expect(spec.nodes).toHaveLength(0);
    expect(diagramHasContent(spec)).toBe(false);
  });
});
