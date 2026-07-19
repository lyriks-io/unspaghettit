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
import { asStateVariableId } from '../../src/features/projects/domain/value-objects/ids';
import type { SurfaceId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  coerceScalarByType,
  errorText,
  normalizeStateType,
  runMutation,
  STATE_TYPE_INPUT_VALUES,
  type ToolDeps
} from './_shared';

// Accepts the canonical six types plus the common synonyms (int, bool, str,
// ...); normalizeStateType folds an alias onto its canonical form before the
// value reaches the core model.
const stateTypeSchema = z.enum(STATE_TYPE_INPUT_VALUES);

export const registerStateDefinitionTools = (deps: ToolDeps): void => {
  const { server, ids, projectRepo, repo } = deps;

  server.registerTool(
    'add_state_definition',
    {
      description:
        'Declare schema for a state path on a Surface (path, type, default). type is one of string | number | boolean | enum | object | array; common synonyms (int/integer → number, bool → boolean, str/text → string) are accepted and folded to the canonical type, so a counter with type:"int", defaultValue:0 works. When type=enum, supply EITHER inline enumValues OR a valueSetId referencing a feature-level value set (add_value_set) — not both. sharedWith[] lists other surfaces that also read/write this path. Declarative only (the runtime snapshot is global), but it lets the dashboard render cross-surface state sharing honestly. Pass `derived` (an Expression, same AST as set_state.value) to make the path COMPUTED: the engine recomputes it after every mutation, so e.g. cart.subtotal stays correct without any action re-setting it. Derived paths are read-only — effects that write them are rejected. defaultValue is still required (used before the first compute / when the expression cannot evaluate). Example: derived:{ kind:"sum_pluck", operand:{kind:"state",path:"cart.lines"}, field:"amount" }.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        stateVariableId: z.string().optional(),
        path: z.string().optional(),
        type: stateTypeSchema.optional(),
        defaultValue: z.unknown().optional(),
        derived: z.unknown().optional(),
        enumValues: z.array(z.string()).optional(),
        valueSetId: z.string().optional(),
        description: z.string().min(1).optional(),
        sharedWith: z.array(z.string()).optional()
      }
    },
    async ({
      featureId,
      surfaceId,
      stateVariableId,
      path,
      type,
      defaultValue,
      derived,
      enumValues,
      valueSetId,
      description,
      sharedWith
    }) => {
      let canonical:
        | import('../../src/features/projects/domain/entities/StateVariable').StateVariable
        | undefined;
      if (stateVariableId) {
        const summaries = await projectRepo.list();
        for (const summary of summaries) {
          const project = await projectRepo.get(summary.id);
          if (!project?.featureIds.some((id) => String(id) === featureId)) continue;
          canonical = (project.stateVariables ?? []).find(
            (state) => String(state.id) === stateVariableId
          );
          if (canonical) break;
        }
        if (!canonical)
          return errorText(
            `State variable ${stateVariableId} does not resolve in the feature's project.`
          );
      }
      const resolvedPath = canonical ? String(canonical.path) : path;
      const resolvedType = (canonical?.type ?? normalizeStateType(type)) as StateType | undefined;
      const resolvedDefault = canonical?.defaultValue ?? defaultValue;
      const resolvedDescription = canonical?.description ?? description;
      if (!resolvedPath || !resolvedType || resolvedDefault === undefined || !resolvedDescription) {
        return errorText(
          'path, type, defaultValue, and description are required unless stateVariableId supplies them.'
        );
      }
      let resolvedValueSetId =
        canonical?.valueSetId ?? (valueSetId ? asValueSetId(valueSetId) : undefined);
      let resolvedEnumValues = canonical?.enumValues ?? enumValues;
      if (canonical?.valueSetId && String(canonical.owner.featureId) !== featureId) {
        const ownerFeature = await repo.get(canonical.owner.featureId);
        resolvedEnumValues = (ownerFeature?.valueSets ?? []).find(
          (set) => set.id === canonical!.valueSetId
        )?.values;
        resolvedValueSetId = undefined;
      }
      const def: StateDefinition = {
        id: asStateDefinitionId(ids()),
        ...(canonical ? { stateVariableId: asStateVariableId(stateVariableId!) } : {}),
        path: asStatePath(resolvedPath),
        type: resolvedType as StateType,
        defaultValue: coerceScalarByType(
          resolvedDefault,
          resolvedType
        ) as StateDefinition['defaultValue'],
        ...(derived !== undefined ? { derived: derived as StateDefinition['derived'] } : {}),
        ...(resolvedEnumValues ? { enumValues: resolvedEnumValues } : {}),
        ...(resolvedValueSetId ? { valueSetId: resolvedValueSetId } : {}),
        description: resolvedDescription,
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
      description:
        'Patch StateDefinition fields. Path renames are not auto-rewritten. Run find_state_references first. sharedWith:[] clears all sharing entries. valueSetId references a feature-level value set (mutually exclusive with enumValues); valueSetId:null clears it. `derived` (an Expression) makes the path computed/read-only; derived:null clears it back to an authored path.',
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
              ...(type !== undefined ? { type: normalizeStateType(type) as StateType } : {}),
              ...(derived !== undefined
                ? {
                    derived: derived === null ? undefined : (derived as StateDefinition['derived'])
                  }
                : {}),
              ...(defaultValue !== undefined
                ? {
                    defaultValue: coerceScalarByType(
                      defaultValue,
                      normalizeStateType(type) as string | undefined
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
      description:
        'Delete StateDefinition. References left dangling. Run find_state_references first.',
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
          removeStateDefinition(exp, asSurfaceId(surfaceId), asStateDefinitionId(stateDefinitionId))
      })
  );
};
