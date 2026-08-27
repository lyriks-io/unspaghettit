import { z } from 'zod';
import {
  addValueSet,
  removeValueSet,
  updateValueSet
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { ValueSet } from '../../src/features/behavior-model/domain/entities/ValueSet';
import {
  asFeatureId,
  asValueSetId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

export const registerValueSetTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_value_set',
    {
      description:
        'Add a named, reusable enum value set at the feature level. A StateDefinition or Parameter of type "enum" then references it via valueSetId instead of inlining enumValues, so the allowed values live in ONE place. Returns the new value set id to wire into add_state_definition / add_parameter (valueSetId).',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        values: z.array(z.string()).min(1)
      }
    },
    async ({ featureId, name, description, values }) => {
      const valueSet: ValueSet = {
        id: asValueSetId(ids()),
        name,
        description,
        values
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addValueSet(exp, valueSet)
        },
        { createdId: valueSet.id }
      );
    }
  );

  server.registerTool(
    'update_value_set',
    {
      description:
        'Patch a value set. `values` is a full replacement when provided. Editing the values here is the single source of truth: every StateDefinition / Parameter that references this set via valueSetId picks up the change with no further edits. Run run_all_scenarios afterwards to confirm defaults still resolve.',
      inputSchema: {
        featureId: z.string(),
        valueSetId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        values: z.array(z.string()).min(1).optional()
      }
    },
    async ({ featureId, valueSetId, name, description, values }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = (exp.valueSets ?? []).find(
            (vs) => vs.id === asValueSetId(valueSetId)
          );
          if (!existing) throw new EntityNotFoundInFeatureError('value set', valueSetId);
          const merged: ValueSet = {
            ...existing,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(values !== undefined ? { values } : {})
          };
          return updateValueSet(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_value_set',
    {
      description:
        'Delete a value set. Any StateDefinition / Parameter that still references it via valueSetId is then flagged as a dangling reference by the validator, so clear those references first (set their enumValues inline or point them at another set).',
      inputSchema: {
        featureId: z.string(),
        valueSetId: z.string()
      }
    },
    async ({ featureId, valueSetId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeValueSet(exp, asValueSetId(valueSetId))
      })
  );
};
