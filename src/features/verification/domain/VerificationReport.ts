import type { DriftReport } from './DriftReport';
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
};

export type VerificationReport = {
  readonly passed: boolean;
  readonly features: readonly FeatureVerdict[];
  readonly drift: DriftReport;
  readonly eventCoherence: EventCoherenceReport;
  readonly summary: VerificationSummary;
};
