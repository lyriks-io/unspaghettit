import { z } from 'zod';
import {
  addTransitionToSurface,
  removeTransitionFromSurface,
  updateTransitionOnSurface
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Transition } from '../../src/features/behavior-model/domain/entities/Transition';
import {
  asFeatureId,
  asSurfaceId,
  asTransitionId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

export const registerTransitionTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_transition',
    {
      description: 'Add Transition from one Surface (surfaceId=source) to another (target). Target must exist.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        target: z.string(),
        label: z.string().optional(),
        description: z.string().min(1)
      }
    },
    async ({ featureId, surfaceId, target, label, description }) => {
      const transition: Transition = {
        id: asTransitionId(ids()),
        target: asSurfaceId(target),
        ...(label ? { label } : {}),
        description
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addTransitionToSurface(exp, asSurfaceId(surfaceId), transition)
        },
        { createdId: transition.id }
      );
    }
  );

  server.registerTool(
    'update_transition',
    {
      description: 'Patch target/label/description. Id fixed.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        transitionId: z.string(),
        target: z.string().optional(),
        label: z.string().optional(),
        description: z.string().min(1).optional()
      }
    },
    async ({ featureId, surfaceId, transitionId, target, label, description }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateTransitionOnSurface(
            exp,
            asSurfaceId(surfaceId),
            asTransitionId(transitionId),
            {
              ...(target !== undefined ? { target: asSurfaceId(target) } : {}),
              ...(label !== undefined ? { label } : {}),
              ...(description !== undefined ? { description } : {})
            }
          )
      })
  );

  server.registerTool(
    'remove_transition',
    {
      description: 'Delete Transition.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        transitionId: z.string()
      }
    },
    async ({ featureId, surfaceId, transitionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeTransitionFromSurface(
            exp,
            asSurfaceId(surfaceId),
            asTransitionId(transitionId)
          )
      })
  );
};
