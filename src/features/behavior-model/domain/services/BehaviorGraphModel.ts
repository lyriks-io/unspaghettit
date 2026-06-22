import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import {
  flattenLeafConditions,
  isParamLeft
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import type { Project } from '$features/projects/domain/entities/Project';

export type BehaviorGraphNodeType =
  | 'feature'
  | 'surface'
  | 'action'
  | 'state'
  | 'event'
  | 'parameter'
  | 'rule'
  | 'effect'
  | 'invariant'
  | 'scenario'
  | 'persona'
  | 'resource'
  | 'entity'
  | 'valueSet';

export type BehaviorGraphEdgeKind =
  | 'contains'
  | 'reads'
  | 'writes'
  | 'emits'
  | 'transitions'
  | 'asserts'
  | 'uses'
  | 'handles';

export type BehaviorGraphNode = {
  readonly id: string;
  readonly type: BehaviorGraphNodeType;
  readonly label: string;
  readonly detail?: string;
  readonly layer: number;
  readonly href?: string;
};

export type BehaviorGraphEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: BehaviorGraphEdgeKind;
  readonly label?: string;
};

export type BehaviorGraph = {
  readonly nodes: readonly BehaviorGraphNode[];
  readonly edges: readonly BehaviorGraphEdge[];
};

export type BehaviorGraphViewNode = BehaviorGraphNode & {
  readonly degree: number;
};

export type BehaviorGraphView = {
  readonly nodes: readonly BehaviorGraphViewNode[];
  readonly edges: readonly BehaviorGraphEdge[];
  readonly nodeById: ReadonlyMap<string, BehaviorGraphViewNode>;
};

export type BehaviorGraphFilter = {
  readonly search: string;
  readonly enabledKinds: Readonly<Record<BehaviorGraphEdgeKind, boolean>>;
};

export const ALL_BEHAVIOR_GRAPH_EDGE_KINDS: readonly BehaviorGraphEdgeKind[] = [
  'contains',
  'reads',
  'writes',
  'emits',
  'transitions',
  'asserts',
  'uses',
  'handles'
];

export const ALL_BEHAVIOR_GRAPH_NODE_TYPES: readonly BehaviorGraphNodeType[] = [
  'feature',
  'surface',
  'action',
  'state',
  'event',
  'parameter',
  'rule',
  'effect',
  'invariant',
  'scenario',
  'persona',
  'resource',
  'entity',
  'valueSet'
];

const effectLabel = (effect: Effect): string => {
  switch (effect.type) {
    case 'set_state':
      return `set ${effect.path}`;
    case 'show_message':
      return effect.tone ? `${effect.tone} message` : 'message';
    case 'emit_event':
      return `emit ${effect.event}`;
    case 'block_action':
      return 'block';
    case 'allow_action':
      return 'allow';
    case 'transition_surface':
      return 'transition';
    case 'append_to_list':
      return `append ${effect.path}`;
    case 'remove_from_list':
      return `remove ${effect.path}`;
    case 'update_list_item':
      return `update ${effect.path}`;
    case 'advance_time':
      return 'advance time';
  }
};

const leafStatePaths = (condition: Parameters<typeof flattenLeafConditions>[0]): string[] => {
  const paths = new Set<string>();
  for (const leaf of flattenLeafConditions(condition)) {
    if (!isParamLeft(leaf.left)) paths.add(String(leaf.left));
  }
  return [...paths];
};

export const buildBehaviorGraph = (
  sourceFeatures: readonly Feature[],
  sourceProject?: Project
): BehaviorGraph => {
  const nodes = new Map<string, BehaviorGraphNode>();
  const edges = new Map<string, BehaviorGraphEdge>();

  const addNode = (node: BehaviorGraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: Omit<BehaviorGraphEdge, 'id'>): void => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    const id = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ''}`;
    if (!edges.has(id)) edges.set(id, { ...edge, id });
  };
  const ensureState = (feature: Feature, path: string, detail?: string): void => {
    addNode({
      id: `feature:${feature.id}:state:${path}`,
      type: 'state',
      label: path,
      detail,
      layer: 3
    });
  };
  const surfaceIdFor = (feature: Feature, id: unknown): string => `feature:${feature.id}:surface:${id}`;
  const actionIdFor = (feature: Feature, id: unknown): string => `feature:${feature.id}:action:${id}`;
  const stateIdFor = (feature: Feature, path: unknown): string => `feature:${feature.id}:state:${path}`;
  const valueSetIdFor = (feature: Feature, id: unknown): string => `feature:${feature.id}:valueSet:${id}`;

  const addEffectLinks = (
    feature: Feature,
    ownerId: string,
    effect: Effect,
    relation: 'contains' | 'writes'
  ): void => {
    const effectId = `feature:${feature.id}:effect:${effect.id}`;
    addNode({
      id: effectId,
      type: 'effect',
      label: effectLabel(effect),
      detail: effect.description ?? effect.type,
      layer: 5
    });
    addEdge({ from: ownerId, to: effectId, kind: relation });
    if (effect.type === 'set_state') {
      ensureState(feature, String(effect.path));
      addEdge({ from: effectId, to: stateIdFor(feature, effect.path), kind: 'writes' });
    } else if (effect.type === 'emit_event') {
      const eventId = `event:${effect.event}`;
      addNode({ id: eventId, type: 'event', label: String(effect.event), layer: 3 });
      addEdge({ from: effectId, to: eventId, kind: 'emits' });
    } else if (effect.type === 'transition_surface') {
      addEdge({ from: effectId, to: surfaceIdFor(feature, effect.target), kind: 'transitions' });
    }
  };

  const projectId = sourceProject ? `project:${sourceProject.id}` : null;
  if (sourceProject && projectId) {
    addNode({
      id: projectId,
      type: 'feature',
      label: sourceProject.name,
      detail: sourceProject.description ?? 'Project',
      layer: 0
    });
  }

  for (const feature of sourceFeatures) {
    const featureId = `feature:${feature.id}`;
    addNode({
      id: featureId,
      type: 'feature',
      label: feature.name,
      detail: feature.description,
      layer: sourceProject ? 1 : 0,
      href: `/features/${feature.id}`
    });
    if (projectId) addEdge({ from: projectId, to: featureId, kind: 'contains' });

    for (const persona of feature.personas) {
      const id = `feature:${feature.id}:persona:${persona.id}`;
      addNode({
        id,
        type: 'persona',
        label: persona.name,
        detail: persona.description,
        layer: sourceProject ? 2 : 1
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
    }

    for (const resource of feature.resources) {
      const id = `resource:${resource.id}`;
      addNode({
        id,
        type: 'resource',
        label: resource.name,
        detail: resource.description ?? resource.kind,
        layer: sourceProject ? 2 : 1
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
    }

    for (const entity of feature.entities) {
      const id = `entity:${entity.id}`;
      addNode({
        id,
        type: 'entity',
        label: entity.namespace,
        detail: entity.description,
        layer: sourceProject ? 2 : 1
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
      if (entity.resourceId) addEdge({ from: id, to: `resource:${entity.resourceId}`, kind: 'uses' });
    }

    for (const valueSet of feature.valueSets ?? []) {
      const id = valueSetIdFor(feature, valueSet.id);
      addNode({
        id,
        type: 'valueSet',
        label: valueSet.name,
        detail: `${valueSet.values.length} values`,
        layer: sourceProject ? 2 : 1
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
    }

    for (const event of feature.events ?? []) {
      const id = `event:${event.name}`;
      addNode({
        id,
        type: 'event',
        label: String(event.name),
        detail: event.description,
        layer: 3
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
    }

    for (const invariant of feature.featureInvariants ?? []) {
      const id = `feature:${feature.id}:invariant:${invariant.id}`;
      addNode({
        id,
        type: 'invariant',
        label: invariant.name,
        detail: invariant.description ?? invariant.message,
        layer: 6
      });
      addEdge({ from: featureId, to: id, kind: 'contains' });
      for (const path of leafStatePaths(invariant.condition)) {
        ensureState(feature, path);
        addEdge({ from: id, to: stateIdFor(feature, path), kind: 'reads' });
      }
    }

    for (const surface of feature.surfaces) {
      const surfaceId = surfaceIdFor(feature, surface.id);
      addNode({
        id: surfaceId,
        type: 'surface',
        label: surface.name,
        detail: surface.description ?? surface.type,
        layer: sourceProject ? 2 : 1,
        href: `/features/${feature.id}?surface=${surface.id}`
      });
      addEdge({ from: featureId, to: surfaceId, kind: 'contains' });
      if (surface.parentSurfaceId) {
        addEdge({ from: surfaceIdFor(feature, surface.parentSurfaceId), to: surfaceId, kind: 'contains' });
      }

      for (const def of surface.stateDefinitions) {
        ensureState(feature, String(def.path), def.description ?? def.type);
        addEdge({ from: surfaceId, to: stateIdFor(feature, def.path), kind: 'contains' });
        if (def.valueSetId) {
          addEdge({ from: stateIdFor(feature, def.path), to: valueSetIdFor(feature, def.valueSetId), kind: 'uses' });
        }
      }

      for (const transition of surface.transitions) {
        const id = `feature:${feature.id}:transition:${transition.id}`;
        addNode({
          id,
          type: 'effect',
          label: transition.label ?? 'transition',
          detail: transition.description,
          layer: 6
        });
        addEdge({ from: surfaceId, to: id, kind: 'contains' });
        addEdge({ from: id, to: surfaceIdFor(feature, transition.target), kind: 'transitions' });
      }

      for (const rule of surface.rules) {
        const id = `feature:${feature.id}:rule:${rule.id}`;
        addNode({
          id,
          type: 'rule',
          label: rule.category,
          detail: rule.description,
          layer: 6
        });
        addEdge({ from: surfaceId, to: id, kind: 'contains' });
        for (const path of leafStatePaths(rule.condition)) {
          ensureState(feature, path);
          addEdge({ from: id, to: stateIdFor(feature, path), kind: 'reads' });
        }
        addEffectLinks(feature, id, rule.effect, 'writes');
      }

      for (const invariant of surface.invariants) {
        const id = `feature:${feature.id}:invariant:${invariant.id}`;
        addNode({
          id,
          type: 'invariant',
          label: invariant.name,
          detail: invariant.description ?? invariant.message,
          layer: 6
        });
        addEdge({ from: surfaceId, to: id, kind: 'contains' });
        for (const path of leafStatePaths(invariant.condition)) {
          ensureState(feature, path);
          addEdge({ from: id, to: stateIdFor(feature, path), kind: 'reads' });
        }
      }

      for (const action of surface.actions) {
        const actionId = actionIdFor(feature, action.id);
        addNode({
          id: actionId,
          type: 'action',
          label: action.name,
          detail: action.intent,
          layer: sourceProject ? 3 : 2,
          href: `/features/${feature.id}?surface=${surface.id}&panel=actions`
        });
        addEdge({ from: surfaceId, to: actionId, kind: 'contains' });
        if (action.triggeredByEvent) {
          const eventId = `event:${action.triggeredByEvent}`;
          addNode({ id: eventId, type: 'event', label: String(action.triggeredByEvent), layer: 3 });
          addEdge({ from: eventId, to: actionId, kind: 'handles' });
        }

        for (const path of action.requiredStates) {
          ensureState(feature, String(path));
          addEdge({ from: stateIdFor(feature, path), to: actionId, kind: 'reads' });
        }

        for (const parameter of action.parameters) {
          const id = `feature:${feature.id}:parameter:${parameter.id}`;
          addNode({
            id,
            type: 'parameter',
            label: parameter.name,
            detail: parameter.description ?? parameter.type,
            layer: sourceProject ? 5 : 4
          });
          addEdge({ from: actionId, to: id, kind: 'contains' });
          if (parameter.bindToStatePath) {
            ensureState(feature, String(parameter.bindToStatePath));
            addEdge({ from: id, to: stateIdFor(feature, parameter.bindToStatePath), kind: 'writes' });
          }
          if (parameter.resourceId) addEdge({ from: id, to: `resource:${parameter.resourceId}`, kind: 'uses' });
          if (parameter.valueSetId) {
            addEdge({ from: id, to: valueSetIdFor(feature, parameter.valueSetId), kind: 'uses' });
          }
        }

        for (const rule of action.rules) {
          const id = `feature:${feature.id}:rule:${rule.id}`;
          addNode({
            id,
            type: 'rule',
            label: rule.category,
            detail: rule.description,
            layer: 6
          });
          addEdge({ from: actionId, to: id, kind: 'contains' });
          for (const path of leafStatePaths(rule.condition)) {
            ensureState(feature, path);
            addEdge({ from: id, to: stateIdFor(feature, path), kind: 'reads' });
          }
          addEffectLinks(feature, id, rule.effect, 'writes');
        }

        for (const invariant of action.invariants) {
          const id = `feature:${feature.id}:invariant:${invariant.id}`;
          addNode({
            id,
            type: 'invariant',
            label: invariant.name,
            detail: invariant.description ?? invariant.message,
            layer: 6
          });
          addEdge({ from: actionId, to: id, kind: 'contains' });
          for (const path of leafStatePaths(invariant.condition)) {
            ensureState(feature, path);
            addEdge({ from: id, to: stateIdFor(feature, path), kind: 'reads' });
          }
        }

        for (const effect of action.effects) addEffectLinks(feature, actionId, effect, 'contains');
        for (const effect of action.onBlockedEffects ?? []) addEffectLinks(feature, actionId, effect, 'contains');

        for (const event of action.emittedEvents) {
          const eventId = `event:${event}`;
          addNode({ id: eventId, type: 'event', label: String(event), layer: 3 });
          addEdge({ from: actionId, to: eventId, kind: 'emits' });
        }

        for (const transition of action.transitions) {
          const id = `feature:${feature.id}:transition:${transition.id}`;
          addNode({
            id,
            type: 'effect',
            label: transition.label ?? 'transition',
            detail: transition.description,
            layer: 6
          });
          addEdge({ from: actionId, to: id, kind: 'contains' });
          addEdge({ from: id, to: surfaceIdFor(feature, transition.target), kind: 'transitions' });
        }

        for (const scenario of action.scenarios ?? []) {
          const id = `feature:${feature.id}:scenario:${scenario.id}`;
          addNode({
            id,
            type: 'scenario',
            label: scenario.name,
            detail: scenario.description ?? scenario.expectedStatus,
            layer: 6
          });
          addEdge({ from: actionId, to: id, kind: 'asserts' });
          if (scenario.personaId) {
            addEdge({ from: id, to: `feature:${feature.id}:persona:${scenario.personaId}`, kind: 'uses' });
          }
          for (const override of scenario.stateOverrides) {
            ensureState(feature, String(override.path));
            addEdge({ from: id, to: stateIdFor(feature, override.path), kind: 'writes' });
          }
          for (const assertion of scenario.expectedAssertions ?? []) {
            ensureState(feature, String(assertion.path));
            addEdge({ from: id, to: stateIdFor(feature, assertion.path), kind: 'asserts' });
          }
          if (scenario.expectedTransition) {
            addEdge({ from: id, to: surfaceIdFor(feature, scenario.expectedTransition), kind: 'transitions' });
          }
        }
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
};

export const deriveBehaviorGraphView = (graph: BehaviorGraph): BehaviorGraphView => {
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const nodes = graph.nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
  return {
    nodes,
    edges: graph.edges,
    nodeById: new Map(nodes.map((node) => [node.id, node]))
  };
};

export const filterBehaviorGraphView = (
  graph: BehaviorGraphView,
  filter: BehaviorGraphFilter
): BehaviorGraphView => {
  const query = filter.search.trim().toLowerCase();
  const matching = new Set<string>();
  if (query) {
    for (const node of graph.nodes) {
      const haystack = `${node.label} ${node.type} ${node.detail ?? ''}`.toLowerCase();
      if (haystack.includes(query)) matching.add(node.id);
    }
    for (const edge of graph.edges) {
      if (matching.has(edge.from) || matching.has(edge.to)) {
        matching.add(edge.from);
        matching.add(edge.to);
      }
    }
  }

  const nodeAllowed = (id: string): boolean => !query || matching.has(id);
  const edges = graph.edges.filter(
    (edge) => filter.enabledKinds[edge.kind] && nodeAllowed(edge.from) && nodeAllowed(edge.to)
  );
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const nodes = graph.nodes.filter(
    (node) => nodeAllowed(node.id) && (!query || connected.has(node.id) || matching.has(node.id))
  );

  return {
    nodes,
    edges,
    nodeById: new Map(nodes.map((node) => [node.id, node]))
  };
};
