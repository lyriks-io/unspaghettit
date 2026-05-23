import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { DevContext } from '$features/behavior-model/domain/value-objects/DevContext';
import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
import type {
  ActionId,
  FeatureId,
  StateDefinitionId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

export type ActionIndexEntry = {
  readonly id: ActionId;
  readonly name: string;
};

export type StateDefinitionIndexEntry = {
  readonly id: StateDefinitionId;
  readonly path: string;
};

export type SurfaceIndexEntry = {
  readonly id: SurfaceId;
  readonly name: string;
  readonly type?: string;
  readonly stateCount: number;
  readonly ruleCount: number;
  readonly invariantCount: number;
  readonly transitionCount: number;
  readonly actions: readonly ActionIndexEntry[];
  // (id, path) pairs for every state def on this surface. Lets callers
  // address one for update_state_definition / remove_state_definition
  // without paying for the verbose get_feature payload just to look up an id.
  readonly stateDefinitions: readonly StateDefinitionIndexEntry[];
};

/**
 * Compact, drill-down-friendly view of an Feature. Returned as the default
 * `get_feature` payload so callers do not pull the full blob unless they
 * explicitly opt in (`verbose: true`). Drops rules/effects/parameters bodies
 * and keeps just the navigation shape (ids + names + counts).
 *
 * Roughly an order of magnitude smaller than the full Feature for
 * non-trivial models. The whole point of the MCP-vs-blob thesis.
 */
export type FeatureIndex = {
  readonly id: FeatureId;
  readonly name: string;
  readonly description?: string;
  readonly devContext?: DevContext;
  readonly surfaces: readonly SurfaceIndexEntry[];
  readonly personas: readonly { readonly id: string; readonly name: string }[];
  readonly resources: readonly { readonly id: string; readonly name: string }[];
  readonly entities: readonly { readonly id: string; readonly name: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const getFeatureIndexTool = (feature: Feature): FeatureIndex => ({
  id: feature.id,
  name: feature.name,
  description: feature.description,
  devContext: feature.devContext,
  surfaces: feature.surfaces.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    stateCount: s.stateDefinitions.length,
    ruleCount: s.rules.length,
    invariantCount: s.invariants.length,
    transitionCount: s.transitions.length,
    actions: s.actions.map((c) => ({ id: c.id, name: c.name })),
    stateDefinitions: s.stateDefinitions.map((d) => ({ id: d.id, path: String(d.path) }))
  })),
  personas: feature.personas.map((p) => ({ id: p.id, name: p.name })),
  resources: feature.resources.map((r) => ({ id: r.id, name: r.name })),
  entities: feature.entities.map((d) => ({ id: d.id, name: humanizeStatePath(d.namespace) })),
  createdAt: feature.createdAt,
  updatedAt: feature.updatedAt
});
