import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import {
  exploreStateSpace,
  type ExplorationReport,
  type ExplorerOptions
} from '$features/simulator/domain/StateExplorer';
import type { ProofContext, VerdictProof } from '$features/prover/ProverPort';
import { statesReadBy } from '$features/behavior-model/domain/services/conditionReads';
import type { FeatureVerdict } from '../../domain/VerificationVerdict';
import { analyzeSurfaceReachability } from '$features/simulator/domain/SurfaceReachability';
import { aggregateFeatureVerdict } from '../../domain/aggregateVerdict';
import { analyzeEventCoherence } from '../../domain/analyzeEventCoherence';
import { detectDrift } from '../../domain/detectDrift';
import { verifiedCoverageForFeature } from '../../domain/verifiedCoverage';
import type { VerificationReport } from '../../domain/VerificationReport';
import {
  withThresholdDefaults,
  type VerificationThresholds
} from '../../domain/VerificationThresholds';
import type { BehavioralIndexReader } from '../ports/BehavioralIndexReader';
import {
  listAllFeatures,
  loadFeaturesByIds
} from '$features/behavior-model/application/services/bulkRead';

/** How the use case asks the proof module: the adapter wires the loaded one. */
export type ProveFeaturePort = (feature: Feature, context: ProofContext) => Promise<VerdictProof>;

export type VerifyFeaturesDeps = {
  readonly features: FeatureRepository;
  readonly index: BehavioralIndexReader;
  /**
   * The proof module. Without it the verdict says nothing about proofs (an
   * engine with no proof module); with it every feature is proven before it is
   * judged.
   */
  readonly prove?: ProveFeaturePort;
};

/** How an adapter names the features that may own index keys outside the cohort. */
export type DriftOwnership = readonly FeatureId[] | 'all';

/**
 * Load the features a `DriftOwnership` names, in one store pass. Shared with
 * the `get_drift` tool so a scoped sweep resolves ownership the same way
 * whether it runs alone or inside `verify`.
 */
export const loadDriftOwnership = async (
  repo: FeatureRepository,
  ownership: DriftOwnership | undefined
): Promise<readonly Feature[] | undefined> => {
  if (ownership === undefined) return undefined;
  const loaded =
    ownership === 'all' ? await listAllFeatures(repo) : await loadFeaturesByIds(repo, ownership);
  return loaded.filter((feature): feature is Feature => feature !== null);
};

export type VerifyFeaturesInput = {
  /**
   * The cohort to verify. Members are treated as siblings of one another, so
   * cross-feature event cascades resolve. Omit to verify every feature the
   * repository holds (the adapter is responsible for scoping to a project
   * before calling, so the cohort is a real project).
   */
  readonly featureIds?: readonly FeatureId[];
  /**
   * Cross-feature project invariants enforced during model checking: each is
   * checked at every explored state of every feature, over a snapshot seeded
   * with the other features' defaults. Violations ride the feature's
   * invariantViolations channel. Only meaningful when `modelCheck` is on.
   */
  readonly projectInvariants?: readonly Invariant[];
  /**
   * Features consulted for index-key OWNERSHIP when the cohort is narrower than
   * the index it is judged against (one feature of a project whose index maps
   * all of them): the owning project's feature ids, or `'all'` for a feature no
   * project claims. A key owned by one of them is out of scope for drift rather
   * than an orphan. Omit when the cohort is the whole project. The adapter
   * resolves it because this use case has no project repository.
   */
  readonly driftOwnership?: DriftOwnership;
  readonly thresholds?: Partial<VerificationThresholds>;
  /**
   * Bounded model checking. Off by default — it explores the state space and is
   * the costly part. `true` runs it with engine defaults; pass options to tune
   * the bound.
   */
  readonly modelCheck?: boolean | ExplorerOptions;
  /**
   * Ask the solver (default true when the adapter wires one). `false` turns it
   * off for this run, and each verdict then says nothing was proven.
   */
  readonly prove?: boolean;
  /**
   * The whole project the cohort belongs to, when the cohort is narrower (one
   * feature): the solver's paths may play the other features' actions. Defaults
   * to the cohort.
   */
  readonly projectFeatures?: readonly Feature[];
};

/**
 * The verification spine as one composable use case: load the cohort, detect
 * spec→code drift across it once, then for each feature run the scenario suite,
 * score maturity, analyze navigation reachability, optionally model-check the
 * state space, and fold it all into a gated verdict.
 *
 * Pure orchestration — it composes deterministic domain functions and returns
 * data. No console, no process exit, no clock: the driving adapters (CLI / MCP)
 * own presentation and the exit code, which keeps this testable with fakes.
 */
export const verifyFeaturesUseCase = (deps: VerifyFeaturesDeps) => {
  const runScenarios = runScenariosUseCase();

  return async (input: VerifyFeaturesInput = {}): Promise<VerificationReport> => {
    const thresholds = withThresholdDefaults(input.thresholds);

    // One store pass either way: a `get` per id re-read a folder store whole.
    const loaded = (
      input.featureIds && input.featureIds.length > 0
        ? await loadFeaturesByIds(deps.features, input.featureIds)
        : await listAllFeatures(deps.features)
    ).filter((feature): feature is Feature => feature !== null);

    const ownershipUniverse = await loadDriftOwnership(deps.features, input.driftOwnership);

    const indexEntries = await deps.index.read();
    const drift = detectDrift(loaded, indexEntries, ownershipUniverse);
    const eventCoherence = analyzeEventCoherence(loaded);

    const explorerOptions: ExplorerOptions | null =
      input.modelCheck === true
        ? {}
        : typeof input.modelCheck === 'object'
          ? input.modelCheck
          : null;

    const projectInvariants = input.projectInvariants ?? [];

    const projectFeatures = input.projectFeatures ?? loaded;
    const projectRuleReads = new Set(projectInvariants.flatMap((i) => statesReadBy(i.condition)));
    const proving = deps.prove !== undefined && input.prove !== false;

    // One feature at a time: the solver runs in its own process, one proof at a time.
    const perFeature: {
      scenarios: ReturnType<typeof runScenarios>;
      exploration: ExplorationReport | undefined;
      proof: VerdictProof | undefined;
      verdict: FeatureVerdict;
    }[] = [];
    for (const feature of loaded) {
      const siblings = loaded.filter((f) => f.id !== feature.id);
      // The exploration starts from the cohort's state plus the PROJECT state
      // the project rules read: verified alone, a feature was explored without
      // the other features' starting state, and every project rule on a state
      // they own read as broken at the first step. Only the read states ride
      // along: the whole project's state in every explored state ran out of
      // memory on a large feature.
      const seedStateDefs = [
        ...siblings.flatMap((f) => f.surfaces.flatMap((s) => s.stateDefinitions)),
        ...projectFeatures
          .filter((f) => f.id !== feature.id && !siblings.some((g) => g.id === f.id))
          .flatMap((f) => f.surfaces.flatMap((s) => s.stateDefinitions))
          .filter((d) => projectRuleReads.has(String(d.path)))
      ];
      // The scenarios hold the project's invariants like every other engine,
      // over the state of every other feature of the project.
      const scenarios = runScenarios({
        feature,
        projectFeatures: projectFeatures.filter((f) => f.id !== feature.id),
        ...(projectInvariants.length > 0 ? { projectInvariants } : {})
      });
      const maturity = scoreFeature(feature);
      const reachability = analyzeSurfaceReachability(feature);
      const proof = proving
        ? await deps.prove!(feature, {
            projectFeatures,
            ...(projectInvariants.length > 0 ? { projectInvariants } : {}),
            ...(explorerOptions?.maxDepth !== undefined ? { maxSteps: explorerOptions.maxDepth } : {})
          })
        : undefined;
      // The exploration keeps only what the solver leaves open.
      const plan = explorerOptions !== null && proof ? proof.explorationPlan : null;
      // The exploration tries the inputs the solver chose first.
      const witnessed = proof?.witnessedInputs ?? new Map();
      const exploration =
        explorerOptions !== null && (plan === null || plan.run)
          ? exploreStateSpace(
              feature,
              {
                ...explorerOptions,
                ...(witnessed.size > 0 ? { witnessedInputs: witnessed } : {}),
                ...(projectInvariants.length > 0
                  ? {
                      extraInvariants: projectInvariants,
                      seedStateDefs
                    }
                  : {})
              },
              siblings
            )
          : undefined;
      const featureDrift = drift.stale.filter((d) => d.featureId === String(feature.id));
      const featureDeadHandlers = eventCoherence.deadHandlers.filter(
        (h) => h.featureId === String(feature.id)
      );

      const verdict = aggregateFeatureVerdict({
        featureId: String(feature.id),
        featureName: feature.name,
        scenarios,
        maturity,
        reachability,
        ...(exploration ? { exploration } : {}),
        drift: featureDrift,
        deadHandlers: featureDeadHandlers,
        verifiedCoverage: verifiedCoverageForFeature(feature, indexEntries),
        thresholds,
        ...(proving ? { proof } : deps.prove !== undefined ? { proof: null } : {}),
        ...(plan && !plan.run ? { explorationSkipped: plan } : {})
      });

      perFeature.push({ scenarios, exploration, proof, verdict });
    }

    const verdicts = perFeature.map((p) => p.verdict);

    return {
      passed: verdicts.every((v) => v.passed),
      features: verdicts,
      drift,
      eventCoherence,
      summary: {
        featuresChecked: verdicts.length,
        featuresPassed: verdicts.filter((v) => v.passed).length,
        featuresFailed: verdicts.filter((v) => !v.passed).length,
        scenariosRun: perFeature.reduce((acc, p) => acc + p.scenarios.total, 0),
        scenariosFailed: perFeature.reduce((acc, p) => acc + p.scenarios.failed, 0),
        invariantViolations: perFeature.reduce(
          (acc, p) =>
            acc +
            (p.verdict.checks.find((check) => check.id === 'invariants')?.traces?.length ?? 0),
          0
        ),
        ...(deps.prove !== undefined
          ? {
              proof: {
                proven: perFeature.filter((p) => p.proof?.ran === true).length,
                notProven: perFeature.filter((p) => p.proof?.ran !== true).length,
                provenViolations: perFeature.reduce((acc, p) => acc + (p.proof?.provenViolations ?? 0), 0),
                unsettled: perFeature.reduce((acc, p) => acc + (p.proof?.unsettled ?? 0), 0),
                explorationsSkipped: perFeature.filter(
                  (p) => p.proof !== undefined && p.exploration === undefined && explorerOptions !== null
                ).length
              }
            }
          : {})
      }
    };
  };
};
