/**
 * The outcome of verifying a feature: a list of named checks, each pass / warn /
 * fail, plus the rolled-up `passed` (no check failed). A warn never sinks the
 * verdict — it surfaces an advisory finding (bounded-search caveat, drift,
 * low-but-ungated maturity) without breaking the build.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';

export type VerdictCheck = {
  /** Stable machine id: scenarios | invariants | maturity | reachability | dead-actions | deadlocks | drift | bounds. */
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Supporting lines: failing scenario names, counterexample paths, drifted keys, … */
  readonly items?: readonly string[];
};

export type FeatureVerdict = {
  readonly featureId: string;
  readonly featureName: string;
  /** True when no check failed (warns are allowed). */
  readonly passed: boolean;
  readonly checks: readonly VerdictCheck[];
};

export const verdictPassed = (checks: readonly VerdictCheck[]): boolean =>
  checks.every((c) => c.status !== 'fail');
