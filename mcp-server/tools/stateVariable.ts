import { z } from 'zod';
import { saveProjectUseCase } from '../../src/features/projects/application/use-cases/SaveProject';
import type { StateVariable } from '../../src/features/projects/domain/entities/StateVariable';
import {
  projectStateVariables,
  stateCoherenceIssues
} from '../../src/features/projects/domain/services/stateRegistry';
import {
  asProjectId,
  asStateVariableId
} from '../../src/features/projects/domain/value-objects/ids';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asSurfaceId,
  asValueSetId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import type { StateType } from '../../src/features/behavior-model/domain/value-objects/StateValue';
import { coerceScalarByType, errorText, text, writeErrorText, type ToolDeps } from './_shared';
import { expandProjectId } from './short-ids';

const stateTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'object', 'array'] as const);
const projectionSchema = z.object({ featureId: z.string(), surfaceId: z.string() });
const projection = (value: { featureId: string; surfaceId: string }) => ({
  featureId: asFeatureId(value.featureId),
  surfaceId: asSurfaceId(value.surfaceId)
});

export const registerStateVariableTools = (deps: ToolDeps): void => {
  const { server, projectRepo, repo, ids, clock } = deps;
  const saveProject = saveProjectUseCase({ repository: projectRepo, clock });

  const load = async (rawProjectId: string) => {
    const projectId = await expandProjectId(projectRepo, rawProjectId);
    const project = await projectRepo.get(asProjectId(projectId));
    if (!project) throw new Error(`Project ${projectId} not found`);
    const features = (
      await Promise.all(project.featureIds.map((featureId) => repo.get(featureId)))
    ).filter((feature): feature is NonNullable<typeof feature> => feature !== null);
    return { project, features };
  };

  server.registerTool(
    'list_state_variables',
    {
      description:
        'List canonical project state variables. Legacy snapshots are projected by grouping surface stateDefinitions by path, without rewriting them. Includes data-field coherence diagnostics.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        const { project, features } = await load(projectId);
        const stateVariables = projectStateVariables(project, features);
        return text({
          stateVariables,
          coherenceIssues: stateCoherenceIssues(stateVariables, features)
        });
      } catch (error) {
        return errorText((error as Error).message);
      }
    }
  );

  server.registerTool(
    'add_state_variable',
    {
      description:
        'Declare one canonical project-scoped state identity. path is unique within the project; owner identifies the feature/surface that owns its schema.',
      inputSchema: {
        projectId: z.string(),
        path: z.string().min(1),
        type: stateTypeSchema,
        defaultValue: z.unknown(),
        description: z.string().min(1),
        valueSetId: z.string().optional(),
        enumValues: z.array(z.string()).optional(),
        owner: projectionSchema,
        readers: z.array(projectionSchema).optional(),
        writers: z.array(projectionSchema).optional()
      }
    },
    async ({
      projectId,
      path,
      type,
      defaultValue,
      description,
      valueSetId,
      enumValues,
      owner,
      readers,
      writers
    }) => {
      try {
        const { project, features } = await load(projectId);
        if (projectStateVariables(project, features).some((state) => String(state.path) === path)) {
          return errorText(
            `State path "${path}" already has a canonical identity in this project.`
          );
        }
        if (valueSetId && enumValues) {
          return errorText('Supply either valueSetId or enumValues, not both.');
        }
        const ownerFeature = features.find((feature) => String(feature.id) === owner.featureId);
        if (!ownerFeature?.surfaces.some((surface) => String(surface.id) === owner.surfaceId)) {
          return errorText('State owner must resolve to a surface in a project feature.');
        }
        if (
          valueSetId &&
          !(ownerFeature.valueSets ?? []).some((set) => String(set.id) === valueSetId)
        ) {
          return errorText(
            `Value set ${valueSetId} does not resolve on owner feature ${owner.featureId}.`
          );
        }
        const state: StateVariable = {
          id: asStateVariableId(ids()),
          path: asStatePath(path),
          type: type as StateType,
          defaultValue: coerceScalarByType(defaultValue, type) as StateVariable['defaultValue'],
          description,
          ...(valueSetId ? { valueSetId: asValueSetId(valueSetId) } : {}),
          ...(enumValues ? { enumValues } : {}),
          owner: projection(owner),
          readers: (readers ?? []).map(projection),
          writers: (writers ?? []).map(projection)
        };
        const saved = await saveProject({
          ...project,
          stateVariables: [...(project.stateVariables ?? []), state]
        });
        return text({ ok: true, projectId: saved.id, updatedAt: saved.updatedAt, id: state.id });
      } catch (error) {
        return writeErrorText(error);
      }
    }
  );

  server.registerTool(
    'update_state_variable',
    {
      description:
        'Patch canonical state schema or its reader/writer projections. The stable id cannot change.',
      inputSchema: {
        projectId: z.string(),
        stateId: z.string(),
        path: z.string().min(1).optional(),
        type: stateTypeSchema.optional(),
        defaultValue: z.unknown().optional(),
        description: z.string().min(1).optional(),
        valueSetId: z.string().nullable().optional(),
        enumValues: z.array(z.string()).nullable().optional(),
        owner: projectionSchema.optional(),
        readers: z.array(projectionSchema).optional(),
        writers: z.array(projectionSchema).optional()
      }
    },
    async ({
      projectId,
      stateId,
      path,
      type,
      defaultValue,
      description,
      valueSetId,
      enumValues,
      owner,
      readers,
      writers
    }) => {
      try {
        const { project } = await load(projectId);
        const current = (project.stateVariables ?? []).find(
          (state) => String(state.id) === stateId
        );
        if (!current) return errorText(`Registered state variable ${stateId} not found.`);
        if (
          path &&
          (project.stateVariables ?? []).some(
            (state) => state !== current && String(state.path) === path
          )
        ) {
          return errorText(`State path "${path}" is already registered.`);
        }
        const nextType = type ?? current.type;
        const next: StateVariable = {
          ...current,
          ...(path ? { path: asStatePath(path) } : {}),
          ...(type ? { type: type as StateType } : {}),
          ...(defaultValue !== undefined
            ? {
                defaultValue: coerceScalarByType(
                  defaultValue,
                  nextType
                ) as StateVariable['defaultValue']
              }
            : {}),
          ...(description ? { description } : {}),
          ...(valueSetId !== undefined
            ? { valueSetId: valueSetId === null ? undefined : asValueSetId(valueSetId) }
            : {}),
          ...(enumValues !== undefined ? { enumValues: enumValues ?? undefined } : {}),
          ...(owner ? { owner: projection(owner) } : {}),
          ...(readers ? { readers: readers.map(projection) } : {}),
          ...(writers ? { writers: writers.map(projection) } : {})
        };
        const saved = await saveProject({
          ...project,
          stateVariables: (project.stateVariables ?? []).map((state) =>
            state === current ? next : state
          )
        });
        return text({ ok: true, projectId: saved.id, updatedAt: saved.updatedAt });
      } catch (error) {
        return writeErrorText(error);
      }
    }
  );

  server.registerTool(
    'link_state_variable',
    {
      description:
        'Set explicit projections for a canonical state variable. dataField links are checked for type/enum drift by list_state_variables, get_project_aggregate, and verify consumers.',
      inputSchema: {
        projectId: z.string(),
        stateId: z.string(),
        dataField: z
          .object({ featureId: z.string(), entityId: z.string(), fieldId: z.string() })
          .nullable()
          .optional(),
        builderBinding: z
          .union([
            z.object({ seed: z.literal(true) }),
            z.object({ nodeId: z.string(), kind: z.literal('state') })
          ])
          .nullable()
          .optional()
      }
    },
    async ({ projectId, stateId, dataField, builderBinding }) => {
      try {
        const { project } = await load(projectId);
        const current = (project.stateVariables ?? []).find(
          (state) => String(state.id) === stateId
        );
        if (!current) return errorText(`Registered state variable ${stateId} not found.`);
        const links = {
          ...(current.links ?? {}),
          ...(dataField !== undefined
            ? {
                dataField:
                  dataField === null
                    ? undefined
                    : {
                        featureId: asFeatureId(dataField.featureId),
                        entityId: asEntityId(dataField.entityId),
                        fieldId: asEntityFieldId(dataField.fieldId)
                      }
              }
            : {}),
          ...(builderBinding !== undefined ? { builderBinding: builderBinding ?? undefined } : {})
        };
        const next = { ...current, links };
        const saved = await saveProject({
          ...project,
          stateVariables: (project.stateVariables ?? []).map((state) =>
            state === current ? next : state
          )
        });
        return text({ ok: true, projectId: saved.id, updatedAt: saved.updatedAt });
      } catch (error) {
        return writeErrorText(error);
      }
    }
  );

  server.registerTool(
    'remove_state_variable',
    {
      description:
        'Remove a registered canonical state identity. Surface projections are left intact as legacy stateDefinitions.',
      inputSchema: { projectId: z.string(), stateId: z.string() }
    },
    async ({ projectId, stateId }) => {
      try {
        const { project } = await load(projectId);
        const saved = await saveProject({
          ...project,
          stateVariables: (project.stateVariables ?? []).filter(
            (state) => String(state.id) !== stateId
          )
        });
        return text({ ok: true, projectId: saved.id, updatedAt: saved.updatedAt });
      } catch (error) {
        return writeErrorText(error);
      }
    }
  );
};
