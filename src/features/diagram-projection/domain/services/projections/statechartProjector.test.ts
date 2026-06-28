import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { diagramHasContent } from '../../DiagramSpec';
import { statechartProjector } from './statechartProjector';

const emptySurface = (id: string, name: string): Surface => ({
  id: asSurfaceId(id),
  name,
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

const feature = (surfaces: Surface[]): Feature => ({
  id: asFeatureId('f1'),
  name: 'Demo',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
});

describe('statechartProjector', () => {
  it('maps surfaces to states and gathers transitions from effects and surface edges', () => {
    const viewer: Surface = {
      ...emptySurface('viewer', 'Projection Viewer'),
      actions: [
        {
          id: asActionId('open'),
          name: 'Open Export',
          intent: 'Open the export panel.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [{ id: asEffectId('t'), type: 'transition_surface', target: asSurfaceId('export') }],
          emittedEvents: [],
          transitions: []
        }
      ]
    };
    const exportSurface: Surface = {
      ...emptySurface('export', 'Export'),
      transitions: [{ id: asTransitionId('back'), target: asSurfaceId('viewer'), label: 'Close' }]
    };

    const spec = statechartProjector.project({ features: [feature([viewer, exportSurface])] });

    expect(spec.format).toBe('statechart');
    expect(spec.nodes.map((n) => n.label).sort()).toEqual(['Export', 'Projection Viewer']);
    expect(spec.edges).toContainEqual({ from: 'f1::viewer', to: 'f1::export', label: 'Open Export' });
    expect(spec.edges).toContainEqual({ from: 'f1::export', to: 'f1::viewer', label: 'Close' });
    expect(diagramHasContent(spec)).toBe(true);
  });

  it('has no content when the model declares no transitions', () => {
    const spec = statechartProjector.project({
      features: [feature([emptySurface('a', 'A'), emptySurface('b', 'B')])]
    });

    expect(spec.nodes).toHaveLength(2);
    expect(spec.edges).toHaveLength(0);
    expect(diagramHasContent(spec)).toBe(false);
  });

  it('drops transitions whose target surface is not in the model', () => {
    const viewer: Surface = {
      ...emptySurface('viewer', 'Viewer'),
      transitions: [{ id: asTransitionId('x'), target: asSurfaceId('ghost'), label: 'Nope' }]
    };

    const spec = statechartProjector.project({ features: [feature([viewer])] });

    expect(spec.edges).toHaveLength(0);
  });

  it('uses the project name as the title when projecting a whole project', () => {
    const spec = statechartProjector.project({
      features: [feature([emptySurface('a', 'A')])],
      // minimal Project stub — only `name` is read by the projector
      project: { name: 'My Project' } as never
    });

    expect(spec.title).toBe('My Project');
  });
});
