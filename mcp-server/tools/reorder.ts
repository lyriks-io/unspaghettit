import { z } from 'zod';
import {
  moveActionBy,
  moveParameterBy,
  moveStateDefinitionBy,
  moveSurfaceBy
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import {
  asActionId,
  asFeatureId,
  asParameterId,
  asStateDefinitionId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

const directionSchema = z.enum(['up', 'down']).describe('up=toward index 0, down=toward end');

const directionToDelta = (d: 'up' | 'down'): -1 | 1 => (d === 'up' ? -1 : 1);

export const registerReorderTools = (deps: ToolDeps): void => {
  const { server } = deps;

  server.registerTool(
    'move_surface',
    {
      description: 'Swap with same-depth sibling. Subtree moves with it. No-op at edge.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        direction: directionSchema
      }
    },
    async ({ featureId, surfaceId, direction }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => moveSurfaceBy(exp, asSurfaceId(surfaceId), directionToDelta(direction))
      })
  );

  server.registerTool(
    'move_action',
    {
      description: 'Reorder Action within its surface. No-op at edge.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        direction: directionSchema
      }
    },
    async ({ featureId, surfaceId, actionId, direction }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          moveActionBy(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            directionToDelta(direction)
          )
      })
  );

  server.registerTool(
    'move_parameter',
    {
      description: 'Reorder Parameter (display only).',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        parameterId: z.string(),
        direction: directionSchema
      }
    },
    async ({ featureId, surfaceId, actionId, parameterId, direction }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          moveParameterBy(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asParameterId(parameterId),
            directionToDelta(direction)
          )
      })
  );

  server.registerTool(
    'move_state_definition',
    {
      description: 'Reorder StateDefinition (display only).',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        stateDefinitionId: z.string(),
        direction: directionSchema
      }
    },
    async ({ featureId, surfaceId, stateDefinitionId, direction }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          moveStateDefinitionBy(
            exp,
            asSurfaceId(surfaceId),
            asStateDefinitionId(stateDefinitionId),
            directionToDelta(direction)
          )
      })
  );
};
