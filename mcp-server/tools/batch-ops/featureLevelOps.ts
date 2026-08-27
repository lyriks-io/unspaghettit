import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Constant } from '../../../src/features/behavior-model/domain/entities/Constant';
import type { Dependency } from '../../../src/features/behavior-model/domain/entities/Dependency';
import type { Entity, EntityField } from '../../../src/features/behavior-model/domain/entities/Entity';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Persona } from '../../../src/features/behavior-model/domain/entities/Persona';
import type { Resource } from '../../../src/features/behavior-model/domain/entities/Resource';
import type { StateValue } from '../../../src/features/behavior-model/domain/value-objects/StateValue';
import type { Transition } from '../../../src/features/behavior-model/domain/entities/Transition';
import type { ValueSet } from '../../../src/features/behavior-model/domain/entities/ValueSet';
import {
  asActionId,
  asConstantId,
  asDependencyId,
  asDependencyOperationId,
  asEntityFieldId,
  asEntityId,
  asPersonaId,
  asResourceId,
  asSurfaceId,
  asTransitionId,
  asValueSetId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import {
  ALL_LIBRARY_KINDS,
  linkLibraryRef,
  unlinkLibraryRef,
  type LibraryKind
} from '../../../src/features/projects/domain/services/projectLibrary';
import {
  buildDataField,
  buildOverrides,
  flatFields,
  notFoundInOp,
  optional,
  requireSomeChange,
  resolve,
  withPatch,
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
    // Surface-scoped by default; pass actionRef|actionId to attach to that
    // action's own transitions[] instead.
    case 'add_transition': {
      const target = asSurfaceId(resolve(op, refs, 'targetRef', 'target'));
      const trans: Transition = {
        id: asTransitionId(mintId()),
        target,
        ...(typeof op.label === 'string' ? { label: op.label } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {})
      };
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      exp =
        'actionId' in op || 'actionRef' in op
          ? T.addTransitionToCapability(
              exp,
              sid,
              asActionId(resolve(op, refs, 'actionRef', 'actionId')),
              trans
            )
          : T.addTransitionToSurface(exp, sid, trans);
      remember(op.ref, trans.id);
      break;
    }
    case 'update_transition': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      const o = withPatch(op);
      const patch = {
        ...('target' in o || 'targetRef' in o
          ? { target: asSurfaceId(resolve(o, refs, 'targetRef', 'target')) }
          : {}),
        ...(typeof o.label === 'string' ? { label: o.label } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {})
      };
      requireSomeChange(op, patch, ['target', 'label', 'description']);
      exp =
        'actionId' in op || 'actionRef' in op
          ? T.updateTransitionOnCapability(
              exp,
              sid,
              asActionId(resolve(op, refs, 'actionRef', 'actionId')),
              asTransitionId(op.transitionId as string),
              patch
            )
          : T.updateTransitionOnSurface(exp, sid, asTransitionId(op.transitionId as string), patch);
      break;
    }
    case 'remove_transition': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      exp =
        'actionId' in op || 'actionRef' in op
          ? T.removeTransitionFromCapability(
              exp,
              sid,
              asActionId(resolve(op, refs, 'actionRef', 'actionId')),
              asTransitionId(op.transitionId as string)
            )
          : T.removeTransitionFromSurface(exp, sid, asTransitionId(op.transitionId as string));
      break;
    }

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
      if (!existing) throw notFoundInOp(op, 'persona', pid);
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(Array.isArray(o.stateOverrides)
          ? { stateOverrides: buildOverrides(o).state }
          : {}),
        ...(Array.isArray(o.parameterOverrides)
          ? { parameterOverrides: buildOverrides(o).param }
          : {}),
        ...(typeof o.persistAcrossSurfaces === 'boolean'
          ? { persistAcrossSurfaces: o.persistAcrossSurfaces }
          : {})
      };
      requireSomeChange(op, picked, [
        'name',
        'description',
        'stateOverrides',
        'parameterOverrides',
        'persistAcrossSurfaces'
      ]);
      exp = T.updatePersona(exp, { ...existing, ...picked });
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
      if (!existing) throw notFoundInOp(op, 'value set', vsid);
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(Array.isArray(o.values) ? { values: o.values as readonly string[] } : {})
      };
      requireSomeChange(op, picked, ['name', 'description', 'values']);
      exp = T.updateValueSet(exp, { ...existing, ...picked });
      break;
    }
    case 'remove_value_set':
      exp = T.removeValueSet(exp, asValueSetId(op.valueSetId as string));
      break;

    // ── Constants ───────────────────────────────────────────────────
    case 'add_constant': {
      const constant: Constant = {
        id: asConstantId(mintId()),
        name: op.name as string,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        value: op.value as StateValue
      } as Constant;
      exp = T.addConstant(exp, constant);
      remember(op.ref, constant.id);
      break;
    }
    case 'update_constant': {
      const cid = asConstantId(op.constantId as string);
      const existing = (exp.constants ?? []).find((c) => c.id === cid);
      if (!existing) throw notFoundInOp(op, 'constant', cid);
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(o.value !== undefined ? { value: o.value as StateValue } : {})
      };
      requireSomeChange(op, picked, ['name', 'description', 'value']);
      exp = T.updateConstant(exp, { ...existing, ...picked });
      break;
    }
    case 'remove_constant':
      exp = T.removeConstant(exp, asConstantId(op.constantId as string));
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
      if (!existing) throw notFoundInOp(op, 'resource', rid);
      // Same collision rules as add_resource: prefer nested `resource:{}`
      // (or `patch:{}`), and accept `resourceKind` as an alias on the flat
      // form.
      const nested = (op.resource ?? op.patch) as Record<string, unknown> | undefined;
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
            k !== 'patch' &&
            k !== 'ref'
        )
      ) as Partial<Resource>;
      requireSomeChange(
        op,
        { ...patch, ...(kindOverride ? { kind: kindOverride } : {}) },
        ['the resource fields to change (name, provider, scope, resourceKind, ...)']
      );
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

    // ── Dependency ─────────────────────────────────────────────────────
    case 'add_dependency': {
      // `dependencyKind` (not `kind`, the op discriminator) carries the kind.
      const rawOperations = Array.isArray(op.operations) ? op.operations : [];
      const operations = rawOperations.map((raw) => {
        const o = raw as Record<string, unknown>;
        return {
          id: asDependencyOperationId(mintId()),
          name: o.name as string,
          ...(typeof o.description === 'string' ? { description: o.description } : {}),
          ...(Array.isArray(o.failureModes) ? { failureModes: o.failureModes as string[] } : {}),
          ...(typeof o.timeout === 'string' ? { timeout: o.timeout } : {}),
          ...(typeof o.retries === 'number' ? { retries: o.retries } : {}),
          ...(typeof o.idempotent === 'boolean' ? { idempotent: o.idempotent } : {})
        };
      }) as Dependency['operations'];
      const dependency: Dependency = {
        id: asDependencyId(mintId()),
        name: op.name as string,
        kind: (op.dependencyKind as Dependency['kind']) ?? 'service',
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(typeof op.provider === 'string' ? { provider: op.provider } : {}),
        operations,
        ...(Array.isArray(op.assumptions) ? { assumptions: op.assumptions as string[] } : {})
      };
      exp = T.addDependency(exp, dependency);
      remember(op.ref, dependency.id);
      break;
    }
    case 'update_dependency': {
      const did = asDependencyId(op.dependencyId as string);
      const existing = (exp.dependencies ?? []).find((d) => d.id === did);
      if (!existing) throw notFoundInOp(op, 'dependency', did);
      const o = withPatch(op);
      // `dependencyKind` carries the kind on both forms (`kind` is the op
      // discriminator), mirroring add_dependency. `operations` replaces the
      // whole list, with fresh ids minted like add_dependency does.
      const rawOperations = Array.isArray(o.operations) ? o.operations : undefined;
      const operations = rawOperations?.map((raw) => {
        const x = raw as Record<string, unknown>;
        return {
          id: asDependencyOperationId(mintId()),
          name: x.name as string,
          ...(typeof x.description === 'string' ? { description: x.description } : {}),
          ...(Array.isArray(x.failureModes) ? { failureModes: x.failureModes as string[] } : {}),
          ...(typeof x.timeout === 'string' ? { timeout: x.timeout } : {}),
          ...(typeof x.retries === 'number' ? { retries: x.retries } : {}),
          ...(typeof x.idempotent === 'boolean' ? { idempotent: x.idempotent } : {})
        };
      }) as Dependency['operations'] | undefined;
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.dependencyKind === 'string'
          ? { kind: o.dependencyKind as Dependency['kind'] }
          : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(typeof o.provider === 'string' ? { provider: o.provider } : {}),
        ...(operations ? { operations } : {}),
        ...(Array.isArray(o.assumptions) ? { assumptions: o.assumptions as string[] } : {})
      };
      requireSomeChange(op, picked, [
        'name',
        'dependencyKind',
        'description',
        'provider',
        'operations',
        'assumptions'
      ]);
      exp = T.updateDependency(exp, { ...existing, ...picked });
      break;
    }
    case 'remove_dependency':
      exp = T.removeDependency(exp, asDependencyId(op.dependencyId as string));
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
      if (!existing) throw notFoundInOp(op, 'entity', did);
      const o = withPatch(op);
      const fields = o.fields as readonly Record<string, unknown>[] | undefined;
      const resolvedResource = optional(o, 'resourceRef', 'resourceId', refs);
      const picked = {
        ...(typeof o.namespace === 'string' ? { namespace: o.namespace } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(fields ? { fields: fields.map((f) => buildDataField(mintId, f)) } : {}),
        ...('resourceId' in o || 'resourceRef' in o
          ? resolvedResource
            ? { resourceId: asResourceId(resolvedResource) }
            : { resourceId: undefined }
          : {})
      };
      requireSomeChange(op, picked, ['namespace', 'description', 'fields', 'resourceId']);
      exp = T.updateEntity(exp, { ...existing, ...picked });
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
    case 'update_entity_field': {
      const patch =
        (op.patch as Partial<EntityField> | undefined) ??
        (flatFields(op, ['kind', 'ref', 'dataRef', 'entityId', 'fieldId']) as
          Partial<EntityField>);
      requireSomeChange(op, patch as Record<string, unknown>, [
        'the field properties to change (name, type, description, required, enumValues, ...)'
      ]);
      exp = T.updateEntityField(
        exp,
        asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
        asEntityFieldId(op.fieldId as string),
        patch
      );
      break;
    }
    case 'remove_entity_field':
      exp = T.removeEntityField(
        exp,
        asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
        asEntityFieldId(op.fieldId as string)
      );
      break;

    // Project-library references. Pure Feature → Feature, so they belong in the
    // batch vocabulary even though the LIBRARY itself lives on the project: the
    // ops only move ids on and off the feature's ref lists. The repository
    // decorator resolves them on the next read, and validation reports a ref
    // the owning project can't satisfy.
    case 'link_project_definition':
    case 'unlink_project_definition': {
      // The library kind cannot ride on `kind` (that key is the op
      // discriminator); it rides as `definitionKind`. The old code passed
      // op.kind itself into the LibraryKind switch, which matched nothing and
      // silently replaced the feature with `undefined`.
      const defKind = (op.definitionKind ?? op.libraryKind) as string | undefined;
      if (!defKind || !(ALL_LIBRARY_KINDS as readonly string[]).includes(defKind)) {
        throw new Error(
          `${op.kind}: definitionKind must be one of ${ALL_LIBRARY_KINDS.join(', ')} (got ${JSON.stringify(defKind)}). The op discriminator "kind" cannot carry it.`
        );
      }
      exp = (op.kind === 'link_project_definition' ? linkLibraryRef : unlinkLibraryRef)(
        exp,
        defKind as LibraryKind,
        op.id as string
      );
      break;
    }

    default:
      return null;
  }
  return exp;
};
