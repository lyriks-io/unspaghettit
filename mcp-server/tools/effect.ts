import { z } from 'zod';
import {
  addEffectToCapability,
  removeEffectFromCapability,
  updateEffectOnCapability
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Effect } from '../../src/features/behavior-model/domain/value-objects/Effect';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

const effectSchemaDescription =
  'Discriminated by `type`: set_state{path,value,description} | show_message{message,tone?:info|success|warning|error,description} | emit_event{event,description} | block_action{reason,description} | allow_action{description} | transition_surface{target,description}. description is mandatory. set_state.value can be either a raw literal OR a structured Expression { kind:"literal"|"state"|"param"|"add"|"sub"|"mul"|"div"|"mod"|"min"|"max"|"neg", ... }. See add_action_rule description for the full AST. Example: value:{ kind:"add", left:{kind:"state",path:"player.vx"}, right:{kind:"param",name:"ax"} } writes vx+ax. transition_surface accepts `targetRef` in apply_batch to point at a surface created earlier in the same batch (mirrors add_transition).';

const KNOWN_EFFECT_TYPES = [
  'set_state',
  'show_message',
  'emit_event',
  'block_action',
  'allow_action',
  'transition_surface'
] as const;

const effectInputSchema = z
  .record(z.string(), z.unknown())
  .superRefine((effect, ctx) => {
    if (typeof effect.description !== 'string' || effect.description.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Effect description is required'
      });
    }
    // Validate type up-front so bad data can't land in storage and crash the
    // simulator later with "Cannot read properties of undefined (reading
    // 'blocked')". Common slip: writing "block" instead of "block_action".
    const type = (effect as { type?: unknown }).type;
    if (typeof type !== 'string' || !(KNOWN_EFFECT_TYPES as readonly string[]).includes(type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Effect.type must be one of ${KNOWN_EFFECT_TYPES.join(', ')} (got ${JSON.stringify(type)})`
      });
    }
  })
  .describe(effectSchemaDescription);

export const registerEffectTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_effect',
    {
      description: 'Append Effect that fires on action success. For conditional blocks, use add_action_rule.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        effect: effectInputSchema
      }
    },
    async ({ featureId, surfaceId, actionId, effect }) => {
      const built = {
        ...(effect as object),
        id: asEffectId((effect as { id?: string }).id ?? ids())
      } as unknown as Effect;
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            addEffectToCapability(
              exp,
              asSurfaceId(surfaceId),
              asActionId(actionId),
              built
            )
        },
        { createdId: built.id }
      );
    }
  );

  server.registerTool(
    'update_effect',
    {
      description: 'Patch Effect fields. Id fixed.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        effectId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, surfaceId, actionId, effectId, patch }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateEffectOnCapability(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asEffectId(effectId),
            patch as Partial<Effect>
          )
      })
  );

  server.registerTool(
    'remove_effect',
    {
      description: 'Delete Effect from Action.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        effectId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId, effectId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeEffectFromCapability(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asEffectId(effectId)
          )
      })
  );
};
