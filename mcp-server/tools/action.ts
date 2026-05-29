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
import { evolutionInputSchema, normalizeEvolution } from './_evolution';

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
        triggeredByEvent: z.string().min(1).optional(),
        evolution: evolutionInputSchema
          .optional()
          .describe('Mark this action as a proposed Evolution (dashed placeholder) instead of committed behavior. Prefer propose_evolution for the common case.')
      }
    },
    async ({ featureId, surfaceId, name, intent, requiredStates, emittedEvents, roles, bypassInvariants, triggeredByEvent, evolution }) => {
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
        ...(triggeredByEvent ? { triggeredByEvent: triggeredByEvent as Action['triggeredByEvent'] } : {}),
        ...(evolution ? { evolution: normalizeEvolution(evolution) } : {})
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
        'Patch name/intent/requiredStates/emittedEvents/roles. Sub-collections untouched. roles:[] clears the list. Pass evolution to mark a proposal, or evolution:null to ACCEPT it (clear the marker and promote the action to committed behavior).',
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
        triggeredByEvent: z.string().nullable().optional(),
        evolution: evolutionInputSchema
          .nullable()
          .optional()
          .describe('Set the Evolution marker, or pass null to accept the proposal (clear it).')
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
      triggeredByEvent,
      evolution
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
              : {}),
            // null accepts the proposal (clears the marker); an object sets it;
            // omit to leave the current evolution state untouched.
            ...(evolution !== undefined
              ? {
                  evolution:
                    evolution === null ? undefined : normalizeEvolution(evolution)
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

  server.registerTool(
    'propose_evolution',
    {
      description:
        'Propose an Evolution: a forward-looking improvement to the feature, created as a skeleton Action marked as a proposal (dashed placeholder). Use this proactively right after building a feature/surface/action — infer the app type and suggest what a strong version would add (e.g. "Sign in with SSO" on an auth surface, "Rate-limit password attempts" for security). The action is REAL (has an id, can be enqueued) but stays out of maturity/spec-gap analysis until accepted. Body is intentionally empty — flesh it out only when the user accepts. To accept later: update_action with evolution:null; to schedule it: enqueue kind:"action".',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        name: z.string().min(1).describe('Short verb phrase, e.g. "Sign in with SSO".'),
        intent: z.string().min(1).describe('What this would do if built.'),
        rationale: evolutionInputSchema.shape.rationale,
        category: evolutionInputSchema.shape.category,
        source: evolutionInputSchema.shape.source
      }
    },
    async ({ featureId, surfaceId, name, intent, rationale, category, source }) => {
      const action: Action = {
        id: asActionId(ids()),
        name,
        intent,
        parameters: [],
        requiredStates: [] as unknown as Action['requiredStates'],
        rules: [],
        invariants: [],
        effects: [],
        emittedEvents: [] as unknown as Action['emittedEvents'],
        transitions: [],
        evolution: normalizeEvolution({ rationale, category, source })
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
};
