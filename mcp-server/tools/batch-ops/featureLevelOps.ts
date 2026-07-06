import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Entity, EntityField } from '../../../src/features/behavior-model/domain/entities/Entity';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Persona } from '../../../src/features/behavior-model/domain/entities/Persona';
import type { Resource } from '../../../src/features/behavior-model/domain/entities/Resource';
import type { Transition } from '../../../src/features/behavior-model/domain/entities/Transition';
import type { ValueSet } from '../../../src/features/behavior-model/domain/entities/ValueSet';
import {
  asEntityFieldId,
  asEntityId,
  asPersonaId,
  asResourceId,
  asSurfaceId,
  asTransitionId,
  asValueSetId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import {
  buildDataField,
  buildOverrides,
  optional,
  resolve,
  type Op,
  type OpContext
} from './opHelpers';

/**
 * Transition, Persona, Value set, Resource, and Entity op families. Returns
 * the next Feature when it handled op.kind and null when the op belongs to
 * another family.
 */
export const applyFeatureLevelOps = (op: Op, ctx: OpContext): Feature | null => {
  const { refs, mintId, remember } = ctx;
  let exp = ctx.feature;
  switch (op.kind) {
    // ── Transitions ─────────────────────────────────────────────────
    case 'add_transition': {
      const target = asSurfaceId(resolve(op, refs, 'targetRef', 'target'));
      const trans: Transition = {
        id: asTransitionId(mintId()),
        target,
        ...(typeof op.label === 'string' ? { label: op.label } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {})
      };
      exp = T.addTransitionToSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        trans
      );
      remember(op.ref, trans.id);
      break;
    }
    case 'update_transition':
      exp = T.updateTransitionOnSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asTransitionId(op.transitionId as string),
        {
          ...('target' in op || 'targetRef' in op
            ? { target: asSurfaceId(resolve(op, refs, 'targetRef', 'target')) }
            : {}),
          ...(typeof op.label === 'string' ? { label: op.label } : {}),
          ...(typeof op.description === 'string' ? { description: op.description } : {})
        }
      );
      break;
    case 'remove_transition':
      exp = T.removeTransitionFromSurface(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asTransitionId(op.transitionId as string)
      );
      break;

    // ── Personas ────────────────────────────────────────────────────
    case 'add_persona': {
      const ovs = buildOverrides(op);
      const persona: Persona = {
        id: asPersonaId(mintId()),
        name: op.name as string,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        stateOverrides: ovs.state,
        parameterOverrides: ovs.param,
        ...(typeof op.persistAcrossSurfaces === 'boolean'
          ? { persistAcrossSurfaces: op.persistAcrossSurfaces }
          : {})
      };
      exp = T.addPersona(exp, persona);
      remember(op.ref, persona.id);
      break;
    }
    case 'update_persona': {
      const pid = asPersonaId(op.personaId as string);
      const existing = exp.personas.find((p) => p.id === pid);
      if (!existing) break;
      const merged: Persona = {
        ...existing,
        ...(typeof op.name === 'string' ? { name: op.name } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(Array.isArray(op.stateOverrides)
          ? { stateOverrides: buildOverrides(op).state }
          : {}),
        ...(Array.isArray(op.parameterOverrides)
          ? { parameterOverrides: buildOverrides(op).param }
          : {}),
        ...(typeof op.persistAcrossSurfaces === 'boolean'
          ? { persistAcrossSurfaces: op.persistAcrossSurfaces }
          : {})
      };
      exp = T.updatePersona(exp, merged);
      break;
    }
    case 'remove_persona':
      exp = T.removePersona(exp, asPersonaId(op.personaId as string));
      break;

    // ── Value sets ──────────────────────────────────────────────────
    case 'add_value_set': {
      const valueSet: ValueSet = {
        id: asValueSetId(mintId()),
        name: op.name as string,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        values: Array.isArray(op.values) ? (op.values as readonly string[]) : []
      };
      exp = T.addValueSet(exp, valueSet);
      remember(op.ref, valueSet.id);
      break;
    }
    case 'update_value_set': {
      const vsid = asValueSetId(op.valueSetId as string);
      const existing = (exp.valueSets ?? []).find((vs) => vs.id === vsid);
      if (!existing) break;
      const merged: ValueSet = {
        ...existing,
        ...(typeof op.name === 'string' ? { name: op.name } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(Array.isArray(op.values) ? { values: op.values as readonly string[] } : {})
      };
      exp = T.updateValueSet(exp, merged);
      break;
    }
    case 'remove_value_set':
      exp = T.removeValueSet(exp, asValueSetId(op.valueSetId as string));
      break;

    // ── Resources ───────────────────────────────────────────────────
    case 'add_resource': {
      // The op's discriminator field `kind = "add_resource"` collides with
      // the resource entity's own `kind` field (e.g. "browser_storage").
      // Two ways to disambiguate:
      //   1. Nest under `resource: {...}`. Preferred, matches add_rule's
      //      `rule: {...}` and add_invariant's `invariant: {...}`.
      //   2. Flat form with `resourceKind` as alias for the resource's kind.
      const r =
        (op.resource as Record<string, unknown> | undefined) ??
        (op as unknown as Record<string, unknown>);
      const resourceKind = (r.resourceKind ??
        (r === (op as unknown as Record<string, unknown>) ? undefined : r.kind)) as
        | Resource['kind']
        | undefined;
      if (!resourceKind) {
        throw new Error(
          'add_resource: resource kind is required. Pass it as `resource:{kind,...}` or `resourceKind`.'
        );
      }
      const resource: Resource = {
        id: asResourceId(mintId()),
        name: r.name as string,
        ...(typeof r.description === 'string' ? { description: r.description } : {}),
        kind: resourceKind,
        provider: r.provider as string,
        scope: r.scope as Resource['scope'],
        ...(typeof r.location === 'string' ? { location: r.location } : {}),
        ...(typeof r.database === 'string' ? { database: r.database } : {}),
        ...(typeof r.container === 'string' ? { container: r.container } : {}),
        ...(typeof r.field === 'string' ? { field: r.field } : {}),
        sensitivity: r.sensitivity as Resource['sensitivity'],
        containsPii: r.containsPii as boolean,
        complianceTags: (r.complianceTags as readonly string[] | undefined) ?? [],
        accessMode: r.accessMode as Resource['accessMode'],
        ...(typeof r.authentication === 'string'
          ? { authentication: r.authentication as Resource['authentication'] }
          : {}),
        ...(typeof r.encryptionAtRest === 'boolean'
          ? { encryptionAtRest: r.encryptionAtRest }
          : {}),
        ...(typeof r.encryptionInTransit === 'boolean'
          ? { encryptionInTransit: r.encryptionInTransit }
          : {}),
        ...(typeof r.retention === 'string' ? { retention: r.retention } : {}),
        ...(typeof r.owner === 'string' ? { owner: r.owner } : {})
      };
      exp = T.addResource(exp, resource);
      remember(op.ref, resource.id);
      break;
    }
    case 'update_resource': {
      const rid = asResourceId(op.resourceId as string);
      const existing = exp.resources.find((r) => r.id === rid);
      if (!existing) break;
      // Same collision rules as add_resource: prefer nested `resource:{}`,
      // and accept `resourceKind` as an alias on the flat form.
      const nested = op.resource as Record<string, unknown> | undefined;
      const src = nested ?? (op as unknown as Record<string, unknown>);
      const kindOverride = nested
        ? (src.kind as Resource['kind'] | undefined)
        : (src.resourceKind as Resource['kind'] | undefined);
      const patch = Object.fromEntries(
        Object.entries(src).filter(
          ([k, v]) =>
            v !== undefined &&
            k !== 'kind' &&
            k !== 'resourceKind' &&
            k !== 'resourceId' &&
            k !== 'resource' &&
            k !== 'ref'
        )
      ) as Partial<Resource>;
      const merged: Resource = {
        ...existing,
        ...patch,
        ...(kindOverride ? { kind: kindOverride } : {})
      };
      exp = T.updateResource(exp, merged);
      break;
    }
    case 'remove_resource':
      exp = T.removeResource(exp, asResourceId(op.resourceId as string));
      break;

    // ── Entity ────────────────────────────────────────────────────────
    case 'add_entity': {
      const fields = (op.fields as readonly Record<string, unknown>[] | undefined) ?? [];
      const resolvedResource = optional(op, 'resourceRef', 'resourceId', refs);
      const data: Entity = {
        id: asEntityId(mintId()),
        namespace: op.namespace as string,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        fields: fields.map((f) => buildDataField(mintId, f)),
        ...(resolvedResource ? { resourceId: asResourceId(resolvedResource) } : {})
      };
      exp = T.addEntity(exp, data);
      remember(op.ref, data.id);
      break;
    }
    case 'update_entity': {
      const did = asEntityId(op.entityId as string);
      const existing = exp.entities.find((d) => d.id === did);
      if (!existing) break;
      const fields = op.fields as readonly Record<string, unknown>[] | undefined;
      const resolvedResource = optional(op, 'resourceRef', 'resourceId', refs);
      const merged: Entity = {
        ...existing,
        ...(typeof op.namespace === 'string' ? { namespace: op.namespace } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(fields ? { fields: fields.map((f) => buildDataField(mintId, f)) } : {}),
        ...('resourceId' in op || 'resourceRef' in op
          ? resolvedResource
            ? { resourceId: asResourceId(resolvedResource) }
            : { resourceId: undefined }
          : {})
      };
      exp = T.updateEntity(exp, merged);
      break;
    }
    case 'remove_entity':
      exp = T.removeEntity(exp, asEntityId(op.entityId as string));
      break;
    case 'add_entity_field': {
      const did = asEntityId(resolve(op, refs, 'dataRef', 'entityId'));
      const field = buildDataField(mintId, op as Record<string, unknown>);
      exp = T.addEntityField(exp, did, field);
      remember(op.ref, field.id);
      break;
    }
    case 'update_entity_field':
      exp = T.updateEntityField(
        exp,
        asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
        asEntityFieldId(op.fieldId as string),
        (op.patch as Partial<EntityField>) ?? {}
      );
      break;
    case 'remove_entity_field':
      exp = T.removeEntityField(
        exp,
        asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
        asEntityFieldId(op.fieldId as string)
      );
      break;

    default:
      return null;
  }
  return exp;
};
