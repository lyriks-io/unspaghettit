import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { detectDrift } from '../../src/features/verification/domain/detectDrift';
import { verifyFeaturesUseCase } from '../../src/features/verification/application/use-cases/VerifyFeatures';
import { fileBehavioralIndexReader } from '../../src/features/verification/infrastructure/persistence/FileBehavioralIndexReader';
import {
  inlineBehavioralIndexReader,
  staticBehavioralIndexReader
} from '../../src/features/verification/infrastructure/persistence/StaticBehavioralIndexReader';
import type { BehavioralIndexReader } from '../../src/features/verification/application/ports/BehavioralIndexReader';
import { strictThresholds } from '../../src/features/verification/domain/VerificationThresholds';
import { trackTokens } from '../metrics';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';

/**
 * Read the index from the same `.unspa.json` the CLI bound this repo to. When
 * the repo isn't linked, there is no index, and an empty reader keeps drift /
 * verify working (they just report no implementations to check).
 */
const indexReader = (
  repoContext: ToolDeps['repoContext'],
  inlineIndex?: Record<string, unknown>
): BehavioralIndexReader => {
  if (inlineIndex) return inlineBehavioralIndexReader(inlineIndex);
  return repoContext?.linkPath
    ? fileBehavioralIndexReader({ path: repoContext.linkPath })
    : staticBehavioralIndexReader([]);
};

/**
 * The cohort to verify plus the owning project's cross-feature invariants: one
 * feature when named, otherwise the linked project's features (so cross-feature
 * cascades + project invariants resolve), otherwise everything. Mirrors the
 * CLI's `unspa check` scoping so chat and CI verify the same thing.
 */
const resolveCohort = async (
  deps: ToolDeps,
  featureId?: string,
  explicitProjectId?: string
): Promise<{ features: Feature[]; projectInvariants: readonly Invariant[] }> => {
  const { repo, projectRepo, repoContext } = deps;

  if (featureId) {
    const id = await expandFeatureId(repo, featureId);
    const feature = await repo.get(asFeatureId(id));
    let projectInvariants: readonly Invariant[] = [];
    if (feature) {
      for (const summary of await projectRepo.list()) {
        const project = await projectRepo.get(summary.id);
        if (project?.featureIds.some((f) => String(f) === String(feature.id))) {
          projectInvariants = project.projectInvariants ?? [];
          break;
        }
      }
    }
    return { features: feature ? [feature] : [], projectInvariants };
  }

  // An explicit projectId is what a host passes when there is no `.unspa.json`
  // to read one from. It is also a SCOPE: without either, the fallback below
  // walks every feature in the store, which for a multi-project host means one
  // project's answer quietly includes another's.
  const projectId = explicitProjectId ?? repoContext?.link?.projectId;
  const project = projectId ? await projectRepo.get(asProjectId(projectId)) : null;
  const ids = project?.featureIds ?? null;

  const summaries = ids ?? (await repo.list()).map((s) => s.id);
  const out: Feature[] = [];
  for (const id of summaries) {
    const feature = await repo.get(id);
    if (feature) out.push(feature);
  }
  return { features: out, projectInvariants: project?.projectInvariants ?? [] };
};

export const registerVerificationTools = (deps: ToolDeps): void => {
  const { server, repo, repoContext } = deps;

  server.registerTool(
    'get_drift',
    {
      description:
        'Spec→code drift: which implementations were audited against an OLDER version of the spec than the one now on disk, so the code may no longer match. Compares each `.unspa.json` entry\'s recorded specVersion against the CURRENT version of the exact element it maps, falling back to the owning feature\'s current updatedAt. Returns `stale` (re-audit these — the spec changed under them), `unversioned` (audited but never stamped, so drift can\'t be judged), and `orphans` (index keys that no longer resolve to any spec entity — renamed/removed). Every stale row carries `scope`: "element" means THIS entity changed after the audit, so the row names real evidence; "feature" means only the feature-wide stamp was available (a snapshot written before per-element stamps), so the row is suspect by association and every audited entity of that feature is implicated. Scopes to a feature when given, else the linked project, else all. Run after editing a spec whose code you previously mapped, and in CI to block on silent drift.',
      inputSchema: {
        featureId: z.string().optional(),
        index: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Behavioral index to judge drift against, INSTEAD of reading .unspa.json from disk. Pass this when the server has no access to the checkout.'
          ),
        projectId: z
          .string()
          .optional()
          .describe(
            'Scope the whole-project sweep to this project, when there is no .unspa.json to read the scope from. Without it (and without featureId) the sweep covers every feature the server can see.'
          )
      }
    },
    async ({ featureId, index, projectId }) => {
      try {
        const { features } = await resolveCohort(deps, featureId, projectId);
        const entries = await indexReader(repoContext, index).read();
        return text(trackTokens('get_drift', detectDrift(features, entries)));
      } catch (e) {
        return errorText(`get_drift failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'verify',
    {
      description:
        'Run the whole verification spine and return a gated verdict — the in-chat form of `unspa check`. Per feature: runs every scenario as an executable spec test, scores maturity, analyses surface (navigation) reachability, optionally model-checks the reachable state space, and folds in spec→code drift. Each check is pass / warn / fail; `passed` is true when nothing failed (warnings are advisory — bounded-search caveats, drift, ungated maturity). Defaults fail only on the unambiguous things (a failing scenario, a reachable invariant violation). Every feature verdict also carries `scenarios[]`: one machine-readable row per AUTHORED scenario (scenarioId, name, surfaceId/actionId, passed, expected vs actual status, assertion counts, firstFailingStep + its action, and a one-line reason) — passing rows included, so you can trace an acceptance criterion to the scenario that exercises it and to its result without parsing prose. Use after a build/edit pass to confirm the spec is sound before claiming done.',
      inputSchema: {
        featureId: z.string().optional(),
        strict: z.boolean().optional(),
        modelCheck: z.boolean().optional(),
        maxDepth: z.number().int().positive().optional(),
        maxStates: z.number().int().positive().optional(),
        minMaturity: z.number().int().min(0).max(100).optional(),
        minVerified: z.number().int().min(0).max(100).optional(),
        requireScenarios: z.boolean().optional(),
        failOnDrift: z.boolean().optional(),
        failOnUnmetGoals: z.boolean().optional(),
        failOnSkippedActions: z.boolean().optional(),
        failOnTruncatedExploration: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const { features, projectInvariants } = await resolveCohort(deps, args.featureId);
        const verify = verifyFeaturesUseCase({ features: repo, index: indexReader(repoContext) });
        const report = await verify({
          featureIds: features.map((f) => f.id),
          projectInvariants,
          thresholds: {
            ...(args.strict ? strictThresholds() : {}),
            minMaturity: args.minMaturity ?? (args.strict ? 100 : 0),
            minVerified: args.minVerified ?? (args.strict ? 100 : 0),
            requireScenarios: args.strict || args.requireScenarios === true,
            allowDrift: !(args.strict || args.failOnDrift === true),
            failOnUnmetGoals: args.strict || args.failOnUnmetGoals === true,
            failOnSkippedActions: args.strict || args.failOnSkippedActions === true,
            failOnTruncatedExploration: args.strict || args.failOnTruncatedExploration === true,
            failOnDeadActions: args.strict === true
          },
          modelCheck: args.modelCheck || args.strict
            ? {
                ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
                ...(args.maxStates !== undefined ? { maxStates: args.maxStates } : {})
              }
            : false
        });
        return text(trackTokens('verify', report));
      } catch (e) {
        return errorText(`verify failed: ${(e as Error).message}`);
      }
    }
  );
};
