import type { Constant } from '../../entities/Constant';
import type { Entity, EntityField } from '../../entities/Entity';
import type { EventDefinition } from '../../entities/EventDefinition';
import type { Feature } from '../../entities/Feature';
import type { Persona } from '../../entities/Persona';
import type { ReachabilityGoal } from '../../entities/ReachabilityGoal';
import type { Resource } from '../../entities/Resource';
import type { ValueSet } from '../../entities/ValueSet';
import type {
  ConstantId,
  EntityFieldId,
  EntityId,
  EventDefinitionId,
  PersonaId,
  ReachabilityGoalId,
  ResourceId,
  ValueSetId
} from '../../value-objects/ids';
import { mustMap } from './internal';

// ─── Reachability / liveness goals ─────────────────────────────────────────────
// Feature-level liveness properties, the complement to featureInvariants. Same
// add/update/remove shape against `feature.reachabilityGoals`.

export const addReachabilityGoal = (feature: Feature, goal: ReachabilityGoal): Feature => ({
  ...feature,
  reachabilityGoals: [...(feature.reachabilityGoals ?? []), goal]
});

export const updateReachabilityGoal = (
  feature: Feature,
  goalId: ReachabilityGoalId,
  patch: Partial<ReachabilityGoal>
): Feature => ({
  ...feature,
  reachabilityGoals: mustMap(
    feature.reachabilityGoals ?? [],
    String(goalId),
    'reachabilityGoal',
    (g) => ({ ...g, ...patch })
  )
});

export const removeReachabilityGoal = (
  feature: Feature,
  goalId: ReachabilityGoalId
): Feature => ({
  ...feature,
  reachabilityGoals: (feature.reachabilityGoals ?? []).filter((g) => g.id !== goalId)
});

// ─── Personas ────────────────────────────────────────────────────────────────

export const addPersona = (feature: Feature, persona: Persona): Feature => ({
  ...feature,
  personas: [...feature.personas, persona]
});

export const updatePersona = (feature: Feature, persona: Persona): Feature => ({
  ...feature,
  personas: mustMap(feature.personas, String(persona.id), 'persona', () => persona)
});

export const removePersona = (feature: Feature, personaId: PersonaId): Feature => ({
  ...feature,
  personas: feature.personas.filter((p) => p.id !== personaId)
});

// ─── Value sets ────────────────────────────────────────────────────────────

export const addValueSet = (feature: Feature, valueSet: ValueSet): Feature => ({
  ...feature,
  valueSets: [...(feature.valueSets ?? []), valueSet]
});

export const updateValueSet = (feature: Feature, valueSet: ValueSet): Feature => ({
  ...feature,
  valueSets: mustMap(feature.valueSets ?? [], String(valueSet.id), 'value set', () => valueSet)
});

export const removeValueSet = (feature: Feature, valueSetId: ValueSetId): Feature => ({
  ...feature,
  valueSets: (feature.valueSets ?? []).filter((vs) => vs.id !== valueSetId)
});

// ─── Constants ───────────────────────────────────────────────────────────────
// Named, reusable scalar/array values referenced from expressions via
// `{kind:'const', name}`. Same add/update/remove shape against
// `feature.constants` as the other optional feature-level collections.

export const addConstant = (feature: Feature, constant: Constant): Feature => ({
  ...feature,
  constants: [...(feature.constants ?? []), constant]
});

export const updateConstant = (feature: Feature, constant: Constant): Feature => ({
  ...feature,
  constants: mustMap(feature.constants ?? [], String(constant.id), 'constant', () => constant)
});

export const removeConstant = (feature: Feature, constantId: ConstantId): Feature => ({
  ...feature,
  constants: (feature.constants ?? []).filter((c) => c.id !== constantId)
});

// ─── Resources ───────────────────────────────────────────────────────────────

export const addResource = (feature: Feature, resource: Resource): Feature => ({
  ...feature,
  resources: [...feature.resources, resource]
});

export const updateResource = (feature: Feature, resource: Resource): Feature => ({
  ...feature,
  resources: mustMap(feature.resources, String(resource.id), 'resource', () => resource)
});

export const removeResource = (feature: Feature, resourceId: ResourceId): Feature => ({
  ...feature,
  resources: feature.resources.filter((r) => r.id !== resourceId)
});

// ─── Entity ────────────────────────────────────────────────────────────────────

export const addEntity = (feature: Feature, data: Entity): Feature => ({
  ...feature,
  entities: [...feature.entities, data]
});

export const updateEntity = (feature: Feature, data: Entity): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(data.id), 'entity', () => data)
});

export const removeEntity = (feature: Feature, entityId: EntityId): Feature => ({
  ...feature,
  entities: feature.entities.filter((d) => d.id !== entityId)
});

export const addEntityField = (
  feature: Feature,
  entityId: EntityId,
  field: EntityField
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: [...d.fields, field]
  }))
});

export const removeEntityField = (
  feature: Feature,
  entityId: EntityId,
  fieldId: EntityFieldId
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: d.fields.filter((f) => f.id !== fieldId)
  }))
});

export const updateEntityField = (
  feature: Feature,
  entityId: EntityId,
  fieldId: EntityFieldId,
  patch: Partial<EntityField>
): Feature => ({
  ...feature,
  entities: mustMap(feature.entities, String(entityId), 'entity', (d) => ({
    ...d,
    fields: mustMap(d.fields, String(fieldId), 'entityField', (f) => ({ ...f, ...patch }))
  }))
});

// ─── Events ──────────────────────────────────────────────────────────────────

export const addEvent = (feature: Feature, event: EventDefinition): Feature => ({
  ...feature,
  events: [...(feature.events ?? []), event]
});

export const updateEvent = (feature: Feature, event: EventDefinition): Feature => ({
  ...feature,
  events: mustMap(feature.events ?? [], String(event.id), 'event', () => event)
});

export const removeEvent = (
  feature: Feature,
  eventId: EventDefinitionId
): Feature => ({
  ...feature,
  events: (feature.events ?? []).filter((e) => e.id !== eventId)
});
