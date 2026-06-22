/**
 * The outcome of verifying a feature: a list of named checks, each pass / warn /
 * fail, plus the rolled-up `passed` (no check failed). A warn never sinks the
 * verdict — it surfaces an advisory finding (bounded-search caveat, drift,
 * low-but-ungated maturity) without breaking the build.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';

/**
 * A structured counterexample trace — the shortest action-name path to a
 * violating state, plus (for invariant violations) the action that breaks it,
 * so a UI can render the steps and deep-link to the culprit. Liveness traps
 * carry the path but no single action.
 */
export type VerdictTrace = {
  readonly label: string;
  readonly path: readonly string[];
  readonly surfaceId?: string;
  readonly actionId?: string;
};

export type VerdictCheck = {
  /** Stable machine id: scenarios | invariants | maturity | reachability | dead-actions | deadlocks | drift | bounds | liveness | events. */
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Supporting lines: failing scenario names, counterexample paths, drifted keys, … (CLI/text view). */
  readonly items?: readonly string[];
  /** Structured counterexample traces for the same findings (rich UI view). */
  readonly traces?: readonly VerdictTrace[];
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
