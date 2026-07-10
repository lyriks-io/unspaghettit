import { z } from 'zod';
import { addFeatureToProjectUseCase } from '../../src/features/projects/application/use-cases/AddFeatureToProject';
import { createProjectUseCase } from '../../src/features/projects/application/use-cases/CreateProject';
import { deleteProjectUseCase } from '../../src/features/projects/application/use-cases/DeleteProject';
import { getProjectUseCase } from '../../src/features/projects/application/use-cases/GetProject';
import { getProjectAggregateUseCase } from '../../src/features/projects/application/use-cases/GetProjectAggregate';
import { listProjectsUseCase } from '../../src/features/projects/application/use-cases/ListProjects';
import { moveFeatureInProjectUseCase } from '../../src/features/projects/application/use-cases/MoveFeatureInProject';
import { removeFeatureFromProjectUseCase } from '../../src/features/projects/application/use-cases/RemoveFeatureFromProject';
import { saveProjectUseCase } from '../../src/features/projects/application/use-cases/SaveProject';
import { createFeatureUseCase } from '../../src/features/behavior-model/application/use-cases/CreateFeature';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { asDomainId } from '../../src/features/domains/domain/value-objects/ids';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import { addTag, normalizeTags, removeTag } from '../../src/shared/domain/Tags';
import { buildInvariant as buildInvariantBody } from './_entity_builders';
import { errorText, text, writeErrorText, type ToolDeps } from './_shared';
import { expandFeatureId, expandProjectId } from './short-ids';

/** Authoring shape for a cross-feature project invariant (id is server-minted). */
const projectInvariantInputSchema = z
  .object({
    name: z.string().min(1),
    condition: z.record(z.string(), z.unknown()),
    message: z.string().min(1),
    description: z.string().min(1)
  })
  .describe(
    'A cross-FEATURE invariant: { name, condition: { left, operator, right? }, message, description }. condition.left/right may reference state paths declared in ANY feature of the project (that is the point — feature invariants can\'t). Same inverted semantics as an invariant: condition TRUE = holds, FALSE = violation. Enforced during model checking (verify / unspa check --model-check) over the union of the project\'s features\' state.'
  );

export const registerProjectTools = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, clock, ids } = deps;
  const createProject = createProjectUseCase({ repository: projectRepo, clock, ids });
  const createFeature = createFeatureUseCase({ repository: repo, clock, ids });
  const deleteProject = deleteProjectUseCase({ repository: projectRepo });
  const getProject = getProjectUseCase({ repository: projectRepo });
  const getProjectAggregate = getProjectAggregateUseCase({
    projects: projectRepo,
    features: repo
  });
  const listProjects = listProjectsUseCase({ repository: projectRepo });
  const saveProject = saveProjectUseCase({ repository: projectRepo, clock });
  const addFeatureToProject = addFeatureToProjectUseCase({
    repository: projectRepo,
    clock
  });
  const moveFeatureInProject = moveFeatureInProjectUseCase({
    repository: projectRepo,
    clock
  });
  const removeFeatureFromProject = removeFeatureFromProjectUseCase({
    repository: projectRepo,
    clock
  });

  const tagsSchema = z
    .array(
      z.object({
        type: z.string().min(1),
        value: z.string().min(1)
      })
    )
    .optional();

  server.registerTool(
    'list_projects',
    {
      description:
        'Compact project summaries (id, name, featureCount, timestamps). Cheapest discovery call for projects.',
      inputSchema: {}
    },
    async () => {
      try {
        const summaries = await listProjects();
        return text({ summaries });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'get_project',
    {
      description:
        'Full Project (id, name, description, featureIds[], timestamps). Use list_projects for discovery first.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const project = await getProject(asProjectId(projectId));
        if (!project) return errorText(`Project ${projectId} not found`);
        return text(project);
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'create_project',
    {
      description:
        'Create a Project. A Project groups many Features (each is one LLM-sized slice of behavior, ~1-15 surfaces). Project and Feature descriptions are mandatory. Pass `features: [{ name, description }]` to create empty features and attach them in the same call. Returns the project id + minted feature ids so subsequent apply_batch calls can address them.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().min(1),
        tags: tagsSchema,
        customTagType: z.string().min(1).optional(),
        customTag: z.string().min(1).optional(),
        features: z
          .array(
            z.object({
              name: z.string().min(1),
              description: z.string().min(1)
            })
          )
          .optional(),
        featureNames: z.array(z.string().min(1)).optional()
      }
    },
    async ({ name, description, tags, customTagType, customTag, features, featureNames }) => {
      try {
        if (featureNames && featureNames.length > 0) {
          return errorText(
            'create_project: featureNames is deprecated because feature descriptions are mandatory. Pass features: [{ name, description }] instead.'
          );
        }
        const project = await createProject({
          name,
          description,
          tags: normalizeTags(tags, { type: customTagType, value: customTag })
        });
        // Inline feature creation + attachment keeps the project bootstrap a
        // single round-trip from the LLM's perspective. Each feature starts
        // empty apart from name/description; the caller follows up with
        // apply_batch per feature using the ids we return here.
        const createdFeatures: Array<{ readonly name: string; readonly id: string }> = [];
        if (features && features.length > 0) {
          for (const featureInput of features) {
            const exp = await createFeature({
              name: featureInput.name,
              description: featureInput.description
            });
            await addFeatureToProject(project.id, exp.id);
            createdFeatures.push({ name: featureInput.name, id: String(exp.id) });
          }
        }
        return text({
          ok: true,
          id: project.id,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          ...(createdFeatures.length > 0 ? { features: createdFeatures } : {})
        });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'update_project',
    {
      description:
        'Patch a Project. name / description can be updated; featureIds is patched separately via add_feature_to_project / remove_feature_from_project. projectInvariants is a full REPLACEMENT of the cross-feature invariant list (omit to leave unchanged, pass [] to clear) — read the current list from get_project first if you mean to append.',
      inputSchema: {
        projectId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        tags: tagsSchema,
        customTagType: z.string().min(1).optional(),
        customTag: z.string().min(1).optional(),
        projectInvariants: z.array(projectInvariantInputSchema).optional(),
        domainId: z
          .string()
          .nullable()
          .optional()
          .describe('Parent Domain id (organizational grouping). Pass null to detach from its domain.')
      }
    },
    async ({
      projectId,
      name,
      description,
      tags,
      customTagType,
      customTag,
      projectInvariants,
      domainId
    }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const next = await saveProject({
          ...current,
          name: name !== undefined ? name : current.name,
          description:
            description !== undefined
              ? description
              : current.description,
          tags:
            tags !== undefined || customTag !== undefined
              ? normalizeTags(tags ?? current.tags, { type: customTagType, value: customTag })
              : current.tags,
          customTagType: undefined,
          customTag: undefined,
          projectInvariants:
            projectInvariants !== undefined
              ? projectInvariants.map((inv) =>
                  buildInvariantBody(inv as unknown as Record<string, unknown>, ids)
                )
              : current.projectInvariants,
          domainId:
            domainId !== undefined
              ? domainId === null
                ? undefined
                : asDomainId(domainId)
              : current.domainId
        });
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  // Granular project-invariant authoring — the per-item alternative to
  // update_project's full-replace projectInvariants, mirroring the
  // add/update/remove_feature_invariant tools but at the project scope.
  server.registerTool(
    'add_project_invariant',
    {
      description:
        'Append one cross-feature project invariant (safety property spanning member features). Granular alternative to update_project\'s full-replace projectInvariants — no read-modify-write needed. Enforced during model checking by verify / unspa check --model-check.',
      inputSchema: {
        projectId: z.string(),
        invariant: projectInvariantInputSchema
      }
    },
    async ({ projectId, invariant }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const built = buildInvariantBody(invariant as unknown as Record<string, unknown>, ids);
        const next = await saveProject({
          ...current,
          projectInvariants: [...(current.projectInvariants ?? []), built]
        });
        return text({ ok: true, id: String(built.id), updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'update_project_invariant',
    {
      description: 'Patch one project invariant\'s fields (name / condition / message / description).',
      inputSchema: {
        projectId: z.string(),
        invariantId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ projectId, invariantId, patch }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const list = current.projectInvariants ?? [];
        if (!list.some((inv) => String(inv.id) === invariantId)) {
          return errorText(`Project invariant ${invariantId} not found`);
        }
        const next = await saveProject({
          ...current,
          projectInvariants: list.map((inv) =>
            String(inv.id) === invariantId ? { ...inv, ...(patch as Partial<typeof inv>) } : inv
          )
        });
        return text({ ok: true, id: invariantId, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'remove_project_invariant',
    {
      description: 'Delete one project invariant.',
      inputSchema: {
        projectId: z.string(),
        invariantId: z.string()
      }
    },
    async ({ projectId, invariantId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const next = await saveProject({
          ...current,
          projectInvariants: (current.projectInvariants ?? []).filter(
            (inv) => String(inv.id) !== invariantId
          )
        });
        return text({ ok: true, id: invariantId, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'add_project_tag',
    {
      description:
        'Append a single tag to a Project. Idempotent: re-adding the same {type,value} is a no-op. Use this for the common "user clicks + Tag" flow; prefer update_project when you need to replace the whole tag set at once.',
      inputSchema: {
        projectId: z.string(),
        type: z.string().min(1),
        value: z.string().min(1)
      }
    },
    async ({ projectId, type, value }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const next = await saveProject({
          ...current,
          tags: addTag(current.tags, { type, value }),
          customTagType: undefined,
          customTag: undefined
        });
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt, tags: next.tags ?? [] });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'remove_project_tag',
    {
      description:
        'Remove a single tag from a Project, matched by {type,value} case-insensitively. Idempotent: removing a tag that is not present is a no-op.',
      inputSchema: {
        projectId: z.string(),
        type: z.string().min(1),
        value: z.string().min(1)
      }
    },
    async ({ projectId, type, value }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const current = await getProject(asProjectId(projectId));
        if (!current) return errorText(`Project ${projectId} not found`);
        const next = await saveProject({
          ...current,
          tags: removeTag(current.tags, { type, value }),
          customTagType: undefined,
          customTag: undefined
        });
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt, tags: next.tags ?? [] });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'replace_project',
    {
      description:
        'Escape hatch. Replace a whole Project JSON document. Use update_project for name/description patches and add/remove/move_feature_in_project for featureIds[]. Reach for this only when importing a project from disk or restoring a snapshot. The caller supplies the full {id, name, description?, featureIds[], createdAt, updatedAt} shape; updatedAt is refreshed server-side.',
      inputSchema: { project: z.record(z.string(), z.unknown()) }
    },
    async ({ project }) => {
      try {
        const candidate = project as unknown as Project;
        if (!candidate || typeof candidate !== 'object') {
          return errorText('replace_project: project must be an object');
        }
        if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
          return errorText('replace_project: project.id is required');
        }
        const existing = await getProject(asProjectId(candidate.id));
        if (!existing) return errorText(`Project ${candidate.id} not found`);
        const next = await saveProject({
          ...candidate,
          featureIds: (candidate.featureIds ?? []).map((e) => asFeatureId(String(e))),
          createdAt: existing.createdAt
        });
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'move_feature_in_project',
    {
      description:
        "Reorder an feature within a project's featureIds[]. Idempotent at the boundaries. A no-op when the feature is already first/last in the requested direction. Returns the project updatedAt for cache invalidation.",
      inputSchema: {
        projectId: z.string(),
        featureId: z.string(),
        direction: z.enum(['up', 'down'])
      }
    },
    async ({ projectId, featureId, direction }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        featureId = await expandFeatureId(repo, featureId);
        const next = await moveFeatureInProject(
          asProjectId(projectId),
          asFeatureId(featureId),
          direction
        );
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'get_project_aggregate',
    {
      description:
        'Compact cross-feature view of a project. Loads every attached feature and returns a flat list of resources, data namespaces, registered events, and transitions, each tagged with the source feature. Use this to reason about a project as one logical surface (e.g. "which features in this project touch PII", "which events cross feature boundaries"). Drill into a specific feature with get_feature.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const aggregate = await getProjectAggregate(asProjectId(projectId));
        if (!aggregate) return errorText(`Project ${projectId} not found`);
        return text(aggregate);
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'delete_project',
    {
      description: 'Delete a Project. Idempotent. Does NOT delete the child features.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        await deleteProject(asProjectId(projectId));
        return text({ ok: true, deletedId: projectId });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'add_feature_to_project',
    {
      description:
        'Attach an existing Feature to a Project. Idempotent. A duplicate add is a no-op. Returns the project updatedAt for cache invalidation.',
      inputSchema: {
        projectId: z.string(),
        featureId: z.string()
      }
    },
    async ({ projectId, featureId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        featureId = await expandFeatureId(repo, featureId);
        const next = await addFeatureToProject(
          asProjectId(projectId),
          asFeatureId(featureId)
        );
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'remove_feature_from_project',
    {
      description:
        'Detach an Feature from a Project without deleting the feature itself. Idempotent.',
      inputSchema: {
        projectId: z.string(),
        featureId: z.string()
      }
    },
    async ({ projectId, featureId }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        featureId = await expandFeatureId(repo, featureId);
        const next = await removeFeatureFromProject(
          asProjectId(projectId),
          asFeatureId(featureId)
        );
        return text({ ok: true, id: next.id, updatedAt: next.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );
};
