import type { Expression } from '../value-objects/Expression';
import type { ActionId, PersonaId, ScenarioId, SurfaceId } from '../value-objects/ids';
import type { Operator } from '../value-objects/Operator';
import type { StatePath } from '../value-objects/StatePath';
import type { StateValue } from '../value-objects/StateValue';

/**
 * Scenarios sit at the action level. Where a Persona answers
 * "WHO is using the feature?" (an anonymous visitor, a premium customer),
 * a Scenario answers "WHAT STATE is the system in for this specific
 * action?" (account is locked, token has expired, code already attempted).
 *
 * In the simulator, persona overrides apply first, then the chosen scenario
 * overrides apply on top. So the same persona can exercise every branch of
 * an action without being duplicated as multiple "fake users".
 */
export type ScenarioStateOverride = {
  readonly path: StatePath;
  readonly value: StateValue;
};

export type ScenarioParameterOverride = {
  readonly parameterName: string;
  readonly value: StateValue;
};

/**
 * One assertion the scenario runner checks against the *post-simulation*
 * snapshot. Uses the same Operator vocabulary as RuleCondition so the
 * authoring model is uniform. `value` accepts a literal or an Expression
 * for state-vs-state assertions.
 */
export type ScenarioAssertion = {
  readonly path: StatePath;
  readonly operator: Operator;
  readonly value?: StateValue | Expression;
  readonly description?: string;
};

/**
 * One preceding action invocation in a multi-step scenario. Steps run in
 * order BEFORE the scenario's subject action (the action the scenario is
 * attached to), each simulated against the snapshot threaded forward from
 * the previous step. This is the "arrange" phase done by replaying real
 * actions instead of poking state: because every step is a genuine
 * `simulate()` call, the cross-action wiring (emitted events, shared state,
 * the event cascade) is exercised — that's what catches the inter-feature
 * bugs a single-action preset never could.
 */
export type ScenarioStep = {
  /** The action to invoke for this step, resolved within the feature. */
  readonly actionId: ActionId;
  /**
   * Surface that owns the step's action. Omit to reuse the scenario's own
   * surface (the common case: a flow within one screen).
   */
  readonly surfaceId?: SurfaceId;
  /** Parameter values for THIS step's action (keyed to that action's params). */
  readonly parameterOverrides: readonly ScenarioParameterOverride[];
  /**
   * Outcome expected for this step. Defaults to `'success'`: a setup step
   * that blocks unexpectedly fails the whole scenario, because every later
   * step (and the subject action) would then run against state that was
   * never reached. Set `'blocked'` for a step that is meant to be rejected
   * mid-flow.
   */
  readonly expectedStatus?: 'success' | 'blocked';
  /** Assertions checked against the snapshot AFTER this step runs. */
  readonly expectedAssertions?: readonly ScenarioAssertion[];
  readonly description?: string;
};

export type Scenario = {
  readonly id: ScenarioId;
  readonly name: string;
  readonly description?: string;
  /**
   * Optional persona baseline for this executable scenario. When set,
   * `run_all_scenarios` applies the persona's state and parameter overrides
   * first, then applies the scenario's action-specific overrides on top.
   */
  readonly personaId?: PersonaId;
  readonly stateOverrides: readonly ScenarioStateOverride[];
  readonly parameterOverrides: readonly ScenarioParameterOverride[];
  /**
   * Optional outcome expected when this scenario is simulated. Used by
   * `run_all_scenarios` to flag spec drift. If the LLM rewrote a rule and
   * the simulator now reports "success" for a scenario that documented
   * `expectedStatus: "blocked"`, the run reports a failure.
   */
  readonly expectedStatus?: 'success' | 'blocked';
  /**
   * Optional assertions checked against the post-simulation state snapshot.
   * Each assertion uses the same condition vocabulary as rules; the runner
   * reports any that don't hold so scenarios become executable specs, not
   * decoration.
   */
  readonly expectedAssertions?: readonly ScenarioAssertion[];
  /**
   * Optional: the surface the action should transition to. Checked against
   * `result.transition` after simulation. `null` means "no transition
   * expected" (i.e. the action should not move the user). When set, the
   * scenario fails if the actual transition target differs.
   *
   * Necessary for verifying routing / wizard / state-machine features:
   * without it, ScenarioAssertion can only check state paths, and routing
   * scenarios pass meaninglessly because the transition target is post-
   * action metadata not reachable from a state path.
   */
  readonly expectedTransition?: SurfaceId | null;
  /**
   * Optional preceding action invocations. When present, the runner replays
   * each step in order — threading the resulting snapshot forward — before
   * simulating this scenario's subject action. This turns a scenario from a
   * single state preset into an arrange→act→assert flow (e.g. start mining →
   * advance time ×N → mine). Absent (the default) keeps the classic
   * single-action preset behavior, so existing scenarios are unaffected.
   */
  readonly steps?: readonly ScenarioStep[];
};
