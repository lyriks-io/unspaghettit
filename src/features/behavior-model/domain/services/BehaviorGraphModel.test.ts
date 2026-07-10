import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asEventName } from '../value-objects/EventName';
import { asStatePath } from '../value-objects/StatePath';
import {
  ALL_BEHAVIOR_GRAPH_EDGE_KINDS,
  buildBehaviorGraph,
  deriveBehaviorGraphView,
  filterBehaviorGraphView
} from './BehaviorGraphModel';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';

const surface: Surface = {
  id: asSurfaceId('checkout'),
  name: 'Checkout',
  type: 'screen',
  stateDefinitions: [
    {
      id: asStateDefinitionId('cart-total'),
      path: asStatePath('cart.total'),
      type: 'number',
      defaultValue: 0
    }
  ],
  rules: [],
  invariants: [],
  transitions: [],
  actions: [
    {
      id: asActionId('pay'),
      name: 'Pay',
      intent: 'Charge the cart and confirm the order.',
      parameters: [],
      requiredStates: [asStatePath('cart.total')],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('mark-paid'),
          type: 'set_state',
          path: asStatePath('order.paid'),
          value: true
        },
        {
          id: asEffectId('emit-paid'),
          type: 'emit_event',
          event: asEventName('order.paid')
        }
      ],
      emittedEvents: [asEventName('order.paid')],
      transitions: []
    }
  ]
};

const feature: Feature = {
  id: asFeatureId('commerce'),
  name: 'Commerce',
  surfaces: [surface],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

const project: Project = {
  id: asProjectId('shop'),
  name: 'Shop',
  featureIds: [feature.id],
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

describe('BehaviorGraphModel', () => {
  it('builds behavior relationships across a project and its features', () => {
    const graph = buildBehaviorGraph([feature], project);

    expect(graph.nodes.map((node) => node.id)).toContain('project:shop');
    expect(graph.nodes.map((node) => node.id)).toContain('feature:commerce');
    expect(graph.nodes.map((node) => node.id)).toContain('feature:commerce:surface:checkout');
    expect(graph.nodes.map((node) => node.id)).toContain('feature:commerce:action:pay');
    expect(graph.nodes.map((node) => node.id)).toContain('feature:commerce:state:cart.total');
    expect(graph.nodes.map((node) => node.id)).toContain('feature:commerce:state:order.paid');
    expect(graph.nodes.map((node) => node.id)).toContain('event:order.paid');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'project:shop',
          to: 'feature:commerce',
          kind: 'contains'
        }),
        expect.objectContaining({
          from: 'feature:commerce:state:cart.total',
          to: 'feature:commerce:action:pay',
          kind: 'reads'
        }),
        expect.objectContaining({
          from: 'feature:commerce:effect:mark-paid',
          to: 'feature:commerce:state:order.paid',
          kind: 'writes'
        }),
        expect.objectContaining({
          from: 'feature:commerce:effect:emit-paid',
          to: 'event:order.paid',
          kind: 'emits'
        })
      ])
    );
  });

  it('draws a writes edge for a collection mutation, not just set_state', () => {
    const cartSurface: Surface = {
      id: asSurfaceId('cart'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('lines'),
          path: asStatePath('cart.lines'),
          type: 'array',
          defaultValue: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId('add-line'),
          name: 'Add Line',
          intent: 'Append a line to the cart.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [
            {
              id: asEffectId('append-line'),
              type: 'append_to_list',
              path: asStatePath('cart.lines'),
              item: 'sku-1'
            }
          ],
          emittedEvents: [],
          transitions: []
        }
      ]
    };
    const cartFeature: Feature = {
      ...feature,
      id: asFeatureId('cartf'),
      name: 'Cartf',
      surfaces: [cartSurface]
    };
    const graph = buildBehaviorGraph([cartFeature]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'feature:cartf:effect:append-line',
          to: 'feature:cartf:state:cart.lines',
          kind: 'writes'
        })
      ])
    );
  });

  it('filters by search while preserving connected behavior context', () => {
    const view = deriveBehaviorGraphView(buildBehaviorGraph([feature], project));
    const filtered = filterBehaviorGraphView(view, {
      search: 'Pay',
      enabledKinds: Object.fromEntries(
        ALL_BEHAVIOR_GRAPH_EDGE_KINDS.map((kind) => [kind, true])
      ) as Record<(typeof ALL_BEHAVIOR_GRAPH_EDGE_KINDS)[number], boolean>
    });

    expect(filtered.nodes.map((node) => node.id)).toContain('feature:commerce:action:pay');
    expect(filtered.edges.length).toBeGreaterThan(0);
  });
});
