/**
 * The gate configuration: which findings should FAIL verification (non-zero
 * exit in CI) versus merely warn. Defaults are conservative — they fail only on
 * the things that are unambiguously wrong (a scenario that doesn't hold, a
 * reachable invariant violation) and warn on the things that are advisory
 * within a bounded search (dead actions, deadlocks, drift, low maturity).
 */
export type VerificationThresholds = {
  /** Minimum maturity percentage required. `0` disables the gate (report only). */
  readonly minMaturity: number;
  /** Scenario failures tolerated before failing. `0` = every scenario must pass. */
  readonly maxScenarioFailures: number;
  /** When false, any reachable invariant counterexample fails verification. */
  readonly allowInvariantViolations: boolean;
  /**
   * When true, an action never observed firing within the model-check bound
   * fails verification. Off by default: "not fired within N steps" is not a
   * proof of deadness, so it warns rather than fails unless opted in.
   */
  readonly failOnDeadActions: boolean;
  /** When false, stale implementation entries fail verification. Default true → warn only. */
  readonly allowDrift: boolean;
  /** When true, a feature with zero scenarios fails verification. */
  readonly requireScenarios: boolean;
  /**
   * Minimum % of a feature's actions that must be VERIFIED (scenarios proven to
   * pass against the real code, via `unspa coverage ingest`). `0` disables the
   * gate (report only).
   */
  readonly minVerified: number;
  /**
   * When true, an unmet reachability/liveness goal fails verification. Off by
   * default: like dead actions, "not reached within bounds" is not a proof, so
   * it warns unless opted in.
   */
  readonly failOnUnmetGoals: boolean;
};

export const defaultThresholds = (): VerificationThresholds => ({
  minMaturity: 0,
  maxScenarioFailures: 0,
  allowInvariantViolations: false,
  failOnDeadActions: false,
  allowDrift: true,
  requireScenarios: false,
  failOnUnmetGoals: false,
  minVerified: 0
});

export const withThresholdDefaults = (
  partial: Partial<VerificationThresholds> = {}
): VerificationThresholds => ({ ...defaultThresholds(), ...partial });
