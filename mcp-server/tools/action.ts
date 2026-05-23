import { z } from 'zod';
import {
  addAction,
  removeAction,
  updateAction
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type {
  Action,
  ActionRole
} from '../../src/features/behavior-model/domain/entities/Action';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

const actionRoleSchema = z.enum([
  'entry',
  'primary',
  'validation',
  'feedback',
  'destructive',
  'async',
  'persistence'
] as const);

export const registerActionTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_action',
    {
      description:
        'Append an Action under a Surface. emittedEvents can be declared up-front; flesh out parameters/rules/effects via add_parameter/add_action_rule/add_effect. Optional `roles[]` tags the action for spec-gap diagnostics (e.g. destructive, async, validation).',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        name: z.string().min(1),
        intent: z.string().min(1),
        requiredStates: z.array(z.string()).optional(),
        emittedEvents: z.array(z.string()).optional(),
        roles: z.array(actionRoleSchema).optional(),
        bypassInvariants: z.boolean().optional(),
        triggeredByEvent: z.string().min(1).optional()
      }
    },
    async ({ featureId, surfaceId, name, intent, requiredStates, emittedEvents, roles, bypassInvariants, triggeredByEvent }) => {
      const action: Action = {
        id: asActionId(ids()),
        name,
        intent,
        parameters: [],
        requiredStates: (requiredStates ?? []) as unknown as Action['requiredStates'],
        rules: [],
        invariants: [],
        effects: [],
        emittedEvents: (emittedEvents ?? []) as unknown as Action['emittedEvents'],
        transitions: [],
        ...(roles && roles.length > 0 ? { roles: roles as readonly ActionRole[] } : {}),
        ...(bypassInvariants === true ? { bypassInvariants: true } : {}),
        ...(triggeredByEvent ? { triggeredByEvent: triggeredByEvent as Action['triggeredByEvent'] } : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addAction(exp, asSurfaceId(surfaceId), action)
        },
        { createdId: action.id }
      );
    }
  );

  server.registerTool(
    'update_action',
    {
      description:
        'Patch name/intent/requiredStates/emittedEvents/roles. Sub-collections untouched. roles:[] clears the list.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        name: z.string().min(1).optional(),
        intent: z.string().min(1).optional(),
        requiredStates: z.array(z.string()).optional(),
        emittedEvents: z.array(z.string()).optional(),
        roles: z.array(actionRoleSchema).optional(),
        bypassInvariants: z.boolean().optional(),
        triggeredByEvent: z.string().nullable().optional()
      }
    },
    async ({
      featureId,
      surfaceId,
      actionId,
      name,
      intent,
      requiredStates,
      emittedEvents,
      roles,
      bypassInvariants,
      triggeredByEvent
    }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateAction(exp, asSurfaceId(surfaceId), asActionId(actionId), {
            ...(name !== undefined ? { name } : {}),
            ...(intent !== undefined ? { intent } : {}),
            ...(requiredStates !== undefined
              ? { requiredStates: requiredStates as unknown as Action['requiredStates'] }
              : {}),
            ...(emittedEvents !== undefined
              ? { emittedEvents: emittedEvents as unknown as Action['emittedEvents'] }
              : {}),
            ...(roles !== undefined
              ? { roles: roles.length > 0 ? (roles as readonly ActionRole[]) : undefined }
              : {}),
            ...(bypassInvariants !== undefined ? { bypassInvariants } : {}),
            // null clears the subscription; an explicit string sets it; omit
            // to keep the current value.
            ...(triggeredByEvent !== undefined
              ? {
                  triggeredByEvent:
                    triggeredByEvent === null
                      ? undefined
                      : (triggeredByEvent as Action['triggeredByEvent'])
                }
              : {})
          })
      })
  );

  server.registerTool(
    'remove_action',
    {
      description: 'Delete Action + parameters/rules/effects/invariants.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeAction(exp, asSurfaceId(surfaceId), asActionId(actionId))
      })
  );
};
