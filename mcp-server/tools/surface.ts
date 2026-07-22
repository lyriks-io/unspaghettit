import { z } from 'zod';
import {
  addSurface,
  removeSurface,
  renameSurface,
  setSurfaceParent
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Surface, SurfaceType } from '../../src/features/behavior-model/domain/entities/Surface';
import { ALL_SURFACE_TYPES } from '../../src/features/behavior-model/domain/entities/Surface';
import {
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

export const registerSurfaceTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_surface',
    {
      description: 'Append empty Surface. Types: screen, canvas, terminal, board, workflow, command_palette, api_playground, map, dialog_area, custom.',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1),
        type: z.enum(ALL_SURFACE_TYPES as unknown as [SurfaceType, ...SurfaceType[]]),
        description: z.string().min(1),
        parentSurfaceId: z.string().optional(),
        presentation: z
          .boolean()
          .optional()
          .describe(
            'Mark true for view-only/presentation surfaces excluded from behavior-maturity scoring.'
          )
      }
    },
    async ({ featureId, name, type, description, parentSurfaceId, presentation }) => {
      const surface: Surface = {
        id: asSurfaceId(ids()),
        name,
        type,
        description,
        stateDefinitions: [],
        actions: [],
        rules: [],
        invariants: [],
        transitions: [],
        ...(presentation !== undefined ? { presentation } : {}),
        ...(parentSurfaceId ? { parentSurfaceId: asSurfaceId(parentSurfaceId) } : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addSurface(exp, surface)
        },
        { createdId: surface.id }
      );
    }
  );

  server.registerTool(
    'update_surface',
    {
      description: 'Patch name/type/description/parent/presentation. Description cannot be cleared; null parentSurfaceId unparents.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        name: z.string().min(1).optional(),
        type: z.enum(ALL_SURFACE_TYPES as unknown as [SurfaceType, ...SurfaceType[]]).optional(),
        description: z.string().min(1).optional(),
        parentSurfaceId: z.string().nullable().optional(),
        presentation: z
          .boolean()
          .optional()
          .describe(
            'Mark true for view-only/presentation surfaces excluded from behavior-maturity scoring; false re-includes the surface.'
          )
      }
    },
    async ({ featureId, surfaceId, name, type, description, parentSurfaceId, presentation }) => {
      const sId = asSurfaceId(surfaceId);
      const eId = asFeatureId(featureId);
      // Two transforms composed: meta patch via renameSurface, then parent via
      // setSurfaceParent if explicitly passed (null clears).
      return runMutation(deps, {
        featureId: eId,
        transform: (exp) => {
          let next = renameSurface(exp, sId, {
            ...(name !== undefined ? { name } : {}),
            ...(type !== undefined ? { type } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(presentation !== undefined ? { presentation } : {})
          });
          if (parentSurfaceId !== undefined) {
            next = setSurfaceParent(
              next,
              sId,
              parentSurfaceId === null ? null : asSurfaceId(parentSurfaceId)
            );
          }
          return next;
        }
      });
    }
  );

  server.registerTool(
    'remove_surface',
    {
      description: 'Delete Surface + all it contains. Transitions targeting it must be cleaned up first.',
      inputSchema: { featureId: z.string(), surfaceId: z.string() }
    },
    async ({ featureId, surfaceId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeSurface(exp, asSurfaceId(surfaceId))
      })
  );
};
