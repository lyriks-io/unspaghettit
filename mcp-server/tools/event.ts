import { z } from 'zod';
import {
  addEvent,
  removeEvent,
  updateEvent
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type {
  EventDefinition,
  EventPayloadField
} from '../../src/features/behavior-model/domain/entities/EventDefinition';
import type { EventName } from '../../src/features/behavior-model/domain/value-objects/EventName';
import {
  asEventDefinitionId,
  asFeatureId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import type { StateType } from '../../src/features/behavior-model/domain/value-objects/StateValue';
import { runMutation, type ToolDeps } from './_shared';

const payloadFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array'
] as const);

const payloadFieldSchema = z.object({
  name: z.string().min(1),
  type: payloadFieldTypeSchema,
  required: z.boolean(),
  description: z.string().min(1)
});

const eventDeliverySchema = z
  .enum(['best_effort', 'required', 'transactional'] as const)
  .describe(
    'Delivery guarantee. best_effort (default): a failing handler never affects the emitter. required: a failing handler blocks the emitter. transactional: a failing handler also rolls the emitter back.'
  );

const buildPayload = (raw: z.infer<typeof payloadFieldSchema>): EventPayloadField => ({
  name: raw.name,
  type: raw.type as StateType,
  required: raw.required,
  description: raw.description
});

export const registerEventTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_event',
    {
      description:
        'Register a first-class event with optional payloadSchema. Action.emittedEvents and emit_event effects reference events by name; this entry lets the dashboard show payload shape and lets the validator catch unknown event names. Name must be dot-separated (e.g. "cart.item.added") and unique within the feature. Set `delivery` (best_effort default | required | transactional) to make a failing handler block, or roll back, the action that emitted it.',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        payloadSchema: z.array(payloadFieldSchema).optional(),
        delivery: eventDeliverySchema.optional()
      }
    },
    async ({ featureId, name, description, payloadSchema, delivery }) => {
      const event: EventDefinition = {
        id: asEventDefinitionId(ids()),
        name: name as EventName,
        description,
        ...(payloadSchema && payloadSchema.length > 0
          ? { payloadSchema: payloadSchema.map(buildPayload) }
          : {}),
        ...(delivery ? { delivery } : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addEvent(exp, event)
        },
        { createdId: event.id }
      );
    }
  );

  server.registerTool(
    'update_event',
    {
      description:
        'Patch an EventDefinition. Passing payloadSchema:[] clears the payload schema. Renaming the event does not auto-rewrite existing emit_event effects or action.emittedEvents. Re-tag those manually.',
      inputSchema: {
        featureId: z.string(),
        eventId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        payloadSchema: z.array(payloadFieldSchema).optional(),
        delivery: eventDeliverySchema.optional()
      }
    },
    async ({ featureId, eventId, name, description, payloadSchema, delivery }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = (exp.events ?? []).find(
            (e) => e.id === asEventDefinitionId(eventId)
          );
          if (!existing) throw new EntityNotFoundInFeatureError('event', eventId);
          const merged: EventDefinition = {
            ...existing,
            ...(name !== undefined ? { name: name as EventName } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(delivery !== undefined ? { delivery } : {}),
            ...(payloadSchema !== undefined
              ? payloadSchema.length === 0
                ? { payloadSchema: undefined }
                : { payloadSchema: payloadSchema.map(buildPayload) }
              : {})
          };
          return updateEvent(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_event',
    {
      description:
        'Delete an EventDefinition. References from emit_event effects and action.emittedEvents are left dangling. Search for the name with find_state_references first.',
      inputSchema: {
        featureId: z.string(),
        eventId: z.string()
      }
    },
    async ({ featureId, eventId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeEvent(exp, asEventDefinitionId(eventId))
      })
  );
};
