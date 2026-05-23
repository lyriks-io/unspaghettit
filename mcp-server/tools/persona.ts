import { z } from 'zod';
import {
  addPersona,
  removePersona,
  updatePersona
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Persona } from '../../src/features/behavior-model/domain/entities/Persona';
import {
  asFeatureId,
  asPersonaId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { runMutation, type ToolDeps } from './_shared';

const stateOverrideSchema = z.object({
  path: z.string(),
  value: z.unknown()
});

const parameterOverrideSchema = z.object({
  parameterName: z.string(),
  value: z.unknown()
});

export const registerPersonaTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_persona',
    {
      description: 'Add a simulator preset. Pre-fills state paths and parameters. Use for scenario modeling (logged-out, premium, EU resident).',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        stateOverrides: z.array(stateOverrideSchema).default([]),
        parameterOverrides: z.array(parameterOverrideSchema).default([]),
        persistAcrossSurfaces: z.boolean().optional()
      }
    },
    async ({
      featureId,
      name,
      description,
      stateOverrides,
      parameterOverrides,
      persistAcrossSurfaces
    }) => {
      const persona: Persona = {
        id: asPersonaId(ids()),
        name,
        description,
        stateOverrides: stateOverrides.map((o) => ({
          path: asStatePath(o.path),
          value: o.value as Persona['stateOverrides'][number]['value']
        })),
        parameterOverrides: parameterOverrides.map((o) => ({
          parameterName: o.parameterName,
          value: o.value as Persona['parameterOverrides'][number]['value']
        })),
        ...(persistAcrossSurfaces !== undefined ? { persistAcrossSurfaces } : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addPersona(exp, persona)
        },
        { createdId: persona.id }
      );
    }
  );

  server.registerTool(
    'update_persona',
    {
      description: 'Patch Persona fields. Id fixed. Override arrays are full replacements when provided.',
      inputSchema: {
        featureId: z.string(),
        personaId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        stateOverrides: z.array(stateOverrideSchema).optional(),
        parameterOverrides: z.array(parameterOverrideSchema).optional(),
        persistAcrossSurfaces: z.boolean().optional()
      }
    },
    async ({
      featureId,
      personaId,
      name,
      description,
      stateOverrides,
      parameterOverrides,
      persistAcrossSurfaces
    }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = exp.personas.find((p) => p.id === asPersonaId(personaId));
          if (!existing) return exp;
          const merged: Persona = {
            ...existing,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(stateOverrides !== undefined
              ? {
                  stateOverrides: stateOverrides.map((o) => ({
                    path: asStatePath(o.path),
                    value: o.value as Persona['stateOverrides'][number]['value']
                  }))
                }
              : {}),
            ...(parameterOverrides !== undefined
              ? {
                  parameterOverrides: parameterOverrides.map((o) => ({
                    parameterName: o.parameterName,
                    value: o.value as Persona['parameterOverrides'][number]['value']
                  }))
                }
              : {}),
            ...(persistAcrossSurfaces !== undefined ? { persistAcrossSurfaces } : {})
          };
          return updatePersona(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_persona',
    {
      description: 'Delete Persona.',
      inputSchema: {
        featureId: z.string(),
        personaId: z.string()
      }
    },
    async ({ featureId, personaId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removePersona(exp, asPersonaId(personaId))
      })
  );
};
