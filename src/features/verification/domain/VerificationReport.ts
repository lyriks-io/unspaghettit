import { summarizeStale, type DriftReport } from './DriftReport';
import type { EventCoherenceReport } from './EventCoherenceReport';
import type { FeatureVerdict } from './VerificationVerdict';

/**
 * The full result of one verification run over a cohort of features: the
 * per-feature verdicts, the project-wide drift report, and a flat summary for
 * a CI line or a badge. `passed` is the AND of every feature verdict — the
 * single boolean a build gate keys off.
 */
export type VerificationSummary = {
  readonly featuresChecked: number;
  readonly featuresPassed: number;
  readonly featuresFailed: number;
  readonly scenariosRun: number;
  readonly scenariosFailed: number;
  readonly invariantViolations: number;
  /** Set when the solver was wired: how much of the cohort it proved. */
  readonly proof?: ProofSummary;
};

export type ProofSummary = {
  /** Features the solver ran on. */
  readonly proven: number;
  /** Features it did not prove: turned off, or it did not start. */
  readonly notProven: number;
  /** Broken statements it reached on a replayed path from the start. */
  readonly provenViolations: number;
  /** Questions it left unsettled; never counted as flaws. */
  readonly unsettled: number;
  /** Features whose exploration was asked for and not run, the solver having settled everything. */
  readonly explorationsSkipped: number;
};

export type VerificationReport = {
  readonly passed: boolean;
  readonly features: readonly FeatureVerdict[];
  readonly drift: DriftReport;
  readonly eventCoherence: EventCoherenceReport;
  readonly summary: VerificationSummary;
};

/**
 * Fold several per-cohort reports into one. Used when a run spans multiple
 * projects (each verified as its own cohort so cross-feature checks don't bleed
 * across project boundaries) but the caller wants a single aggregate result.
 * `passed` is the AND of every cohort.
 */
export const mergeVerificationReports = (
  reports: readonly VerificationReport[]
): VerificationReport => {
  const features = reports.flatMap((r) => r.features);
  const stale = reports.flatMap((r) => r.drift.stale);
  return {
    passed: reports.every((r) => r.passed),
    features,
    drift: {
      stale,
      unversioned: reports.flatMap((r) => r.drift.unversioned),
      orphans: reports.flatMap((r) => r.drift.orphans),
      checked: reports.reduce((n, r) => n + r.drift.checked, 0),
      outOfScope: reports.reduce((n, r) => n + r.drift.outOfScope, 0),
      // Rebuilt from the merged rows rather than summed per cohort, so the
      // summary can never disagree with the `stale` list it describes.
      summary: summarizeStale(stale)
    },
    eventCoherence: {
      deadHandlers: reports.flatMap((r) => r.eventCoherence.deadHandlers)
    },
    summary: {
      featuresChecked: features.length,
      featuresPassed: features.filter((f) => f.passed).length,
      featuresFailed: features.filter((f) => !f.passed).length,
      scenariosRun: reports.reduce((n, r) => n + r.summary.scenariosRun, 0),
      scenariosFailed: reports.reduce((n, r) => n + r.summary.scenariosFailed, 0),
      invariantViolations: reports.reduce((n, r) => n + r.summary.invariantViolations, 0),
      ...(reports.some((r) => r.summary.proof)
        ? {
            proof: {
              proven: reports.reduce((n, r) => n + (r.summary.proof?.proven ?? 0), 0),
              notProven: reports.reduce((n, r) => n + (r.summary.proof?.notProven ?? 0), 0),
              provenViolations: reports.reduce((n, r) => n + (r.summary.proof?.provenViolations ?? 0), 0),
              unsettled: reports.reduce((n, r) => n + (r.summary.proof?.unsettled ?? 0), 0),
              explorationsSkipped: reports.reduce(
                (n, r) => n + (r.summary.proof?.explorationsSkipped ?? 0),
                0
              )
            }
          }
        : {})
    }
  };
};
