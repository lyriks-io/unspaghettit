import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type {
  Scenario,
  ScenarioAssertion
} from '$features/behavior-model/domain/entities/Scenario';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import {
  fillDefaults,
  type ParameterError,
  type ParameterValues
} from '$features/behavior-model/domain/services/ParameterValidator';
import type { InvariantViolation } from '$features/behavior-model/domain/services/InvariantChecker';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import {
  applyPersonaToParameters,
  applyPersonaToSnapshot
} from '$features/behavior-model/domain/services/PersonaApplier';
import {
  applyScenarioToParameters,
  applyScenarioToSnapshot
} from '$features/behavior-model/domain/services/ScenarioApplier';
import type {
  ActionId,
  ScenarioId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { simulate } from '$features/simulator/domain/SimulatorEngine';

export type ScenarioAssertionResult = {
  readonly path: string;
  readonly operator: ScenarioAssertion['operator'];
  /**
   * Whether the assertion held against the post-simulation snapshot.
   * `null` means the assertion was skipped because the action was blocked
   * before its success effects could land. Comparing a held/unheld state
   * value to "what should be there on success" is meaningless when no
   * effects ran, so the runner reports skipped explicitly instead of
   * silently evaluating against the unchanged snapshot.
   */
  readonly held: boolean | null;
  readonly skipped?: boolean;
  readonly description?: string;
};

/**
 * Outcome of one preceding step in a multi-step scenario. Each step replays a
 * real action through the simulator; `pass` is false if its status didn't
 * match `expectedStatus` (defaulting to "success") or any of its assertions
 * failed. A failing step fails the whole scenario.
 */
export type ScenarioStepResult = {
  readonly index: number;
  readonly surfaceId: SurfaceId;
  readonly actionId: ActionId;
  readonly actionName: string;
  readonly description: string | null;
  readonly actualStatus: 'success' | 'blocked';
  readonly expectedStatus: 'success' | 'blocked';
  readonly statusMatches: boolean;
  readonly assertions: readonly ScenarioAssertionResult[];
  readonly parameterErrors: readonly ParameterError[];
  readonly invariantViolations: readonly InvariantViolation[];
  readonly pass: boolean;
  readonly summary: string;
};

export type ScenarioRunResult = {
  readonly surfaceId: SurfaceId;
  readonly actionId: ActionId;
  readonly actionName: string;
  readonly scenarioId: ScenarioId;
  readonly scenarioName: string;
  readonly personaId: string | null;
  readonly personaName: string | null;
  /** Pass when status matches expectedStatus AND every assertion holds AND the transition target matches expectedTransition (if set). */
  readonly pass: boolean;
  readonly actualStatus: 'success' | 'blocked';
  readonly expectedStatus: 'success' | 'blocked' | null;
  readonly statusMatches: boolean;
  readonly assertions: readonly ScenarioAssertionResult[];
  /**
   * Results of the preceding steps for a multi-step scenario, in run order.
   * Empty for classic single-action scenarios. The overall `pass` is false if
   * any step failed.
   */
  readonly steps: readonly ScenarioStepResult[];
  /**
   * Result of the optional `expectedTransition` check. `null` means the
   * scenario did not specify an expected transition (most cases). Otherwise
   * `{ expected, actual, matches }` so the caller sees exactly what the
   * simulator landed on. Necessary to verify routing/wizard features that
   * branch via conditional `transition_surface` effects.
   */
  readonly transitionCheck: {
    readonly expected: SurfaceId | null;
    readonly actual: SurfaceId | null;
    readonly matches: boolean;
  } | null;
  /**
   * Parameter validation errors. When non-empty, the simulator never reached
   * rule evaluation. The inputs were rejected up-front. Surface so callers
   * don't have to guess "why did this come back blocked?" when the rules say
   * it should pass.
   */
  readonly parameterErrors: readonly ParameterError[];
  /** Invariants violated after effects ran. */
  readonly invariantViolations: readonly InvariantViolation[];
  /** Short human-readable summary suitable for CI output. */
  readonly summary: string;
};

export type RunScenariosInput = {
  readonly feature: Feature;
  readonly surfaceId?: SurfaceId;
  readonly actionId?: ActionId;
  /**
   * Sibling features in the same project. Passed to the simulator so the
   * cascade can find handlers declared in other features (e.g. an audit
   * logger in feature B reacting to an event from feature A). Caller loads
   * these via projectRepo when running scenarios with a project context.
   */
  readonly projectFeatures?: readonly Feature[];
};

export type RunScenariosOutput = {
  readonly featureId: string;
  readonly featureName: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly ScenarioRunResult[];
};

/**
 * Evaluate a scenario's expectedAssertions against a post-simulation snapshot.
 * Shared by the subject action and by each multi-step step. On a `blocked`
 * status every assertion is reported `held: null, skipped: true`: comparing
 * "state after success" to a snapshot where no success effects ran is
 * meaningless, so the runner skips explicitly instead of silently evaluating
 * against the untouched snapshot.
 */
const evaluateAssertions = (
  assertions: readonly ScenarioAssertion[],
  status: 'success' | 'blocked',
  snapshot: StateSnapshot,
  params: ParameterValues
): ScenarioAssertionResult[] =>
  assertions.map((a) => {
    if (status === 'blocked') {
      return {
        path: String(a.path),
        operator: a.operator,
        held: null,
        skipped: true,
        ...(a.description ? { description: a.description } : {})
      };
    }
    // Guard a malformed assertion that carries no state path (untyped scenario
    // data can deserialize with `path: undefined`). Evaluating it would call
    // `readPath(undefined)` → `undefined.split('.')` and crash the WHOLE
    // feature's run. Report it as not-held with a clear path string instead, so
    // one bad assertion fails just its own scenario rather than the run.
    const rawPath: unknown = a.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      return {
        path: String(a.path),
        operator: a.operator,
        held: false,
        ...(a.description ? { description: a.description } : {})
      };
    }
    const held = evaluateCondition(
      { left: a.path, operator: a.operator, right: a.value },
      snapshot,
      params
    );
    return {
      path: rawPath,
      operator: a.operator,
      held,
      ...(a.description ? { description: a.description } : {})
    };
  });

const runOne = (
  surface: Surface,
  action: Action,
  scenario: Scenario,
  feature: Feature,
  projectFeatures: readonly Feature[] | undefined
): ScenarioRunResult => {
  const persona: Persona | null =
    scenario.personaId !== undefined
      ? feature.personas.find((p) => p.id === scenario.personaId) ?? null
      : null;
  if (scenario.personaId !== undefined && persona === null) {
    throw new Error(
      `Scenario ${scenario.id} references unknown personaId "${String(scenario.personaId)}"`
    );
  }
  // Start with an empty snapshot. Same as the editor's "run with defaults"
  // flow. Persona overrides apply first as the user baseline, scenario state
  // overrides apply on top, then the simulator fills any remaining declared
  // paths from stateDefinition defaults.
  const personaSnapshot = persona ? applyPersonaToSnapshot(persona, {}) : {};
  const personaParams: ParameterValues = persona
    ? applyPersonaToParameters(persona, action, {})
    : {};
  const baseSnapshot = applyScenarioToSnapshot(scenario, personaSnapshot);

  // Replay any preceding steps, threading the resulting snapshot forward.
  // Each step is a real simulate() call (not a fake state poke), so the
  // cross-action wiring — emitted events, the event cascade, shared state —
  // is exercised on the way to the subject action.
  const stepResults: ScenarioStepResult[] = [];
  let snapshot: StateSnapshot = baseSnapshot;
  for (const [index, step] of (scenario.steps ?? []).entries()) {
    const stepSurface =
      step.surfaceId === undefined
        ? surface
        : feature.surfaces.find((s) => s.id === step.surfaceId);
    const stepAction = stepSurface?.actions.find((a) => a.id === step.actionId);
    if (!stepSurface || !stepAction) {
      throw new Error(
        `Scenario ${scenario.id} step ${index} references unknown ${
          !stepSurface
            ? `surfaceId "${String(step.surfaceId)}"`
            : `actionId "${String(step.actionId)}"`
        }`
      );
    }
    const stepPersonaParams: ParameterValues = persona
      ? applyPersonaToParameters(persona, stepAction, {})
      : {};
    const stepParamNames = new Set(stepAction.parameters.map((p) => p.name));
    const stepOverrideParams: { [k: string]: ParameterValues[string] } = {};
    for (const ov of step.parameterOverrides) {
      if (stepParamNames.has(ov.parameterName)) {
        stepOverrideParams[ov.parameterName] = ov.value;
      }
    }
    const stepParams: ParameterValues = { ...stepPersonaParams, ...stepOverrideParams };
    const stepResult = simulate({
      surface: stepSurface,
      action: stepAction,
      snapshot,
      parameters: stepParams,
      featureInvariants: feature.featureInvariants,
      feature,
      ...(projectFeatures ? { projectFeatures } : {})
    });
    // Thread forward. On a blocked step no success effect landed, so
    // nextState carries the last good state and later steps run against it —
    // the step (and so the scenario) is already marked failed below.
    snapshot = stepResult.nextState;
    const stepStatus: 'success' | 'blocked' =
      stepResult.status === 'blocked' ? 'blocked' : 'success';
    const stepExpected = step.expectedStatus ?? 'success';
    const stepStatusMatches = stepStatus === stepExpected;
    const stepFilled = fillDefaults(stepAction.parameters, stepParams);
    const stepAssertions = evaluateAssertions(
      step.expectedAssertions ?? [],
      stepStatus,
      stepResult.nextState,
      stepFilled
    );
    const stepAssertionsHold = stepAssertions.every((a) => a.skipped || a.held);
    const stepPass = stepStatusMatches && stepAssertionsHold;
    const stepFailedAssertions = stepAssertions.filter(
      (a) => !a.skipped && !a.held
    ).length;
    stepResults.push({
      index,
      surfaceId: stepSurface.id,
      actionId: stepAction.id,
      actionName: stepAction.name,
      description: step.description ?? null,
      actualStatus: stepStatus,
      expectedStatus: stepExpected,
      statusMatches: stepStatusMatches,
      assertions: stepAssertions,
      parameterErrors: stepResult.parameterErrors,
      invariantViolations: stepResult.invariantViolations,
      pass: stepPass,
      summary: stepPass
        ? `pass. ${stepStatus}`
        : !stepStatusMatches
          ? `status was ${stepStatus} but expected ${stepExpected}`
          : `${stepFailedAssertions} assertion${stepFailedAssertions === 1 ? '' : 's'} did not hold`
    });
  }

  const scenarioParams = applyScenarioToParameters(scenario, action, {});
  const baseParams: ParameterValues = { ...personaParams, ...scenarioParams };

  const result = simulate({
    surface,
    action,
    snapshot,
    parameters: baseParams,
    featureInvariants: feature.featureInvariants,
    feature,
    ...(projectFeatures ? { projectFeatures } : {})
  });

  // Assertions read the post-simulation snapshot. `nextState` reflects applied
  // effects on success runs; on blocked runs no set_state landed, so
  // expectedAssertions are skipped (see evaluateAssertions) rather than
  // evaluated against the untouched snapshot.
  const filledParams = fillDefaults(action.parameters, baseParams);
  const finalSnapshot = result.nextState;
  const actualStatus: 'success' | 'blocked' =
    result.status === 'blocked' ? 'blocked' : 'success';

  const assertions = evaluateAssertions(
    scenario.expectedAssertions ?? [],
    actualStatus,
    finalSnapshot,
    filledParams
  );

  const expectedStatus = scenario.expectedStatus ?? null;
  const statusMatches = expectedStatus === null || expectedStatus === actualStatus;
  // Only consider non-skipped assertions when computing pass: a blocked
  // scenario expecting "blocked" should pass on status alone.
  const assertionsHold = assertions.every((a) => a.skipped || a.held);
  // Silent-pass guard: a scenario that authored expectedAssertions but had
  // every one skip (because the action got blocked) AND didn't explicitly
  // set expectedStatus: "blocked" hasn't actually verified anything. Without
  // this check the scenario "passes" by vacuous truth - masking authoring
  // bugs (typo'd parameterName, missing required param, accidentally
  // permissive overrides).
  const allAssertionsSkipped =
    assertions.length > 0 && assertions.every((a) => a.skipped);
  const silentSkipFail =
    allAssertionsSkipped && expectedStatus !== 'blocked';
  // Transition check: only meaningful when the scenario opts in via
  // `expectedTransition`. When set, the actual transition target must match
  // (including expected===null meaning "no transition should fire"). When
  // the action was blocked, skip the check entirely, a blocked action
  // can still record a transition (rules with transition_surface fire
  // even when blocked), but the meaning of "expected transition on
  // success" is unclear in that case, so we treat it like skipped
  // assertions and only fail on the status mismatch.
  const transitionCheck =
    scenario.expectedTransition === undefined
      ? null
      : actualStatus === 'blocked'
        ? {
            expected: scenario.expectedTransition,
            actual: result.transition,
            // When blocked, we don't penalize on transition mismatch.
            matches: true
          }
        : {
            expected: scenario.expectedTransition,
            actual: result.transition,
            matches: scenario.expectedTransition === result.transition
          };
  const transitionOk = transitionCheck === null || transitionCheck.matches;
  // A multi-step scenario only passes if every preceding step passed: a step
  // that blocks unexpectedly means the subject action ran against state that
  // was never legitimately reached, so the whole flow is invalid.
  const stepsPass = stepResults.every((s) => s.pass);
  const firstFailedStep = stepResults.find((s) => !s.pass);
  const pass =
    stepsPass && statusMatches && assertionsHold && transitionOk && !silentSkipFail;

  const failedAssertionCount = assertions.filter((a) => !a.skipped && !a.held).length;
  const paramErrorBlurb =
    result.parameterErrors.length > 0
      ? ` (parameter validation rejected: ${result.parameterErrors
          .map((e) => `${e.parameterName}. ${e.reason}`)
          .join('; ')})`
      : '';
  const invariantBlurb =
    result.invariantViolations.length > 0
      ? ` (invariant violations: ${result.invariantViolations
          .map((v) => v.invariantName)
          .join(', ')})`
      : '';
  const evaluatedAssertionCount = assertions.filter((a) => !a.skipped).length;
  const skippedAssertionCount = assertions.length - evaluatedAssertionCount;
  const skippedBlurb =
    skippedAssertionCount > 0
      ? `, ${skippedAssertionCount} skipped (action was blocked)`
      : '';
  const transitionBlurb =
    transitionCheck && !transitionCheck.matches
      ? ` (transition went to ${String(transitionCheck.actual)} but expected ${String(transitionCheck.expected)})`
      : '';
  const stepPrefix =
    stepResults.length > 0
      ? `${stepResults.length} step${stepResults.length === 1 ? '' : 's'} ok, `
      : '';
  const summary = pass
    ? `pass. ${stepPrefix}${actualStatus}${evaluatedAssertionCount > 0 ? `, ${evaluatedAssertionCount} assertion${evaluatedAssertionCount === 1 ? '' : 's'} held` : ''}${skippedBlurb}`
    : `fail. ${
        !stepsPass && firstFailedStep
          ? `step ${firstFailedStep.index} (${firstFailedStep.actionName}): ${firstFailedStep.summary}`
          : !statusMatches
            ? `status was ${actualStatus} but expected ${expectedStatus}${paramErrorBlurb}${invariantBlurb}`
            : !transitionOk
              ? `transition mismatch${transitionBlurb}`
              : silentSkipFail
                ? `action was blocked so all ${assertions.length} assertion${assertions.length === 1 ? '' : 's'} skipped. Set expectedStatus:"blocked" if the block is intentional; otherwise fix the scenario so the action runs.${paramErrorBlurb}${invariantBlurb}`
                : `${failedAssertionCount}/${evaluatedAssertionCount} assertion${evaluatedAssertionCount === 1 ? '' : 's'} did not hold${invariantBlurb}`
      }`;

  return {
    surfaceId: surface.id,
    actionId: action.id,
    actionName: action.name,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    personaId: persona ? String(persona.id) : null,
    personaName: persona?.name ?? null,
    pass,
    actualStatus,
    expectedStatus,
    statusMatches,
    assertions,
    steps: stepResults,
    transitionCheck,
    parameterErrors: result.parameterErrors,
    invariantViolations: result.invariantViolations,
    summary
  };
};

/**
 * Walk the feature, optionally filtered to one surface or one action,
 * and execute every scenario through the deterministic simulator. Reports
 * pass/fail per scenario so scenarios become executable specs (the report's
 * "scenarios are decorative" complaint).
 */
export const runScenariosUseCase = () => {
  return (input: RunScenariosInput): RunScenariosOutput => {
    const results: ScenarioRunResult[] = [];
    for (const surface of input.feature.surfaces) {
      if (input.surfaceId && surface.id !== input.surfaceId) continue;
      for (const action of surface.actions) {
        if (input.actionId && action.id !== input.actionId) continue;
        const scenarios = action.scenarios ?? [];
        for (const scenario of scenarios) {
          results.push(runOne(surface, action, scenario, input.feature, input.projectFeatures));
        }
      }
    }
    const passed = results.filter((r) => r.pass).length;
    return {
      featureId: String(input.feature.id),
      featureName: input.feature.name,
      total: results.length,
      passed,
      failed: results.length - passed,
      results
    };
  };
};
