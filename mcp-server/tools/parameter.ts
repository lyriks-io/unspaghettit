import { z } from 'zod';
import {
  addParameter,
  removeParameter,
  updateParameter
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Parameter } from '../../src/features/behavior-model/domain/entities/Parameter';
import type { ParameterType } from '../../src/features/behavior-model/domain/value-objects/ParameterType';
import {
  asActionId,
  asFeatureId,
  asParameterId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { coerceScalarByType, runMutation, type ToolDeps } from './_shared';

const parameterTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array',
  'date',
  'time',
  'timestamp',
  'url',
  'email',
  'geolocation'
] as const);

export const registerParameterTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_parameter',
    {
      description: 'Add Parameter (action input). bindToStatePath mirrors into state before rules evaluate. Validations: { type, value?, message? } where type is non_empty|email|url|uuid|ipv4|ipv6|hex|base64|slug|phone_e164|color_hex|semver|json|iso_date|iso_datetime|iso_time|min_length|max_length|length|pattern|starts_with|ends_with|contains|alphanumeric|alphabetic|lowercase|uppercase|no_whitespace|min|max|integer|positive|negative|non_negative|non_positive|multiple_of|finite|safe_integer.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        name: z.string().min(1),
        type: parameterTypeSchema,
        required: z.boolean(),
        description: z.string().min(1),
        enumValues: z.array(z.string()).optional(),
        defaultValue: z.unknown().optional(),
        bindToStatePath: z.string().optional(),
        validations: z.array(z.record(z.string(), z.unknown())).optional()
      }
    },
    async (input) => {
      const param: Parameter = {
        id: asParameterId(ids()),
        name: input.name,
        type: input.type as ParameterType,
        required: input.required,
        description: input.description,
        ...(input.enumValues ? { enumValues: input.enumValues } : {}),
        ...(input.defaultValue !== undefined
          ? {
              defaultValue: coerceScalarByType(
                input.defaultValue,
                input.type
              ) as Parameter['defaultValue']
            }
          : {}),
        ...(input.bindToStatePath
          ? { bindToStatePath: asStatePath(input.bindToStatePath) }
          : {}),
        ...(input.validations
          ? { validations: input.validations as unknown as Parameter['validations'] }
          : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(input.featureId),
          transform: (exp) =>
            addParameter(
              exp,
              asSurfaceId(input.surfaceId),
              asActionId(input.actionId),
              param
            )
        },
        { createdId: param.id }
      );
    }
  );

  server.registerTool(
    'update_parameter',
    {
      description: 'Patch Parameter fields. bindToStatePath null clears; setting it auto-syncs the linked StateDefinition type/enumValues.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        parameterId: z.string(),
        name: z.string().min(1).optional(),
        type: parameterTypeSchema.optional(),
        required: z.boolean().optional(),
        description: z.string().min(1).optional(),
        enumValues: z.array(z.string()).optional(),
        defaultValue: z.unknown().optional(),
        bindToStatePath: z.string().nullable().optional(),
        validations: z.array(z.record(z.string(), z.unknown())).optional()
      }
    },
    async (input) => {
      const patch: Partial<Parameter> = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type as ParameterType } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.enumValues !== undefined ? { enumValues: input.enumValues } : {}),
        ...(input.defaultValue !== undefined
          ? {
              defaultValue: coerceScalarByType(
                input.defaultValue,
                input.type
              ) as Parameter['defaultValue']
            }
          : {}),
        ...(input.bindToStatePath !== undefined
          ? {
              bindToStatePath:
                input.bindToStatePath === null ? undefined : asStatePath(input.bindToStatePath)
            }
          : {}),
        ...(input.validations !== undefined
          ? { validations: input.validations as unknown as Parameter['validations'] }
          : {})
      };
      return runMutation(deps, {
        featureId: asFeatureId(input.featureId),
        transform: (exp) =>
          updateParameter(
            exp,
            asSurfaceId(input.surfaceId),
            asActionId(input.actionId),
            asParameterId(input.parameterId),
            patch
          )
      });
    }
  );

  server.registerTool(
    'remove_parameter',
    {
      description: 'Delete Parameter. Rules reading it via bindToStatePath fall back to state default.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        parameterId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId, parameterId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeParameter(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asParameterId(parameterId)
          )
      })
  );
};
