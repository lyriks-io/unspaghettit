import { z } from 'zod';
import { createFeatureUseCase } from '../../src/features/behavior-model/application/use-cases/CreateFeature';
import { deleteFeatureUseCase } from '../../src/features/behavior-model/application/use-cases/DeleteFeature';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { normalizeFeatureEmittedEvents } from '../../src/features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { normalizeFeatureExpressions } from '../../src/features/behavior-model/domain/services/FeatureExpressionNormalizer';
import { normalizeFeatureRuleCategories } from '../../src/features/behavior-model/domain/services/FeatureRuleCategoryNormalizer';
import { normalizeFeatureSharedState } from '../../src/features/behavior-model/domain/services/FeatureSharedStateNormalizer';
import { validateFeature } from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { addTag, normalizeTags, removeTag } from '../../src/shared/domain/Tags';
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
        const candidate = normalizeFeatureSharedState(
          normalizeFeatureRuleCategories(
            normalizeFeatureEmittedEvents(
              normalizeFeatureExpressions(feature as unknown as Feature)
            )
          )
        );
        const validation = validateFeature(candidate);
        if (!validation.valid) {
          return errorText(
            `Feature validation failed:\n - ${validation.errors.join('\n - ')}`
          );
        }
        const next: Feature = { ...candidate, updatedAt: clock() };
        await repo.save(next);
        return text(ack(next.id, next.updatedAt));
      } catch (e) {
        return writeErrorText(e);
      }
    }
  );
};
