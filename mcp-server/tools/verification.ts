import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { detectDrift } from '../../src/features/verification/domain/detectDrift';
import { verifyFeaturesUseCase } from '../../src/features/verification/application/use-cases/VerifyFeatures';
import { fileBehavioralIndexReader } from '../../src/features/verification/infrastructure/persistence/FileBehavioralIndexReader';
import { staticBehavioralIndexReader } from '../../src/features/verification/infrastructure/persistence/StaticBehavioralIndexReader';
import type { BehavioralIndexReader } from '../../src/features/verification/application/ports/BehavioralIndexReader';
import { trackTokens } from '../metrics';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';

/**
 * Read the index from the same `.unspa.json` the CLI bound this repo to. When
 * the repo isn't linked, there is no index, and an empty reader keeps drift /
 * verify working (they just report no implementations to check).
 */
const indexReader = (repoContext: ToolDeps['repoContext']): BehavioralIndexReader =>
  repoContext?.linkPath
    ? fileBehavioralIndexReader({ path: repoContext.linkPath })
    : staticBehavioralIndexReader([]);

/**
 * The cohort to verify: one feature when named, otherwise the linked project's
 * features (so cross-feature cascades resolve), otherwise everything. Mirrors
 * the CLI's `unspa check` scoping so chat and CI verify the same thing.
 */
const resolveCohort = async (deps: ToolDeps, featureId?: string): Promise<Feature[]> => {
  const { repo, projectRepo, repoContext } = deps;

  if (featureId) {
    const id = await expandFeatureId(repo, featureId);
    const feature = await repo.get(asFeatureId(id));
    return feature ? [feature] : [];
  }

  const projectId = repoContext?.link?.projectId;
  const ids = projectId
    ? ((await projectRepo.get(asProjectId(projectId)))?.featureIds ?? null)
    : null;

  const summaries = ids ?? (await repo.list()).map((s) => s.id);
  const out: Feature[] = [];
  for (const id of summaries) {
    const feature = await repo.get(id);
    if (feature) out.push(feature);
  }
  return out;
};

export const registerVerificationTools = (deps: ToolDeps): void => {
  const { server, repo, repoContext } = deps;

  server.registerTool(
    'get_drift',
    {
      description:
        'Spec→code drift: which implementations were audited against an OLDER version of the spec than the one now on disk, so the code may no longer match. Compares each `.unspa.json` entry\'s recorded specVersion against the owning feature\'s current updatedAt. Returns `stale` (re-audit these — the spec changed under them), `unversioned` (audited but never stamped, so drift can\'t be judged), and `orphans` (index keys that no longer resolve to any spec entity — renamed/removed). Scopes to a feature when given, else the linked project, else all. Run after editing a spec whose code you previously mapped, and in CI to block on silent drift.',
      inputSchema: { featureId: z.string().optional() }
    },
    async ({ featureId }) => {
      try {
        const features = await resolveCohort(deps, featureId);
        const entries = await indexReader(repoContext).read();
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
        'Run the whole verification spine and return a gated verdict — the in-chat form of `unspa check`. Per feature: runs every scenario as an executable spec test, scores maturity, analyses surface (navigation) reachability, optionally model-checks the reachable state space, and folds in spec→code drift. Each check is pass / warn / fail; `passed` is true when nothing failed (warnings are advisory — bounded-search caveats, drift, ungated maturity). Defaults fail only on the unambiguous things (a failing scenario, a reachable invariant violation). Use after a build/edit pass to confirm the spec is sound before claiming done.',
      inputSchema: {
        featureId: z.string().optional(),
        modelCheck: z.boolean().optional(),
        maxDepth: z.number().int().positive().optional(),
        maxStates: z.number().int().positive().optional(),
        minMaturity: z.number().int().min(0).max(100).optional(),
        requireScenarios: z.boolean().optional(),
        failOnDrift: z.boolean().optional(),
        failOnUnmetGoals: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const features = await resolveCohort(deps, args.featureId);
        const verify = verifyFeaturesUseCase({ features: repo, index: indexReader(repoContext) });
        const report = await verify({
          featureIds: features.map((f) => f.id),
          thresholds: {
            minMaturity: args.minMaturity ?? 0,
            requireScenarios: args.requireScenarios === true,
            allowDrift: args.failOnDrift !== true,
            failOnUnmetGoals: args.failOnUnmetGoals === true
          },
          modelCheck: args.modelCheck
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
