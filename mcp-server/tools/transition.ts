import { z } from 'zod';
import {
  addTransitionToCapability,
  addTransitionToSurface,
  removeTransitionFromCapability,
  removeTransitionFromSurface,
  updateTransitionOnCapability,
  updateTransitionOnSurface
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Transition } from '../../src/features/behavior-model/domain/entities/Transition';
import {
  asActionId,
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
      description: 'Add Transition from a source (surfaceId) to another surface (target). Target must exist. By default it lands on the SURFACE. Pass actionId to attach it to that action\'s own transitions[] instead (the declarative "this action leads here" edge the diagram/graph/coverage read). Note: the routing the SIMULATOR executes is the transition_surface effect (add_effect), not this declarative edge.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        target: z.string(),
        label: z.string().optional(),
        description: z.string().min(1),
        actionId: z.string().optional()
      }
    },
    async ({ featureId, surfaceId, target, label, description, actionId }) => {
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
          transform: (exp) =>
            actionId
              ? addTransitionToCapability(
                  exp,
                  asSurfaceId(surfaceId),
                  asActionId(actionId),
                  transition
                )
              : addTransitionToSurface(exp, asSurfaceId(surfaceId), transition)
        },
        { createdId: transition.id }
      );
    }
  );

  server.registerTool(
    'update_transition',
    {
      description: 'Patch target/label/description. Id fixed. Pass actionId to target that action\'s transitions[] instead of the surface\'s.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        transitionId: z.string(),
        target: z.string().optional(),
        label: z.string().optional(),
        description: z.string().min(1).optional(),
        actionId: z.string().optional()
      }
    },
    async ({ featureId, surfaceId, transitionId, target, label, description, actionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const patch = {
            ...(target !== undefined ? { target: asSurfaceId(target) } : {}),
            ...(label !== undefined ? { label } : {}),
            ...(description !== undefined ? { description } : {})
          };
          return actionId
            ? updateTransitionOnCapability(
                exp,
                asSurfaceId(surfaceId),
                asActionId(actionId),
                asTransitionId(transitionId),
                patch
              )
            : updateTransitionOnSurface(
                exp,
                asSurfaceId(surfaceId),
                asTransitionId(transitionId),
                patch
              );
        }
      })
  );

  server.registerTool(
    'remove_transition',
    {
      description: 'Delete Transition. Pass actionId to remove from that action\'s transitions[] instead of the surface\'s.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        transitionId: z.string(),
        actionId: z.string().optional()
      }
    },
    async ({ featureId, surfaceId, transitionId, actionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          actionId
            ? removeTransitionFromCapability(
                exp,
                asSurfaceId(surfaceId),
                asActionId(actionId),
                asTransitionId(transitionId)
              )
            : removeTransitionFromSurface(
                exp,
                asSurfaceId(surfaceId),
                asTransitionId(transitionId)
              )
      })
  );
};
