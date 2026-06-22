import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { exploreStateSpace, type ExplorerOptions } from '$features/simulator/domain/StateExplorer';
import { analyzeSurfaceReachability } from '$features/simulator/domain/SurfaceReachability';
import { aggregateFeatureVerdict } from '../../domain/aggregateVerdict';
import { analyzeEventCoherence } from '../../domain/analyzeEventCoherence';
import { detectDrift } from '../../domain/detectDrift';
import type { VerificationReport } from '../../domain/VerificationReport';
import {
  withThresholdDefaults,
  type VerificationThresholds
} from '../../domain/VerificationThresholds';
import type { BehavioralIndexReader } from '../ports/BehavioralIndexReader';

export type VerifyFeaturesDeps = {
  readonly features: FeatureRepository;
  readonly index: BehavioralIndexReader;
};

export type VerifyFeaturesInput = {
  /**
   * The cohort to verify. Members are treated as siblings of one another, so
   * cross-feature event cascades resolve. Omit to verify every feature the
   * repository holds (the adapter is responsible for scoping to a project
   * before calling, so the cohort is a real project).
   */
  readonly featureIds?: readonly FeatureId[];
  readonly thresholds?: Partial<VerificationThresholds>;
  /**
   * Bounded model checking. Off by default — it explores the state space and is
   * the costly part. `true` runs it with engine defaults; pass options to tune
   * the bound.
   */
  readonly modelCheck?: boolean | ExplorerOptions;
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

    const ids =
      input.featureIds && input.featureIds.length > 0
        ? [...input.featureIds]
        : (await deps.features.list()).map((s) => s.id);

    const loaded: Feature[] = [];
    for (const id of ids) {
      const feature = await deps.features.get(id);
      if (feature) loaded.push(feature);
    }

    const drift = detectDrift(loaded, await deps.index.read());
    const eventCoherence = analyzeEventCoherence(loaded);

    const explorerOptions: ExplorerOptions | null =
      input.modelCheck === true
        ? {}
        : typeof input.modelCheck === 'object'
          ? input.modelCheck
          : null;

    const perFeature = loaded.map((feature) => {
      const siblings = loaded.filter((f) => f.id !== feature.id);
      const scenarios = runScenarios({ feature, projectFeatures: siblings });
      const maturity = scoreFeature(feature);
      const reachability = analyzeSurfaceReachability(feature);
      const exploration =
        explorerOptions !== null ? exploreStateSpace(feature, explorerOptions, siblings) : undefined;
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
        thresholds
      });

      return { scenarios, exploration, verdict };
    });

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
          (acc, p) => acc + (p.exploration?.invariantViolations.length ?? 0),
          0
        )
      }
    };
  };
};
