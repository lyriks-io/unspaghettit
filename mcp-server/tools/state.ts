import { z } from 'zod';
import {
  addStateDefinition,
  removeStateDefinition,
  updateStateDefinition
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { StateDefinition } from '../../src/features/behavior-model/domain/entities/StateDefinition';
import type { StateType } from '../../src/features/behavior-model/domain/value-objects/StateValue';
import {
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId,
  asValueSetId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import type { SurfaceId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { coerceScalarByType, runMutation, type ToolDeps } from './_shared';

const stateTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array'
] as const);

export const registerStateDefinitionTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_state_definition',
    {
      description:
        'Declare schema for a state path on a Surface (path, type, default). When type=enum, supply EITHER inline enumValues OR a valueSetId referencing a feature-level value set (add_value_set) — not both. sharedWith[] lists other surfaces that also read/write this path. Declarative only (the runtime snapshot is global), but it lets the dashboard render cross-surface state sharing honestly. Pass `derived` (an Expression, same AST as set_state.value) to make the path COMPUTED: the engine recomputes it after every mutation, so e.g. cart.subtotal stays correct without any action re-setting it. Derived paths are read-only — effects that write them are rejected. defaultValue is still required (used before the first compute / when the expression cannot evaluate). Example: derived:{ kind:"sum_pluck", operand:{kind:"state",path:"cart.lines"}, field:"amount" }.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        path: z.string(),
        type: stateTypeSchema,
        defaultValue: z.unknown(),
        derived: z.unknown().optional(),
        enumValues: z.array(z.string()).optional(),
        valueSetId: z.string().optional(),
        description: z.string().min(1),
        sharedWith: z.array(z.string()).optional()
      }
    },
    async ({
      featureId,
      surfaceId,
      path,
      type,
      defaultValue,
      derived,
      enumValues,
      valueSetId,
      description,
      sharedWith
    }) => {
      const def: StateDefinition = {
        id: asStateDefinitionId(ids()),
        path: asStatePath(path),
        type: type as StateType,
        defaultValue: coerceScalarByType(defaultValue, type) as StateDefinition['defaultValue'],
        ...(derived !== undefined ? { derived: derived as StateDefinition['derived'] } : {}),
        ...(enumValues ? { enumValues } : {}),
        ...(valueSetId ? { valueSetId: asValueSetId(valueSetId) } : {}),
        description,
        ...(sharedWith && sharedWith.length > 0
          ? { sharedWith: sharedWith.map((s) => asSurfaceId(s)) as readonly SurfaceId[] }
          : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addStateDefinition(exp, asSurfaceId(surfaceId), def)
        },
        { createdId: def.id }
      );
    }
  );

  server.registerTool(
    'update_state_definition',
    {
      description: 'Patch StateDefinition fields. Path renames are not auto-rewritten. Run find_state_references first. sharedWith:[] clears all sharing entries. valueSetId references a feature-level value set (mutually exclusive with enumValues); valueSetId:null clears it. `derived` (an Expression) makes the path computed/read-only; derived:null clears it back to an authored path.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        stateDefinitionId: z.string(),
        path: z.string().optional(),
        type: stateTypeSchema.optional(),
        defaultValue: z.unknown().optional(),
        derived: z.unknown().optional(),
        enumValues: z.array(z.string()).optional(),
        valueSetId: z.string().nullable().optional(),
        description: z.string().min(1).optional(),
        sharedWith: z.array(z.string()).optional()
      }
    },
    async ({
      featureId,
      surfaceId,
      stateDefinitionId,
      path,
      type,
      defaultValue,
      derived,
      enumValues,
      valueSetId,
      description,
      sharedWith
    }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateStateDefinition(
            exp,
            asSurfaceId(surfaceId),
            asStateDefinitionId(stateDefinitionId),
            {
              ...(path !== undefined ? { path: asStatePath(path) } : {}),
              ...(type !== undefined ? { type: type as StateType } : {}),
              ...(derived !== undefined
                ? { derived: derived === null ? undefined : (derived as StateDefinition['derived']) }
                : {}),
              ...(defaultValue !== undefined
                ? {
                    defaultValue: coerceScalarByType(
                      defaultValue,
                      type
                    ) as StateDefinition['defaultValue']
                  }
                : {}),
              ...(enumValues !== undefined ? { enumValues } : {}),
              ...(valueSetId !== undefined
                ? { valueSetId: valueSetId === null ? undefined : asValueSetId(valueSetId) }
                : {}),
              ...(description !== undefined ? { description } : {}),
              ...(sharedWith !== undefined
                ? {
                    sharedWith:
                      sharedWith.length === 0
                        ? undefined
                        : (sharedWith.map((s) => asSurfaceId(s)) as readonly SurfaceId[])
                  }
                : {})
            }
          )
      })
  );

  server.registerTool(
    'remove_state_definition',
    {
      description: 'Delete StateDefinition. References left dangling. Run find_state_references first.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        stateDefinitionId: z.string()
      }
    },
    async ({ featureId, surfaceId, stateDefinitionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeStateDefinition(
            exp,
            asSurfaceId(surfaceId),
            asStateDefinitionId(stateDefinitionId)
          )
      })
  );
};
