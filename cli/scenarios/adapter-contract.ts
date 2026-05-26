/**
 * Contract for the user-authored adapter that `unspa scenarios export` calls
 * from generated Vitest files. The wedge stays deliberately minimal: the user
 * receives every scenario's pre-conditions (initial state + parameters +
 * routing metadata) and returns the implementation's actual outcome. The
 * generated test then asserts the outcome against the scenario's
 * expectedStatus + expectedAssertions — same oracle the simulator uses.
 *
 * The "wedge" name is intentional. We don't yet auto-bind to .unspa.json's
 * recorded code locations; the human writes the adapter once per project. As
 * patterns emerge across early users, a default adapter shape will codify and
 * this contract will gain a higher-level helper. For now, the user controls
 * the entire call.
 */

export type UnspaState = Readonly<Record<string, unknown>>;
export type UnspaParameters = Readonly<Record<string, unknown>>;

export type AdapterInvocation = {
  readonly featureId: string;
  readonly featureName: string;
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly scenarioId: string;
  readonly scenarioName: string;
  /** Persona attached to the scenario, or null when none was authored. */
  readonly personaId: string | null;
  readonly personaName: string | null;
  /**
   * State the scenario assumes before the action runs. This is the composition
   * of (persona stateOverrides) followed by (scenario stateOverrides) — the
   * exact same input the deterministic simulator would receive. Paths are
   * dotted (e.g. "cart.itemCount"); the value at each path is whatever the
   * spec authored.
   */
  readonly initialState: UnspaState;
  /**
   * Parameter values the scenario passes in. Composition of persona overrides
   * + scenario overrides; the adapter is responsible for any defaulting the
   * implementation does for missing optional params.
   */
  readonly parameters: UnspaParameters;
};

export type AdapterResult = {
  /**
   * 'success' when the implementation accepted the call and produced the
   * post-state; 'blocked' when a guard/precondition/invariant rejected it.
   * The generated test asserts this against scenario.expectedStatus (default
   * 'success' if the scenario didn't author one).
   */
  readonly status: 'success' | 'blocked';
  /**
   * The implementation's resulting state, in the same dotted-path-shaped
   * object the spec uses for state definitions. Only paths the scenario
   * asserts against are checked, so the adapter MAY return a partial state
   * containing just the touched paths.
   */
  readonly finalState: UnspaState;
};

export interface UnspaAdapter {
  invoke(input: AdapterInvocation): AdapterResult | Promise<AdapterResult>;
}
