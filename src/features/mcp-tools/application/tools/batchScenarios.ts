import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { scenarioScopeOfChange } from '$features/simulator/domain/ScenarioScope';
import { scenarioVerdict } from '$features/verification/domain/aggregateVerdict';

/**
 * A write never runs more scenarios than this. The engine clears a hundred in
 * about a second, so the cap keeps the answer to a batch within a few seconds
 * on the largest features; past it the answer says `truncated` and the caller
 * reads the rest with run_all_scenarios.
 */
export const BATCH_SCENARIO_LIMIT = 300;

/**
 * One failing scenario, as a batch answer names it. The same facts `verify`
 * reports per scenario (identity, the two statuses, the first failing step,
 * the reason), without the assertion tallies: a batch answer only lists
 * failures, and the reason already says which assertions did not hold.
 */
export type BatchScenarioFailure = {
  readonly scenarioId: string;
  readonly name: string;
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly expectedStatus: 'success' | 'blocked' | null;
  readonly actualStatus: 'success' | 'blocked';
  /** Index of the first failing step of a multi-step scenario. Absent otherwise. */
  readonly firstFailingStep?: number;
  readonly reason: string;
};

export type BatchScenarios = {
  /** `touched`: only the scenarios exercising the actions the batch changed. */
  readonly scope: 'touched' | 'feature';
  readonly run: number;
  readonly passed: number;
  /** Failing scenarios only. Passing ones are a count, never rows. */
  readonly failed: readonly BatchScenarioFailure[];
  /** Present (and true) only when the run stopped at the cap. */
  readonly truncated?: boolean;
};

const runScenarios = runScenariosUseCase();

/**
 * The scenarios of what a batch touched, run on the feature the batch produces.
 *
 * Pure: it reads the two features and returns data, so a dry run can answer it
 * without saving anything. A failing scenario is information, never a reason to
 * refuse the batch; validation alone decides that. Agents used to commit first
 * and then learn from another call that an expected value no longer held.
 */
export const batchScenariosTool = (
  before: Feature,
  after: Feature,
  projectFeatures?: readonly Feature[]
): BatchScenarios => {
  const scope = scenarioScopeOfChange(before, after);
  const output = runScenarios({
    feature: after,
    limit: BATCH_SCENARIO_LIMIT,
    ...(scope.scope === 'touched' ? { exercisingActionIds: scope.actionIds } : {}),
    ...(projectFeatures ? { projectFeatures } : {})
  });
  return {
    scope: scope.scope,
    run: output.total,
    passed: output.passed,
    failed: output.results
      .filter((result) => !result.pass)
      .map(scenarioVerdict)
      .map((row) => ({
        scenarioId: row.scenarioId,
        name: row.scenarioName,
        surfaceId: row.surfaceId,
        actionId: row.actionId,
        actionName: row.actionName,
        expectedStatus: row.expectedStatus,
        actualStatus: row.actualStatus,
        ...(row.firstFailingStep !== null ? { firstFailingStep: row.firstFailingStep } : {}),
        reason: row.reason ?? 'failed'
      })),
    ...(output.truncated ? { truncated: true } : {})
  };
};
