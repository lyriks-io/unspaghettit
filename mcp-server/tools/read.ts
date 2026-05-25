import { z } from 'zod';
import type { ParameterValues } from '../../src/features/behavior-model/domain/services/ParameterValidator';
import type { StateSnapshot } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { runScenariosUseCase } from '../../src/features/simulator/application/use-cases/RunScenarios';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  ALL_NEIGHBORHOOD_EDGE_KINDS,
  dryRunSimulateTool,
  findStateReferencesTool,
  getActionsTool,
  getActionTool,
  getFeatureIndexTool,
  getNeighborhoodTool,
  getSurfaceTool,
  listActionsTool,
  listFeatureIdsTool,
  listFeaturesTool,
  scoreFeatureTool,
  type NeighborhoodEdgeKind
} from '../../src/features/mcp-tools/application/tools';
import { trackTokens } from '../metrics';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '../../src/features/behavior-model/application/ports/FeatureRepository';
import type { ProjectRepository } from '../../src/features/projects/application/ports/ProjectRepository';
import { errorText, text, type ToolDeps } from './_shared';
import { runGenerateTypes } from './_codegen';
import {
  expandFeatureId,
  expandIdInFeature,
  expandProjectId
} from './short-ids';

/**
 * Load sibling features (same project as `focalFeatureId`) so the simulator
 * can cascade events across feature boundaries. Returns `undefined` when no
 * project contains the feature, caller treats that as "single-feature mode."
 * Failures inside individual fetches are swallowed; missing siblings just
 * mean fewer handlers fire, not a hard error.
 */
const loadProjectSiblings = async (
  repo: FeatureRepository,
  projectRepo: ProjectRepository,
  focalFeatureId: string
): Promise<readonly Feature[] | undefined> => {
  const projects = await projectRepo.list();
  for (const summary of projects) {
    const project = await projectRepo.get(summary.id);
    if (!project) continue;
    const ids = project.featureIds.map(String);
    if (!ids.includes(focalFeatureId)) continue;
    const siblings = await Promise.all(
      ids
        .filter((id) => id !== focalFeatureId)
        .map((id) => repo.get(asFeatureId(id)))
    );
    return siblings.filter((f): f is Feature => f !== null);
  }
  return undefined;
};

export const registerReadTools = ({
  server,
  repo,
  projectRepo,
  repoContext
}: ToolDeps): void => {
  server.registerTool(
    'list_features',
    {
      description:
        'Compact summaries (id, name, counts). Cheapest discovery call. Pass `projectId` to narrow to one project\'s featureIds, answers "what\'s in this project" without an extra get_project call.',
      inputSchema: { projectId: z.string().optional() }
    },
    async ({ projectId }) => {
      const summaries = await repo.list();
      if (!projectId) {
        return text(trackTokens('list_features', listFeaturesTool(summaries)));
      }
      try {
        projectId = await expandProjectId(projectRepo, projectId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const project = await projectRepo.get(asProjectId(projectId));
      if (!project) return errorText(`Project ${projectId} not found`);
      const allowed = new Set(project.featureIds.map((id) => String(id)));
      const filtered = summaries.filter((s) => allowed.has(String(s.id)));
      return text(trackTokens('list_features.byProject', listFeaturesTool(filtered)));
    }
  );

  server.registerTool(
    'get_feature',
    {
      description:
        'Index by default (ids, names, counts, devContext). Drill down with get_action. Pass verbose:true ONLY when you genuinely need the full blob; it is ~10× larger.',
      inputSchema: {
        featureId: z.string(),
        verbose: z.boolean().optional()
      }
    },
    async ({ featureId, verbose }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      if (verbose) return text(trackTokens('get_feature.verbose', exp));
      return text(trackTokens('get_feature', getFeatureIndexTool(exp)));
    }
  );

  server.registerTool(
    'list_feature_ids',
    {
      description:
        'Compact id catalog for one feature: every surface, action, state, rule, invariant, effect, transition, parameter, scenario, event, persona, resource, and entity flattened with human-readable context (surface name, action name) so the LLM can look up an id by what it knows. Cheaper than get_feature(verbose:true) by ~5×. Use after an apply_batch when you need ids from THAT batch in a NEXT batch (refs only resolve within a single batch).',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      return text(trackTokens('list_feature_ids', listFeatureIdsTool(exp)));
    }
  );

  server.registerTool(
    'list_actions',
    {
      description: 'List actions (optionally filter by surface). Returns id, name, intent, counts.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string().optional()
      }
    },
    async ({ featureId, surfaceId }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      if (surfaceId) {
        try {
          surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
        } catch (e) {
          return errorText((e as Error).message);
        }
      }
      return text(
        
          trackTokens(
            'list_actions',
            listActionsTool(exp, surfaceId ? asSurfaceId(surfaceId) : undefined)
          )
        
      );
    }
  );

  server.registerTool(
    'get_action',
    {
      description:
        'One action + its rules, parameters, linked state defs, enclosing invariants. When the feature has a devContext, also returns implementation guidance + tag spec. Preferred over get_feature for single-action work. For bulk fetches, pass `actionIds: [...]` instead of `actionId`. The response then returns each action with the shared state-def / invariant / devContext blocks pulled to the top level and deduped, so fetching N actions on one surface costs roughly one action\'s worth of metadata instead of N×.',
      inputSchema: {
        featureId: z.string(),
        actionId: z.string().optional(),
        actionIds: z.array(z.string()).optional()
      }
    },
    async ({ featureId, actionId, actionIds }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      if (actionId && actionIds) {
        return errorText('Pass exactly one of actionId or actionIds, not both.');
      }
      if (actionIds) {
        if (actionIds.length === 0) {
          return errorText('actionIds must contain at least one id.');
        }
        try {
          actionIds = actionIds.map((id) => expandIdInFeature(exp, id, 'actionId'));
        } catch (e) {
          return errorText((e as Error).message);
        }
        const bulk = getActionsTool(
          exp,
          actionIds.map((id) => asActionId(id))
        );
        return text(trackTokens('get_action.bulk', bulk));
      }
      if (!actionId) {
        return errorText('Pass either actionId or actionIds.');
      }
      try {
        actionId = expandIdInFeature(exp, actionId, 'actionId');
      } catch (e) {
        return errorText((e as Error).message);
      }
      const focused = getActionTool(exp, asActionId(actionId));
      if (!focused)
        return errorText(`Action ${actionId} not found in feature ${featureId}`);
      return text(trackTokens('get_action', focused));
    }
  );

  server.registerTool(
    'find_state_references',
    {
      description: 'Count refs to a state path across rules, effects, invariants, requiredStates, parameter bindings. Run before editing/removing state.',
      inputSchema: {
        featureId: z.string(),
        statePath: z.string()
      }
    },
    async ({ featureId, statePath }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      let path;
      try {
        path = asStatePath(statePath);
      } catch (e) {
        return errorText(`Invalid state path: ${(e as Error).message}`);
      }
      return text(trackTokens('find_state_references', findStateReferencesTool(exp, path)));
    }
  );

  server.registerTool(
    'dry_run_simulate',
    {
      description: 'Run the deterministic simulator on an action (pure, no persist). Use to validate proposed changes before committing.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        snapshot: z.record(z.string(), z.unknown()).optional(),
        parameters: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ featureId, surfaceId, actionId, snapshot, parameters }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      try {
        surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
        actionId = expandIdInFeature(exp, actionId, 'actionId');
      } catch (e) {
        return errorText((e as Error).message);
      }
      // Project siblings let the cascade reach handlers declared outside the
      // focal feature. Loading them is best-effort: a feature that doesn't
      // belong to any project simulates as before (single-feature scope).
      const projectFeatures = await loadProjectSiblings(repo, projectRepo, featureId);
      try {
        const result = dryRunSimulateTool({
          feature: exp,
          surfaceId: asSurfaceId(surfaceId),
          actionId: asActionId(actionId),
          snapshot: (snapshot ?? {}) as StateSnapshot,
          parameters: (parameters ?? {}) as ParameterValues,
          ...(projectFeatures ? { projectFeatures } : {})
        });
        return text(trackTokens('dry_run_simulate', result));
      } catch (e) {
        return errorText(`Simulation failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'score_feature',
    {
      description:
        'Maturity score for the feature. Always returns a compact summary (score, maxScore, percentage, issue counts, top failing areas, worst surfaces). Under ~1 KB. Pass `includeIssues:true` to append the per-issue array (skip the passed-check list, which is never useful and inflates payloads ~8×). Filters `surfaceId`, `area`, `severity` scope BOTH the counts and the appended issues so drill-down stays under 10 KB.',
      inputSchema: {
        featureId: z.string(),
        includeIssues: z.boolean().optional(),
        surfaceId: z.string().optional(),
        area: z.string().optional(),
        severity: z.enum(['critical', 'recommended']).optional()
      }
    },
    async ({ featureId, includeIssues, surfaceId, area, severity }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      if (surfaceId) {
        try {
          surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
        } catch (e) {
          return errorText((e as Error).message);
        }
      }
      const output = scoreFeatureTool(exp, {
        includeIssues,
        surfaceId,
        area,
        severity
      });
      const trackKey = includeIssues ? 'score_feature.withIssues' : 'score_feature';
      return text(trackTokens(trackKey, output));
    }
  );

  server.registerTool(
    'get_surface',
    {
      description:
        'Fetch one Surface with all its actions, state defs, rules, invariants, and transitions inline. Use when you need surface internals without paying for get_feature(verbose:true). Default is the compact index (counts + action summaries). Pass verbose:true for the full nested entity tree.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        verbose: z.boolean().optional()
      }
    },
    async ({ featureId, surfaceId, verbose }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      try {
        surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
      } catch (e) {
        return errorText((e as Error).message);
      }
      const result = getSurfaceTool(exp, asSurfaceId(surfaceId), verbose === true);
      if (!result) return errorText(`Surface ${surfaceId} not found in feature ${featureId}`);
      const trackKey = verbose ? 'get_surface.verbose' : 'get_surface';
      return text(trackTokens(trackKey, result));
    }
  );

  server.registerTool(
    'get_neighborhood',
    {
      description:
        'Slice the feature graph around a single entity. Walks `depth` hops outward from a root action/surface/state/event/feature and returns every reached node plus the edges between them. Use to answer "what touches this?" in one call instead of fanning out 3-5 get_action / find_state_references round-trips. `rootKey` format: action:<id> | surface:<id> | state:<dotted.path> | event:<name> | feature:<id>. `edgeKinds` optionally filters to a subset of [reads, writes, emits, transitions, contains]; omit to include all kinds. `depth` is clamped to [1, 3]; default 1.',
      inputSchema: {
        featureId: z.string(),
        rootKey: z.string().min(1),
        depth: z.number().int().optional(),
        edgeKinds: z
          .array(z.enum(ALL_NEIGHBORHOOD_EDGE_KINDS as readonly [string, ...string[]]))
          .optional()
      }
    },
    async ({ featureId, rootKey, depth, edgeKinds }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      // rootKey is "<kind>:<id>" (e.g. "action:abc-123"). Only the id half
      // is short-id eligible; the kind prefix stays literal.
      const colon = rootKey.indexOf(':');
      if (colon > 0) {
        const kind = rootKey.slice(0, colon);
        const idPart = rootKey.slice(colon + 1);
        // state:* keys are paths, not uuids, skip expansion.
        if (kind !== 'state' && kind !== 'event') {
          try {
            const expandedId = expandIdInFeature(exp, idPart, `${kind}Id`);
            rootKey = `${kind}:${expandedId}`;
          } catch (e) {
            return errorText((e as Error).message);
          }
        }
      }
      const clampedDepth = Math.max(1, Math.min(3, depth ?? 1));
      const kinds = (edgeKinds as readonly NeighborhoodEdgeKind[] | undefined) ?? ALL_NEIGHBORHOOD_EDGE_KINDS;
      const result = getNeighborhoodTool(exp, rootKey, clampedDepth, kinds);
      if (!result) return errorText(`Root entity ${rootKey} not found in feature ${featureId}`);
      return text(trackTokens('get_neighborhood', result));
    }
  );

  server.registerTool(
    'generate_types',
    {
      description:
        'Codegen a TypeScript module that mirrors the feature\'s enum state types, state-path → value-type map, action parameter shapes, and event names. Writes to disk at `outputPath` (relative to the repo root containing .unspa.json; absolute paths also accepted). The chosen path is persisted to `.unspa.json` so apply_batch can auto-regenerate after every subsequent spec mutation, implementation code stays in lockstep with the spec without the LLM having to call this tool manually. Implementation code imports from the generated file so adding an enum value or renaming an event triggers TS exhaustiveness errors.',
      inputSchema: {
        featureId: z.string(),
        outputPath: z.string().min(1)
      }
    },
    async ({ featureId, outputPath }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      try {
        const { outputPath: targetPath, stats } = runGenerateTypes(exp, repoContext, outputPath);
        return text(
          trackTokens('generate_types', { ok: true, outputPath: targetPath, stats })
        );
      } catch (e) {
        return errorText(`generate_types failed: ${(e as Error).message}`);
      }
    }
  );

  const runScenarios = runScenariosUseCase();
  server.registerTool(
    'run_all_scenarios',
    {
      description:
        'Execute every Scenario (optionally filtered to one surface or action) through the deterministic simulator and assert each one against its expectedStatus + expectedAssertions[]. If a scenario has personaId, that persona baseline is applied before scenario overrides. Turns scenarios from documentation into a CI-grade spec test. Returns per-scenario pass/fail with failed assertion details. Scenarios without expected outcomes still run (they just always pass status, with an empty assertion list).',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string().optional(),
        actionId: z.string().optional()
      }
    },
    async ({ featureId, surfaceId, actionId }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      try {
        if (surfaceId) surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
        if (actionId) actionId = expandIdInFeature(exp, actionId, 'actionId');
      } catch (e) {
        return errorText((e as Error).message);
      }
      const projectFeatures = await loadProjectSiblings(repo, projectRepo, featureId);
      try {
        const output = runScenarios({
          feature: exp,
          ...(surfaceId ? { surfaceId: asSurfaceId(surfaceId) } : {}),
          ...(actionId ? { actionId: asActionId(actionId) } : {}),
          ...(projectFeatures ? { projectFeatures } : {})
        });
        return text(trackTokens('run_all_scenarios', output));
      } catch (e) {
        return errorText(`run_all_scenarios failed: ${(e as Error).message}`);
      }
    }
  );
};
