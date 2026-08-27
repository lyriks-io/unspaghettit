import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Parameter } from '../../../src/features/behavior-model/domain/entities/Parameter';
import type { StateDefinition } from '../../../src/features/behavior-model/domain/entities/StateDefinition';
import {
  asActionId,
  asParameterId,
  asResourceId,
  asStateDefinitionId,
  asSurfaceId,
  asValueSetId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../../src/features/behavior-model/domain/value-objects/StatePath';
import { asStateVariableId } from '../../../src/features/projects/domain/value-objects/ids';
import { normalizeStateType } from '../_shared';
import {
  directionDelta,
  requireSomeChange,
  resolve,
  resolveSharedWith,
  withPatch,
  type Op,
  type OpContext
} from './opHelpers';

/**
 * State definition and Parameter op families. Returns the next Feature when
 * it handled op.kind and null when the op belongs to another family.
 */
export const applyStateParamOps = (op: Op, ctx: OpContext): Feature | null => {
  const { refs, mintId, remember } = ctx;
  let exp = ctx.feature;
  switch (op.kind) {
    // ── State definition ────────────────────────────────────────────
    case 'add_state_definition': {
      const sharedWith = resolveSharedWith(op, refs);
      const def: StateDefinition = {
        id: asStateDefinitionId(mintId()),
        ...(typeof op.stateVariableId === 'string'
          ? { stateVariableId: asStateVariableId(op.stateVariableId) }
          : {}),
        path: asStatePath(op.path as string),
        // Normalize a type synonym (int → number, ...) but do NOT coerce the
        // default: the batch path preserves JSON types end-to-end, so a
        // string default here is a genuine mistake the validator should flag
        // ("Use 0 instead of \"0\"") rather than silently coerce.
        type: normalizeStateType(op.type) as StateDefinition['type'],
        defaultValue: op.defaultValue as StateDefinition['defaultValue'],
        ...(Array.isArray(op.enumValues) ? { enumValues: op.enumValues as readonly string[] } : {}),
        ...(typeof op.valueSetId === 'string' ? { valueSetId: asValueSetId(op.valueSetId) } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(sharedWith ? { sharedWith } : {})
      };
      exp = T.addStateDefinition(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        def
      );
      remember(op.ref, def.id);
      break;
    }
    case 'update_state_definition': {
      const o = withPatch(op);
      const picked = {
        ...(typeof o.path === 'string' ? { path: asStatePath(o.path) } : {}),
        ...(typeof o.type === 'string'
          ? { type: normalizeStateType(o.type) as StateDefinition['type'] }
          : {}),
        ...(o.defaultValue !== undefined
          ? { defaultValue: o.defaultValue as StateDefinition['defaultValue'] }
          : {}),
        ...(Array.isArray(o.enumValues)
          ? { enumValues: o.enumValues as readonly string[] }
          : {}),
        ...('valueSetId' in o
          ? {
              valueSetId:
                o.valueSetId == null ? undefined : asValueSetId(o.valueSetId as string)
            }
          : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(Array.isArray(o.sharedWith)
          ? {
              sharedWith: o.sharedWith.length === 0 ? undefined : resolveSharedWith(o, refs)
            }
          : {})
      };
      requireSomeChange(op, picked, [
        'path',
        'type',
        'defaultValue',
        'enumValues',
        'valueSetId',
        'description',
        'sharedWith'
      ]);
      exp = T.updateStateDefinition(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asStateDefinitionId(op.stateDefinitionId as string),
        picked
      );
      break;
    }
    case 'remove_state_definition':
      exp = T.removeStateDefinition(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asStateDefinitionId(op.stateDefinitionId as string)
      );
      break;
    case 'move_state_definition':
      exp = T.moveStateDefinitionBy(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asStateDefinitionId(op.stateDefinitionId as string),
        directionDelta(op)
      );
      break;

    // ── Parameter ───────────────────────────────────────────────────
    case 'add_parameter': {
      const param: Parameter = {
        id: asParameterId(mintId()),
        name: op.name as string,
        type: normalizeStateType(op.type) as Parameter['type'],
        required: op.required as boolean,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(Array.isArray(op.enumValues) ? { enumValues: op.enumValues as readonly string[] } : {}),
        ...(typeof op.valueSetId === 'string' ? { valueSetId: asValueSetId(op.valueSetId) } : {}),
        ...(op.defaultValue !== undefined
          ? { defaultValue: op.defaultValue as Parameter['defaultValue'] }
          : {}),
        ...(typeof op.bindToStatePath === 'string'
          ? { bindToStatePath: asStatePath(op.bindToStatePath) }
          : {}),
        ...(Array.isArray(op.validations)
          ? { validations: op.validations as unknown as Parameter['validations'] }
          : {}),
        ...(typeof op.resourceId === 'string' ? { resourceId: asResourceId(op.resourceId) } : {})
      };
      exp = T.addParameter(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        param
      );
      remember(op.ref, param.id);
      break;
    }
    case 'update_parameter': {
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.type === 'string'
          ? { type: normalizeStateType(o.type) as Parameter['type'] }
          : {}),
        ...(typeof o.required === 'boolean' ? { required: o.required } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(Array.isArray(o.enumValues)
          ? { enumValues: o.enumValues as readonly string[] }
          : {}),
        ...('valueSetId' in o
          ? {
              valueSetId:
                o.valueSetId == null ? undefined : asValueSetId(o.valueSetId as string)
            }
          : {}),
        ...(o.defaultValue !== undefined
          ? { defaultValue: o.defaultValue as Parameter['defaultValue'] }
          : {}),
        ...('bindToStatePath' in o
          ? {
              bindToStatePath:
                o.bindToStatePath === null || o.bindToStatePath === undefined
                  ? undefined
                  : asStatePath(o.bindToStatePath as string)
            }
          : {}),
        ...(Array.isArray(o.validations)
          ? { validations: o.validations as unknown as Parameter['validations'] }
          : {}),
        ...('resourceId' in o
          ? {
              resourceId:
                o.resourceId == null ? undefined : asResourceId(o.resourceId as string)
            }
          : {})
      };
      requireSomeChange(op, picked, [
        'name',
        'type',
        'required',
        'description',
        'enumValues',
        'valueSetId',
        'defaultValue',
        'bindToStatePath',
        'validations',
        'resourceId'
      ]);
      exp = T.updateParameter(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asParameterId(op.parameterId as string),
        picked
      );
      break;
    }
    case 'remove_parameter':
      exp = T.removeParameter(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asParameterId(op.parameterId as string)
      );
      break;
    case 'move_parameter':
      exp = T.moveParameterBy(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asParameterId(op.parameterId as string),
        directionDelta(op)
      );
      break;

    default:
      return null;
  }
  return exp;
};
