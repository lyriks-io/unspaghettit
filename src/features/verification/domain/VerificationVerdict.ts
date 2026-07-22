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

/**
 * One authored scenario's result, machine-readable.
 *
 * The `scenarios` CHECK carries a human summary ("3/7 failing") and a list of
 * display strings; that is enough for a CLI, and nothing else. A consumer that
 * wants to trace acceptance criteria → scenarios → results, or show which STEP
 * of a multi-step flow broke, needs the identity and the first failure, which
 * is what this is. Emitted for passing scenarios too: a report that only lists
 * failures can't answer "was this criterion actually exercised?".
 */
export type ScenarioVerdict = {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly passed: boolean;
  readonly expectedStatus: 'success' | 'blocked' | null;
  readonly actualStatus: 'success' | 'blocked';
  readonly assertionsEvaluated: number;
  readonly assertionsFailed: number;
  readonly assertionsSkipped: number;
  readonly stepCount: number;
  /** Index of the first failing step in a multi-step scenario, else null. */
  readonly firstFailingStep: number | null;
  /** Name of the action that first failing step invoked, else null. */
  readonly firstFailingStepAction: string | null;
  /** Why it failed, in one line. Null when it passed. */
  readonly reason: string | null;
};

export type FeatureVerdict = {
  readonly featureId: string;
  readonly featureName: string;
  /** True when no check failed (warns are allowed). */
  readonly passed: boolean;
  readonly checks: readonly VerdictCheck[];
  /**
   * Per-scenario results, in run order. Always present (empty when the feature
   * authors no scenarios) so consumers can index into it unconditionally.
   */
  readonly scenarios: readonly ScenarioVerdict[];
};

export const verdictPassed = (checks: readonly VerdictCheck[]): boolean =>
  checks.every((c) => c.status !== 'fail');
