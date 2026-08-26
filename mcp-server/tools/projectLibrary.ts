import { z } from 'zod';
import type { Entity } from '../../src/features/behavior-model/domain/entities/Entity';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Persona } from '../../src/features/behavior-model/domain/entities/Persona';
import type { Resource } from '../../src/features/behavior-model/domain/entities/Resource';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { stampElementVersions } from '../../src/features/behavior-model/domain/services/FeatureElementVersions';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import {
  ALL_LIBRARY_KINDS,
  findInLibrary,
  linkLibraryRef,
  putLibraryEntity,
  putLibraryPersona,
  putLibraryResource,
  removeFromLibrary,
  unlinkLibraryRef,
  type LibraryKind
} from '../../src/features/projects/domain/services/projectLibrary';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId, expandProjectId } from './short-ids';
import { findOwningProject } from '../../src/features/projects/application/services/bulkRead';

const kindSchema = z.enum(ALL_LIBRARY_KINDS as unknown as [LibraryKind, ...LibraryKind[]]);

/** Pull one definition of the given kind out of a feature by id. */
const takeFromFeature = (
  feature: Feature,
  kind: LibraryKind,
  id: string
): Entity | Resource | Persona | undefined => {
  const source =
    kind === 'entity' ? feature.entities : kind === 'resource' ? feature.resources : feature.personas;
  return source.find((value) => String(value.id) === id);
};

/** Drop one definition of the given kind from a feature by id. */
const dropFromFeature = (feature: Feature, kind: LibraryKind, id: string): Feature => {
  const without = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] =>
    values.filter((value) => String(value.id) !== id);
  switch (kind) {
    case 'entity':
      return { ...feature, entities: without(feature.entities) };
    case 'resource':
      return { ...feature, resources: without(feature.resources) };
    case 'persona':
      return { ...feature, personas: without(feature.personas) };
  }
};

const putInLibrary = (
  project: Project,
  kind: LibraryKind,
  value: Entity | Resource | Persona
): Project => {
  switch (kind) {
    case 'entity':
      return putLibraryEntity(project, value as Entity);
    case 'resource':
      return putLibraryResource(project, value as Resource);
    case 'persona':
      return putLibraryPersona(project, value as Persona);
  }
};

const libraryOf = (project: Project, kind: LibraryKind) =>
  kind === 'entity' ? project.entities : kind === 'resource' ? project.resources : project.personas;

const label = (value: Entity | Resource | Persona): string =>
  'namespace' in value ? value.namespace : value.name;

/**
 * A definition's CONTENT, with every `id` stripped recursively.
 *
 * Two features that authored "the same" entity independently minted their own
 * ids for it AND for each of its nested fields, so a raw comparison would
 * report every copy as divergent and the migration would never collapse
 * anything. Ids are incidental here — what decides whether two copies are the
 * same definition is everything else.
 */
const contentOf = (value: unknown): string =>
  JSON.stringify(value, (key, inner) => (key === 'id' ? undefined : inner));

export const registerProjectLibraryTools = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, clock } = deps;

  server.registerTool(
    'list_project_library',
    {
      description:
        "The project's CANONICAL LIBRARY: entities, resources and personas defined ONCE at project level and referenced from member features via entityRefs / resourceRefs / personaRefs, instead of being copied into each one. Returns each definition with the features that reference it, plus any dangling refs (a member feature pointing at a definition that no longer exists). Read this before promoting or linking so you use the real ids — never invent them.",
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        const id = await expandProjectId(projectRepo, projectId);
        const project = await projectRepo.get(asProjectId(id));
        if (!project) return errorText(`Project ${projectId} not found.`);

        const referencedBy = new Map<string, string[]>();
        const dangling: { kind: LibraryKind; id: string; featureId: string }[] = [];
        for (const featureId of project.featureIds) {
          const feature = await repo.get(featureId);
          if (!feature) continue;
          const refsOf = (kind: LibraryKind): readonly string[] =>
            (kind === 'entity'
              ? feature.entityRefs
              : kind === 'resource'
                ? feature.resourceRefs
                : feature.personaRefs
            )?.map(String) ?? [];
          for (const kind of ALL_LIBRARY_KINDS) {
            for (const ref of refsOf(kind)) {
              const key = `${kind}:${ref}`;
              referencedBy.set(key, [...(referencedBy.get(key) ?? []), String(feature.id)]);
              if (!findInLibrary(project, kind, ref)) {
                dangling.push({ kind, id: ref, featureId: String(feature.id) });
              }
            }
          }
        }

        return text({
          projectId: String(project.id),
          library: ALL_LIBRARY_KINDS.flatMap((kind) =>
            (libraryOf(project, kind) ?? []).map((value) => ({
              kind,
              id: String(value.id),
              name: label(value),
              ...(value.description ? { description: value.description } : {}),
              referencedBy: referencedBy.get(`${kind}:${String(value.id)}`) ?? []
            }))
          ),
          dangling
        });
      } catch (e) {
        return errorText(`list_project_library failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'promote_to_project_library',
    {
      description:
        "MIGRATION: inline copy → canonical reference. Moves one entity / resource / persona out of a feature into the owning project's library, replaces it with a reference in that feature, and (unless dedupe:false) collapses IDENTICALLY-NAMED copies in the project's OTHER features into references to the same definition, deleting the duplicates. This is the fix for the copy-per-feature pattern: after it, the definition is stored once and every consumer still resolves it as if it were local. Reports which features were rewritten and which copies it deliberately left alone because they differ from the canonical one.",
      inputSchema: {
        featureId: z.string().describe('Feature currently holding the definition to promote.'),
        kind: kindSchema,
        id: z.string().describe('Id of the entity / resource / persona to promote.'),
        dedupe: z
          .boolean()
          .optional()
          .describe(
            'Default true. Also collapse same-named copies in sibling features into a reference. Set false to promote only this feature\'s copy.'
          )
      }
    },
    async ({ featureId, kind, id, dedupe }) => {
      try {
        const expandedFeatureId = await expandFeatureId(repo, featureId);
        const feature = await repo.get(asFeatureId(expandedFeatureId));
        if (!feature) return errorText(`Feature ${featureId} not found.`);

        const project: Project | null = await findOwningProject(projectRepo, String(feature.id));
        if (!project) {
          return errorText(
            `Feature ${feature.id} is not a member of any project, so there is no library to promote into. Add it with add_feature_to_project first.`
          );
        }

        const definition = takeFromFeature(feature, kind, id);
        if (!definition) {
          return errorText(
            `Feature ${feature.id} has no ${kind} with id "${id}". Read the real ids with get_feature(verbose:true).`
          );
        }

        const nextProject = putInLibrary(project, kind, definition);
        const canonicalName = label(definition);
        const rewritten: string[] = [String(feature.id)];
        const skipped: { featureId: string; id: string; reason: string }[] = [];

        // The source feature: drop the copy, add the ref.
        const promotedSource = linkLibraryRef(dropFromFeature(feature, kind, id), kind, id);

        // Siblings: collapse copies that are IDENTICAL apart from their id.
        // A copy that has drifted is left alone and reported — silently
        // discarding someone's diverged definition is exactly the kind of
        // invisible data loss this feature exists to prevent.
        const siblingSaves: Feature[] = [];
        if (dedupe !== false) {
          const canonicalBody = contentOf(definition);
          for (const memberId of project.featureIds) {
            if (String(memberId) === String(feature.id)) continue;
            const sibling = await repo.get(memberId);
            if (!sibling) continue;
            const source =
              kind === 'entity'
                ? sibling.entities
                : kind === 'resource'
                  ? sibling.resources
                  : sibling.personas;
            const twin = source.find((value) => label(value) === canonicalName);
            if (!twin) continue;
            if (contentOf(twin) !== canonicalBody) {
              skipped.push({
                featureId: String(sibling.id),
                id: String(twin.id),
                reason: `its "${canonicalName}" ${kind} differs from the promoted one; reconcile them, then re-run`
              });
              continue;
            }
            siblingSaves.push(
              linkLibraryRef(dropFromFeature(sibling, kind, String(twin.id)), kind, id)
            );
            rewritten.push(String(sibling.id));
          }
        }

        // Library first: a half-applied promotion that leaves features
        // referencing a definition the project doesn't have yet is the one
        // outcome worth ordering against.
        await projectRepo.save({ ...nextProject, updatedAt: clock() });
        for (const toSave of [promotedSource, ...siblingSaves]) {
          // Re-read the prior so element stamps move only for what this
          // promotion actually rewrote (see FeatureElementVersions).
          const now = clock();
          const prior = await repo.get(toSave.id);
          await repo.save(stampElementVersions(prior, { ...toSave, updatedAt: now }, now));
        }

        return text({
          ok: true,
          projectId: String(project.id),
          kind,
          id,
          name: canonicalName,
          rewrittenFeatures: rewritten,
          skipped
        });
      } catch (e) {
        return errorText(`promote_to_project_library failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'link_project_definition',
    {
      description:
        "Make a feature REFERENCE a definition already in the project's canonical library (see list_project_library), instead of carrying its own copy. Idempotent. The definition resolves into the feature's entities/resources/personas on every read, so verify, model_check, run_all_scenarios, digests and the dashboard all see it as if it were local.",
      inputSchema: {
        featureId: z.string(),
        kind: kindSchema,
        id: z.string().describe('Id of the library definition to reference.')
      }
    },
    async ({ featureId, kind, id }) => {
      try {
        const expandedFeatureId = await expandFeatureId(repo, featureId);
        const feature = await repo.get(asFeatureId(expandedFeatureId));
        if (!feature) return errorText(`Feature ${featureId} not found.`);

        const project: Project | null = await findOwningProject(projectRepo, String(feature.id));
        if (!project) {
          return errorText(
            `Feature ${feature.id} is not a member of any project. Add it with add_feature_to_project before linking library definitions.`
          );
        }
        if (!findInLibrary(project, kind, id)) {
          return errorText(
            `Project ${project.id} has no ${kind} "${id}" in its library. Call list_project_library for the real ids, or promote_to_project_library to put one there.`
          );
        }
        const linkedAt = clock();
        await repo.save(
          stampElementVersions(feature, { ...linkLibraryRef(feature, kind, id), updatedAt: linkedAt }, linkedAt)
        );
        return text({ ok: true, featureId: String(feature.id), kind, id });
      } catch (e) {
        return errorText(`link_project_definition failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'unlink_project_definition',
    {
      description:
        "Stop a feature from referencing a project-library definition. Drops the ref AND the resolved copy, so the feature does not silently keep an inline duplicate. The canonical definition stays in the library for every other feature. Use this to clear a DANGLING ref reported by verify or list_project_library.",
      inputSchema: { featureId: z.string(), kind: kindSchema, id: z.string() }
    },
    async ({ featureId, kind, id }) => {
      try {
        const expandedFeatureId = await expandFeatureId(repo, featureId);
        const feature = await repo.get(asFeatureId(expandedFeatureId));
        if (!feature) return errorText(`Feature ${featureId} not found.`);
        const unlinkedAt = clock();
        await repo.save(
          stampElementVersions(feature, { ...unlinkLibraryRef(feature, kind, id), updatedAt: unlinkedAt }, unlinkedAt)
        );
        return text({ ok: true, featureId: String(feature.id), kind, id });
      } catch (e) {
        return errorText(`unlink_project_definition failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'remove_project_definition',
    {
      description:
        "Delete a definition from the project's canonical library. Member features KEEP their reference, which then reports as a dangling ref in verify / list_project_library — deliberately loud, because silently rewriting N features from one project-level delete is the invisible cascade this model exists to avoid. Clear each ref with unlink_project_definition.",
      inputSchema: { projectId: z.string(), kind: kindSchema, id: z.string() }
    },
    async ({ projectId, kind, id }) => {
      try {
        const expandedId = await expandProjectId(projectRepo, projectId);
        const project = await projectRepo.get(asProjectId(expandedId));
        if (!project) return errorText(`Project ${projectId} not found.`);
        if (!findInLibrary(project, kind, id)) {
          return errorText(`Project ${project.id} has no ${kind} "${id}" in its library.`);
        }
        const referencing: string[] = [];
        for (const featureId of project.featureIds) {
          const feature = await repo.get(featureId);
          if (!feature) continue;
          const refs =
            (kind === 'entity'
              ? feature.entityRefs
              : kind === 'resource'
                ? feature.resourceRefs
                : feature.personaRefs
            )?.map(String) ?? [];
          if (refs.includes(id)) referencing.push(String(feature.id));
        }
        await projectRepo.save({
          ...removeFromLibrary(project, kind, id),
          updatedAt: clock()
        });
        return text({
          ok: true,
          projectId: String(project.id),
          kind,
          id,
          nowDanglingIn: referencing
        });
      } catch (e) {
        return errorText(`remove_project_definition failed: ${(e as Error).message}`);
      }
    }
  );
};
