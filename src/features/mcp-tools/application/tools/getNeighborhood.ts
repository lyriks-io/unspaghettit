import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import { flattenLeafConditions } from '$features/behavior-model/domain/value-objects/RuleCondition';

export type NeighborhoodEdgeKind = 'reads' | 'writes' | 'emits' | 'transitions' | 'contains';

export const ALL_NEIGHBORHOOD_EDGE_KINDS: readonly NeighborhoodEdgeKind[] = [
  'reads',
  'writes',
  'emits',
  'transitions',
  'contains'
];

export type NeighborhoodNode =
  | {
      readonly key: string;
      readonly type: 'feature';
      readonly id: string;
      readonly name: string;
    }
  | {
      readonly key: string;
      readonly type: 'surface';
      readonly id: string;
      readonly name: string;
      readonly surfaceType: string;
      readonly featureId: string;
    }
  | {
      readonly key: string;
      readonly type: 'action';
      readonly id: string;
      readonly name: string;
      readonly intent: string;
      readonly surfaceId: string;
      readonly surfaceName: string;
    }
  | {
      readonly key: string;
      readonly type: 'state';
      readonly path: string;
      readonly stateType?: string;
      readonly enumValues?: readonly string[];
      readonly surfaceId?: string;
      readonly surfaceName?: string;
    }
  | {
      readonly key: string;
      readonly type: 'event';
      readonly name: string;
    };

export type NeighborhoodEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: NeighborhoodEdgeKind;
};

export type Neighborhood = {
  readonly root: NeighborhoodNode;
  readonly depth: number;
  readonly edgeKinds: readonly NeighborhoodEdgeKind[];
  /** All reached nodes (root included), keyed by their `key`. */
  readonly nodes: readonly NeighborhoodNode[];
  /** Edges incident on the reached nodes (filtered by `edgeKinds`). */
  readonly edges: readonly NeighborhoodEdge[];
  /** Distance from root for every reached node. 0 for root. */
  readonly distances: Readonly<Record<string, number>>;
};

const capabilityNodeKey = (id: string) => `action:${id}`;
const surfaceNodeKey = (id: string) => `surface:${id}`;
const stateNodeKey = (path: string) => `state:${path}`;
const eventNodeKey = (name: string) => `event:${name}`;
const featureNodeKey = (id: string) => `feature:${id}`;

type EdgeIndex = {
  readonly outgoing: ReadonlyMap<string, readonly NeighborhoodEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly NeighborhoodEdge[]>;
  readonly nodes: ReadonlyMap<string, NeighborhoodNode>;
};

const collectWrittenPaths = (effects: readonly Effect[]): readonly string[] => {
  const out: string[] = [];
  for (const e of effects) if (e.type === 'set_state') out.push(String(e.path));
  return out;
};

const collectEmitted = (action: Action): readonly string[] => {
  const names = new Set<string>();
  for (const n of action.emittedEvents) names.add(String(n));
  for (const e of action.effects) if (e.type === 'emit_event') names.add(String(e.event));
  for (const e of action.onBlockedEffects ?? []) {
    if (e.type === 'emit_event') names.add(String(e.event));
  }
  return [...names];
};

const collectTransitionTargets = (action: Action): readonly string[] => {
  const targets = new Set<string>();
  for (const e of action.effects) {
    if (e.type === 'transition_surface') targets.add(String(e.target));
  }
  for (const e of action.onBlockedEffects ?? []) {
    if (e.type === 'transition_surface') targets.add(String(e.target));
  }
  for (const t of action.transitions) targets.add(String(t.target));
  return [...targets];
};

const collectReadPaths = (action: Action): readonly string[] => {
  const paths = new Set<string>();
  for (const r of action.requiredStates) paths.add(String(r));
  for (const rule of action.rules) {
    for (const leaf of flattenLeafConditions(rule.condition)) paths.add(String(leaf.left));
  }
  for (const inv of action.invariants) {
    for (const leaf of flattenLeafConditions(inv.condition)) paths.add(String(leaf.left));
  }
  for (const p of action.parameters) {
    if (p.bindToStatePath) paths.add(String(p.bindToStatePath));
  }
  return [...paths];
};

/**
 * Build a flat node + edge index for the entire feature graph. The
 * neighborhood walk then runs BFS over this index without re-traversing the
 * domain model. Edge kinds match the visualization layer: `contains` for
 * hierarchy (feature → surface → action, surface → state), `reads`/
 * `writes` for state access, `emits` for events, `transitions` for surface
 * navigation.
 */
const buildIndex = (feature: Feature): EdgeIndex => {
  const nodes = new Map<string, NeighborhoodNode>();
  const outgoing = new Map<string, NeighborhoodEdge[]>();
  const incoming = new Map<string, NeighborhoodEdge[]>();

  const addEdge = (edge: NeighborhoodEdge): void => {
    const out = outgoing.get(edge.from) ?? [];
    out.push(edge);
    outgoing.set(edge.from, out);
    const inc = incoming.get(edge.to) ?? [];
    inc.push(edge);
    incoming.set(edge.to, inc);
  };

  const ensureStateNode = (
    path: string,
    surface?: Surface
  ): void => {
    const key = stateNodeKey(path);
    if (nodes.has(key)) return;
    const def = surface?.stateDefinitions.find((d) => String(d.path) === path);
    nodes.set(key, {
      key,
      type: 'state',
      path,
      ...(def?.type ? { stateType: def.type } : {}),
      ...(def?.enumValues ? { enumValues: def.enumValues } : {}),
      ...(surface ? { surfaceId: String(surface.id), surfaceName: surface.name } : {})
    });
  };

  const expKey = featureNodeKey(String(feature.id));
  nodes.set(expKey, {
    key: expKey,
    type: 'feature',
    id: String(feature.id),
    name: feature.name
  });

  for (const surface of feature.surfaces) {
    const sKey = surfaceNodeKey(String(surface.id));
    nodes.set(sKey, {
      key: sKey,
      type: 'surface',
      id: String(surface.id),
      name: surface.name,
      surfaceType: surface.type,
      featureId: String(feature.id)
    });
    addEdge({ from: expKey, to: sKey, kind: 'contains' });

    for (const def of surface.stateDefinitions) {
      ensureStateNode(String(def.path), surface);
      addEdge({ from: sKey, to: stateNodeKey(String(def.path)), kind: 'contains' });
    }

    for (const cap of surface.actions) {
      const cKey = capabilityNodeKey(String(cap.id));
      nodes.set(cKey, {
        key: cKey,
        type: 'action',
        id: String(cap.id),
        name: cap.name,
        intent: cap.intent,
        surfaceId: String(surface.id),
        surfaceName: surface.name
      });
      addEdge({ from: sKey, to: cKey, kind: 'contains' });

      for (const path of collectReadPaths(cap)) {
        ensureStateNode(path);
        addEdge({ from: stateNodeKey(path), to: cKey, kind: 'reads' });
      }
      const writes = new Set<string>();
      for (const p of collectWrittenPaths(cap.effects)) writes.add(p);
      for (const p of collectWrittenPaths(cap.onBlockedEffects ?? [])) writes.add(p);
      for (const rule of cap.rules) {
        if (rule.effect.type === 'set_state') writes.add(String(rule.effect.path));
      }
      for (const path of writes) {
        ensureStateNode(path);
        addEdge({ from: cKey, to: stateNodeKey(path), kind: 'writes' });
      }

      for (const evtName of collectEmitted(cap)) {
        const eKey = eventNodeKey(evtName);
        if (!nodes.has(eKey)) {
          nodes.set(eKey, { key: eKey, type: 'event', name: evtName });
        }
        addEdge({ from: cKey, to: eKey, kind: 'emits' });
      }

      for (const target of collectTransitionTargets(cap)) {
        const targetKey = surfaceNodeKey(target);
        addEdge({ from: cKey, to: targetKey, kind: 'transitions' });
      }
    }

    for (const t of surface.transitions) {
      addEdge({
        from: sKey,
        to: surfaceNodeKey(String(t.target)),
        kind: 'transitions'
      });
    }
  }

  return { nodes, outgoing, incoming };
};

/**
 * BFS the feature graph from `rootKey` outward by `depth` hops. Returns
 * every reached node and every edge whose kind is in `edgeKinds` and whose
 * endpoints are both within the walk. Replaces N round-trips with one call
 * when the question is "what touches this entity?".
 *
 * `rootKey` formats: `action:<id>` | `surface:<id>` | `state:<dotted.path>` |
 *                    `event:<name>` | `feature:<id>`.
 *
 * Returns `null` when the root does not exist in the feature graph.
 */
export const getNeighborhoodTool = (
  feature: Feature,
  rootKey: string,
  depth: number,
  edgeKinds: readonly NeighborhoodEdgeKind[]
): Neighborhood | null => {
  const index = buildIndex(feature);
  const root = index.nodes.get(rootKey);
  if (!root) return null;

  const kindFilter = new Set(edgeKinds);
  const reached = new Map<string, number>();
  reached.set(rootKey, 0);
  const queue: string[] = [rootKey];
  const reachedEdges: NeighborhoodEdge[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = reached.get(current) ?? 0;
    if (currentDepth >= depth) continue;
    const neighbors = [
      ...(index.outgoing.get(current) ?? []),
      ...(index.incoming.get(current) ?? [])
    ];
    for (const edge of neighbors) {
      if (!kindFilter.has(edge.kind)) continue;
      const other = edge.from === current ? edge.to : edge.from;
      reachedEdges.push(edge);
      if (reached.has(other)) continue;
      reached.set(other, currentDepth + 1);
      queue.push(other);
    }
  }

  // Dedupe edges (BFS can encounter the same edge from both endpoints).
  const edgeKey = (e: NeighborhoodEdge) => `${e.from}->${e.to}:${e.kind}`;
  const seen = new Set<string>();
  const dedupedEdges = reachedEdges.filter((e) => {
    const k = edgeKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return reached.has(e.from) && reached.has(e.to);
  });

  const nodes: NeighborhoodNode[] = [];
  for (const key of reached.keys()) {
    const node = index.nodes.get(key);
    if (node) nodes.push(node);
  }

  const distances: Record<string, number> = {};
  for (const [k, v] of reached.entries()) distances[k] = v;

  return {
    root,
    depth,
    edgeKinds: [...kindFilter],
    nodes,
    edges: dedupedEdges,
    distances
  };
};
