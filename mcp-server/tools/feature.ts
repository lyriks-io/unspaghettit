import { z } from 'zod';
import { createFeatureUseCase } from '../../src/features/behavior-model/application/use-cases/CreateFeature';
import { deleteFeatureUseCase } from '../../src/features/behavior-model/application/use-cases/DeleteFeature';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { normalizeFeatureEmittedEvents } from '../../src/features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { normalizeFeatureExpressions } from '../../src/features/behavior-model/domain/services/FeatureExpressionNormalizer';
import { normalizeFeatureRuleCategories } from '../../src/features/behavior-model/domain/services/FeatureRuleCategoryNormalizer';
import { normalizeFeatureSharedState } from '../../src/features/behavior-model/domain/services/FeatureSharedStateNormalizer';
import { introducedValidationErrors } from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { stampElementVersions } from '../../src/features/behavior-model/domain/services/FeatureElementVersions';
import { addTag, normalizeTags, removeTag } from '../../src/shared/domain/Tags';
import { setCoreTag } from '../../src/shared/domain/coreFeatureTag';
import { ack, errorText, text, writeErrorText, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';

export const registerFeatureTools = (deps: ToolDeps): void => {
  const { server, repo, clock, ids, mutateFeature } = deps;
  const createFeature = createFeatureUseCase({ repository: repo, ids, clock });
  const deleteFeature = deleteFeatureUseCase({ repository: repo });
  const tagsSchema = z
    .array(
      z.object({
        type: z.string().min(1),
        value: z.string().min(1)
      })
    )
    .optional();

  server.registerTool(
    'create_feature',
    {
      description:
        'Create an empty Feature. A Feature is ONE coherent slice of behavior inside a Project, a flow, a screen, a capability, sized so you can hold the whole thing in head (roughly 1–15 surfaces, 30–100 actions). It is NOT a whole product. Model "Add filter to results" as its own Feature, not as part of a giant "Search" Feature. Returns id + timestamps.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().min(1),
        tags: tagsSchema
      }
    },
    async ({ name, description, tags }) => {
      try {
        const exp = await createFeature({ name, description, tags });
        // Return only the id + timestamps; the agent already has the input
        // and can call `get_feature` later if it needs the full payload.
        return text({ ok: true, id: exp.id, createdAt: exp.createdAt, updatedAt: exp.updatedAt });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'delete_feature',
    {
      description: 'Delete a Feature. Idempotent.',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        await deleteFeature(asFeatureId(featureId));
        return text({ ok: true, deletedId: featureId });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  const devContextSchema = z.object({
    mode: z.enum(['auto', 'custom']),
    stack: z.string().optional(),
    conventions: z.array(z.string()).optional(),
    notes: z.string().optional()
  });

  server.registerTool(
    'update_feature',
    {
      description:
        'Patch name/description/devContext. Description is mandatory and cannot be cleared; pass devContext: null to clear dev mode.',
      inputSchema: {
        featureId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        tags: tagsSchema,
        devContext: devContextSchema.nullable().optional()
      }
    },
    async ({ featureId, name, description, tags, devContext }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            name: name !== undefined ? name : current.name,
            description:
              description !== undefined
                ? description
                : current.description,
            tags: tags !== undefined ? normalizeTags(tags) : current.tags,
            devContext:
              devContext === undefined
                ? current.devContext
                : devContext === null
                  ? undefined
                  : devContext
          })
        });
        return text(ack(result.id, result.updatedAt));
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'add_feature_tag',
    {
      description:
        'Append a single tag to a Feature. Idempotent: re-adding the same {type,value} is a no-op. Use this for the common "user clicks + Tag" flow; prefer update_feature when you need to replace the whole tag set at once.',
      inputSchema: {
        featureId: z.string(),
        type: z.string().min(1),
        value: z.string().min(1)
      }
    },
    async ({ featureId, type, value }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            tags: addTag(current.tags, { type, value })
          })
        });
        return text({ ...ack(result.id, result.updatedAt), tags: result.tags ?? [] });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'remove_feature_tag',
    {
      description:
        'Remove a single tag from a Feature, matched by {type,value} case-insensitively. Idempotent: removing a tag that is not present is a no-op.',
      inputSchema: {
        featureId: z.string(),
        type: z.string().min(1),
        value: z.string().min(1)
      }
    },
    async ({ featureId, type, value }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            tags: removeTag(current.tags, { type, value })
          })
        });
        return text({ ...ack(result.id, result.updatedAt), tags: result.tags ?? [] });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'set_feature_core',
    {
      description:
        "Assign a feature to one of its project's declared CORE FEATURES (or clear it with value:null). Sets a reserved `core:<value>` tag, enforcing at-most-one: any existing core: tag is replaced. The value should match a core feature declared on the owning project (declare_core_feature); an undeclared value still saves but shows as a soft warning in the project aggregate. This is the precise way to group a feature under a product pillar — prefer it over add_feature_tag type:'core'.",
      inputSchema: {
        featureId: z.string(),
        value: z
          .string()
          .min(1)
          .nullable()
          .describe('The core-feature value to assign, or null to clear the feature\'s core-feature membership.')
      }
    },
    async ({ featureId, value }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            tags: setCoreTag(current.tags, value)
          })
        });
        return text({ ...ack(result.id, result.updatedAt), tags: result.tags ?? [] });
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'set_expected_actions',
    {
      description:
        'Replace the feature-level list of actions you commit to building. Spec-gap diagnostics flag every entry without a matching Action by name. Pass an empty array to clear.',
      inputSchema: {
        featureId: z.string(),
        expectedActions: z.array(z.string().min(1))
      }
    },
    async ({ featureId, expectedActions }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            expectedActions:
              expectedActions.length > 0 ? expectedActions : undefined
          })
        });
        return text(ack(result.id, result.updatedAt));
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'set_non_goals',
    {
      description:
        'Replace the feature-level scope fence: things the feature deliberately will NOT do. Lets reviewers tell "deliberately out of scope" from "shallow spec". Pass an empty array to clear.',
      inputSchema: {
        featureId: z.string(),
        nonGoals: z.array(z.string().min(1))
      }
    },
    async ({ featureId, nonGoals }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const result = await mutateFeature({
          featureId: asFeatureId(featureId),
          transform: (current) => ({
            ...current,
            nonGoals: nonGoals.length > 0 ? nonGoals : undefined
          })
        });
        return text(ack(result.id, result.updatedAt));
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );

  server.registerTool(
    'save_feature',
    {
      description: 'Escape hatch. Replace whole Feature JSON. Validated before save. Prefer apply_batch for multi-op edits.',
      inputSchema: { feature: z.record(z.string(), z.unknown()) }
    },
    async ({ feature }) => {
      try {
        const normalize = (f: Feature): Feature =>
          normalizeFeatureSharedState(
            normalizeFeatureRuleCategories(
              normalizeFeatureEmittedEvents(normalizeFeatureExpressions(f))
            )
          );
        const candidate = normalize(feature as unknown as Feature);
        // Diff-aware: a full-replace save is blocked only when it INTRODUCES a
        // new error versus the current snapshot. Replacing an existing (maybe
        // legacy / partially-built) feature can't be held hostage by an issue
        // it already had; a brand-new feature (no prior) must be fully valid.
        const prior = candidate.id ? await repo.get(asFeatureId(String(candidate.id))) : null;
        const introduced = introducedValidationErrors(
          prior ? normalize(prior) : null,
          candidate
        );
        if (introduced.length > 0) {
          return errorText(
            `Save would introduce new validation errors (pre-existing issues are not blocking):\n - ${introduced.join('\n - ')}`
          );
        }
        const now = clock();
        const next: Feature = stampElementVersions(prior, { ...candidate, updatedAt: now }, now);
        await repo.save(next);
        return text(ack(next.id, next.updatedAt));
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );
};
