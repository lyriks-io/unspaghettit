import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  ActionId,
  EffectId,
  EventDefinitionId,
  EntityId,
  InvariantId,
  ParameterId,
  PersonaId,
  ResourceId,
  RuleId,
  ScenarioId,
  StateDefinitionId,
  SurfaceId,
  TransitionId
} from '$features/behavior-model/domain/value-objects/ids';

/**
 * Compact id catalog for one feature. Same role as `git ls-files`: the LLM
 * uses it as a flat lookup table to find ids by human-readable context
 * without paying for the full `get_feature(verbose:true)` blob.
 *
 * Used after one apply_batch has minted ids the LLM now needs to reference
 * in a later batch (existing refs only resolve within a single batch). Also
 * useful as a session-warmup: one call gives every id you might want to
 * use in subsequent mutations.
 */
export type FeatureIdCatalog = {
  readonly featureId: string;
  readonly featureName: string;
  readonly surfaces: readonly {
    readonly id: SurfaceId;
    readonly name: string;
    readonly type: string;
  }[];
  readonly actions: readonly {
    readonly id: ActionId;
    readonly name: string;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
  }[];
  readonly states: readonly {
    readonly id: StateDefinitionId;
    readonly path: string;
    readonly type: string;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
  }[];
  readonly rules: readonly {
    readonly id: RuleId;
    readonly category: string;
    readonly scope: 'action' | 'surface';
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly actionId?: ActionId;
    readonly actionName?: string;
  }[];
  readonly invariants: readonly {
    readonly id: InvariantId;
    readonly name: string;
    readonly scope: 'action' | 'surface';
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly actionId?: ActionId;
    readonly actionName?: string;
  }[];
  readonly effects: readonly {
    readonly id: EffectId;
    readonly type: string;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly actionId: ActionId;
    readonly actionName: string;
    readonly personaId?: PersonaId;
    readonly personaName?: string;
  }[];
  readonly transitions: readonly {
    readonly id: TransitionId;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly target: SurfaceId;
    readonly targetName: string;
    readonly label?: string;
  }[];
  readonly parameters: readonly {
    readonly id: ParameterId;
    readonly name: string;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly actionId: ActionId;
    readonly actionName: string;
  }[];
  readonly scenarios: readonly {
    readonly id: ScenarioId;
    readonly name: string;
    readonly surfaceId: SurfaceId;
    readonly surfaceName: string;
    readonly actionId: ActionId;
    readonly actionName: string;
  }[];
  readonly events: readonly { readonly id: EventDefinitionId; readonly name: string }[];
  readonly personas: readonly { readonly id: PersonaId; readonly name: string }[];
  readonly resources: readonly { readonly id: ResourceId; readonly name: string }[];
  readonly entities: readonly { readonly id: EntityId; readonly namespace: string }[];
};

export const listFeatureIdsTool = (feature: Feature): FeatureIdCatalog => {
  const surfaceNameById = new Map<string, string>();
  for (const s of feature.surfaces) surfaceNameById.set(String(s.id), s.name);

  const surfaces = feature.surfaces.map((s) => ({
    id: s.id,
    name: s.name,
    type: String(s.type)
  }));

  const actions: FeatureIdCatalog['actions'] = [];
  const states: FeatureIdCatalog['states'] = [];
  const rules: FeatureIdCatalog['rules'] = [];
  const invariants: FeatureIdCatalog['invariants'] = [];
  const effects: FeatureIdCatalog['effects'] = [];
  const transitions: FeatureIdCatalog['transitions'] = [];
  const parameters: FeatureIdCatalog['parameters'] = [];
  const scenarios: FeatureIdCatalog['scenarios'] = [];
  const personaNameById = new Map<string, string>();
  for (const p of feature.personas) personaNameById.set(String(p.id), p.name);

  for (const surface of feature.surfaces) {
    for (const sd of surface.stateDefinitions) {
      (states as unknown as FeatureIdCatalog['states'][number][]).push({
        id: sd.id,
        path: String(sd.path),
        type: String(sd.type),
        surfaceId: surface.id,
        surfaceName: surface.name
      });
    }
    for (const r of surface.rules) {
      (rules as unknown as FeatureIdCatalog['rules'][number][]).push({
        id: r.id,
        category: String(r.category),
        scope: 'surface',
        surfaceId: surface.id,
        surfaceName: surface.name
      });
    }
    for (const inv of surface.invariants) {
      (invariants as unknown as FeatureIdCatalog['invariants'][number][]).push({
        id: inv.id,
        name: inv.name,
        scope: 'surface',
        surfaceId: surface.id,
        surfaceName: surface.name
      });
    }
    for (const t of surface.transitions) {
      (transitions as unknown as FeatureIdCatalog['transitions'][number][]).push({
        id: t.id,
        surfaceId: surface.id,
        surfaceName: surface.name,
        target: t.target,
        targetName: surfaceNameById.get(String(t.target)) ?? String(t.target),
        ...(t.label ? { label: t.label } : {})
      });
    }
    for (const a of surface.actions) {
      (actions as unknown as FeatureIdCatalog['actions'][number][]).push({
        id: a.id,
        name: a.name,
        surfaceId: surface.id,
        surfaceName: surface.name
      });
      for (const r of a.rules) {
        (rules as unknown as FeatureIdCatalog['rules'][number][]).push({
          id: r.id,
          category: String(r.category),
          scope: 'action',
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: a.id,
          actionName: a.name
        });
      }
      for (const inv of a.invariants) {
        (invariants as unknown as FeatureIdCatalog['invariants'][number][]).push({
          id: inv.id,
          name: inv.name,
          scope: 'action',
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: a.id,
          actionName: a.name
        });
      }
      for (const e of a.effects) {
        (effects as unknown as FeatureIdCatalog['effects'][number][]).push({
          id: e.id,
          type: String(e.type),
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: a.id,
          actionName: a.name
        });
      }
      for (const p of a.parameters) {
        (parameters as unknown as FeatureIdCatalog['parameters'][number][]).push({
          id: p.id,
          name: p.name,
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: a.id,
          actionName: a.name
        });
      }
      for (const sc of a.scenarios ?? []) {
        (scenarios as unknown as FeatureIdCatalog['scenarios'][number][]).push({
          id: sc.id,
          name: sc.name,
          surfaceId: surface.id,
          surfaceName: surface.name,
          actionId: a.id,
          actionName: a.name,
          ...(sc.personaId
            ? {
                personaId: sc.personaId,
                personaName: personaNameById.get(String(sc.personaId)) ?? String(sc.personaId)
              }
            : {})
        });
      }
    }
  }

  return {
    featureId: String(feature.id),
    featureName: feature.name,
    surfaces,
    actions,
    states,
    rules,
    invariants,
    effects,
    transitions,
    parameters,
    scenarios,
    events: (feature.events ?? []).map((e) => ({ id: e.id, name: String(e.name) })),
    personas: feature.personas.map((p) => ({ id: p.id, name: p.name })),
    resources: feature.resources.map((r) => ({ id: r.id, name: r.name })),
    entities: feature.entities.map((d) => ({ id: d.id, namespace: d.namespace }))
  };
};
