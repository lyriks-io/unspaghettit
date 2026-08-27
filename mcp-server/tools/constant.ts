import { z } from 'zod';
import {
  addConstant,
  removeConstant,
  updateConstant
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Constant } from '../../src/features/behavior-model/domain/entities/Constant';
import type { StateValue } from '../../src/features/behavior-model/domain/value-objects/StateValue';
import {
  asConstantId,
  asFeatureId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

// A constant holds any scalar or array StateValue. Objects are not accepted
// here (a threshold / cutoff / ratio is the point); the value passes through
// to the model unchanged.
const constantValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()]))
]);

export const registerConstantTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_constant',
    {
      description:
        'Add a named, feature-level constant referenced from any expression via {kind:"const", name} (a rule\'s condition.right, a set_state.value, a derived formula, an invariant threshold). Declare a threshold / cutoff / ratio ONCE here instead of copy-pasting the literal into every rule and invariant that compares against it, so the number can\'t drift across the spec. `name` is the reference key (unique within the feature; prefer short lowerCamelCase like "eraCutoffYear"). `value` is any scalar or array. Returns the new constant id.',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        value: constantValue
      }
    },
    async ({ featureId, name, description, value }) => {
      const constant: Constant = {
        id: asConstantId(ids()),
        name,
        description,
        value: value as StateValue
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addConstant(exp, constant)
        },
        { createdId: constant.id }
      );
    }
  );

  server.registerTool(
    'update_constant',
    {
      description:
        'Patch a constant. Editing the value here is the single source of truth: every expression that references it via {kind:"const", name} picks up the change with no further edits. Renaming `name` re-keys the reference, so any expression still using the old name becomes a dangling reference (the validator flags it) — rename the references in the same batch. Run run_all_scenarios afterwards to confirm nothing drifted.',
      inputSchema: {
        featureId: z.string(),
        constantId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        value: constantValue.optional()
      }
    },
    async ({ featureId, constantId, name, description, value }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = (exp.constants ?? []).find(
            (c) => c.id === asConstantId(constantId)
          );
          if (!existing) throw new EntityNotFoundInFeatureError('constant', constantId);
          const merged: Constant = {
            ...existing,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(value !== undefined ? { value: value as StateValue } : {})
          };
          return updateConstant(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_constant',
    {
      description:
        'Delete a constant. Any expression that still references it via {kind:"const", name} is then flagged as a dangling reference by the validator, so clear those references first (inline the literal or point them at another constant).',
      inputSchema: {
        featureId: z.string(),
        constantId: z.string()
      }
    },
    async ({ featureId, constantId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeConstant(exp, asConstantId(constantId))
      })
  );
};
