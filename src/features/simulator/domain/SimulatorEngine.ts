import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { ActionId } from '$features/behavior-model/domain/value-objects/ids';
import type { EventName } from '$features/behavior-model/domain/value-objects/EventName';
import {
  applyEffect,
  initialApplication,
  type EffectApplication
} from '$features/behavior-model/domain/services/EffectApplier';
import { checkInvariants } from '$features/behavior-model/domain/services/InvariantChecker';
import { applyParameterBindings } from '$features/behavior-model/domain/services/ParameterBindings';
import {
  fillDefaults,
  validateParameters,
  type ParameterValues
} from '$features/behavior-model/domain/services/ParameterValidator';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import { mergeSnapshotWithDefaults } from '$features/behavior-model/domain/services/StateSnapshot';
import { normalizeSnapshot, type StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import {
  fromApplication,
  type CascadedHandlerResult,
  type EvaluatedRuleRecord,
  type SimulationResult
} from './SimulationResult';

export type SimulationInput = {
  readonly surface: Surface;
  readonly action: Action;
  readonly snapshot: StateSnapshot;
  readonly parameters: ParameterValues;
  /**
   * Cross-surface invariants checked after the action runs, in addition to
   * surface/action invariants. Optional so test fixtures can stay minimal
   *, when omitted, only surface/action invariants apply.
   */
  readonly featureInvariants?: readonly Invariant[];
  /**
   * Optional feature context. When provided AND the action succeeds AND
   * emits events, the simulator finds any action with `triggeredByEvent`
   * matching and runs it as a cascaded handler against the post-effect
   * snapshot. Bounded by `CASCADE_DEPTH_LIMIT` and a per-cascade visited
   * set so a handler can't trigger itself or infinite-loop.
   *
   * Legacy callers that don't need cascade pass only `featureInvariants`
   * and skip this, handlers stay dormant.
   */
  readonly feature?: Feature;
  /**
   * Optional sibling features (same project as `feature`). When provided,
   * cascade handler lookup walks each of these too, so an event emitted
   * by an action in one feature can trigger a handler declared in another
   * feature, as long as both are loaded into the simulator together.
   * Closes the "handlers must live in the emitter's feature" friction.
   * Cycle guard works across features because action ids are globally
   * unique.
   */
  readonly projectFeatures?: readonly Feature[];
};

/** Defense against handler-triggers-handler-triggers-... chains. */
const CASCADE_DEPTH_LIMIT = 8;

const evaluateRules = (
  rules: readonly Rule[],
  origin: 'surface' | 'action',
  application: EffectApplication,
  parameters: ParameterValues
): { readonly application: EffectApplication; readonly records: readonly EvaluatedRuleRecord[] } => {
  let current = application;
  const records: EvaluatedRuleRecord[] = [];
  for (const rule of rules) {
    const held = evaluateCondition(rule.condition, current.snapshot, parameters);
    records.push({
      ruleId: rule.id,
      category: rule.category,
      conditionHeld: held,
      origin
    });
    if (!held) continue;
    current = applyEffect(current, rule.effect, parameters);
  }
  return { application: current, records };
};

/**
 * Find every action across the focal feature AND any sibling features
 * passed in `projectFeatures` that subscribes to `eventName` via
 * `triggeredByEvent`. Surface scope doesn't matter, handlers can live on
 * any surface in any feature. The handler still belongs to its declared
 * surface (its rules and surface-invariants run as written) AND its
 * declared feature (its feature-level invariants apply during the
 * cascade).
 */
const findEventHandlers = (
  features: readonly Feature[],
  eventName: EventName
): readonly { feature: Feature; surface: Surface; action: Action }[] => {
  const out: { feature: Feature; surface: Surface; action: Action }[] = [];
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const action of surface.actions) {
        if (action.triggeredByEvent === eventName) {
          out.push({ feature, surface, action });
        }
      }
    }
  }
  return out;
};

/**
 * Run the cascade for one already-simulated parent action. For each event
 * the parent emitted, find subscribers and recursively simulate them. The
 * running snapshot threads through so a later handler sees earlier
 * handlers' effects. Cycle-guarded by `visited` (one action can't fire
 * twice in the same cascade) and depth-capped to keep an honest mistake
 * from looping forever.
 *
 * Returns the cascaded results and the final snapshot. Callers patch the
 * parent SimulationResult's `nextState` so downstream consumers see the
 * fully-settled state.
 */
const runCascade = (
  focal: Feature,
  projectFeatures: readonly Feature[] | undefined,
  parentResult: SimulationResult,
  depth: number,
  visited: Set<ActionId>
): { readonly cascaded: readonly CascadedHandlerResult[]; readonly finalSnapshot: StateSnapshot } => {
  if (depth >= CASCADE_DEPTH_LIMIT) {
    return { cascaded: [], finalSnapshot: parentResult.nextState };
  }
  // Walk the focal feature first (handlers in the emitter's own feature win
  // ordering ties), then siblings. Use the same de-duplicated feature list
  // for handler lookup AND for invariant-checking on each handler (each
  // handler enforces its OWN feature's invariants, not the emitter's).
  const features = projectFeatures
    ? [focal, ...projectFeatures.filter((f) => f.id !== focal.id)]
    : [focal];
  const cascaded: CascadedHandlerResult[] = [];
  let snapshot = parentResult.nextState;
  for (const eventName of parentResult.emittedEvents) {
    for (const handler of findEventHandlers(features, eventName)) {
      if (visited.has(handler.action.id)) continue;
      visited.add(handler.action.id);
      const handlerResult = simulateInternal(
        {
          surface: handler.surface,
          action: handler.action,
          snapshot,
          parameters: {},
          // Each handler enforces its OWN feature's invariants. A handler
          // in feature B should not be blocked by feature A's invariants.
          featureInvariants: handler.feature.featureInvariants,
          feature: handler.feature,
          projectFeatures
        },
        depth + 1,
        visited
      );
      cascaded.push({ triggeredBy: eventName, depth: depth + 1, result: handlerResult });
      if (handlerResult.status === 'success') {
        snapshot = handlerResult.nextState;
      }
    }
  }
  return { cascaded, finalSnapshot: snapshot };
};

export const simulate = (input: SimulationInput): SimulationResult =>
  simulateInternal(input, 0, new Set());

const simulateInternal = (
  input: SimulationInput,
  cascadeDepth: number,
  cascadeVisited: Set<ActionId>
): SimulationResult => {
  const { surface, action, snapshot, parameters, featureInvariants, feature, projectFeatures } = input;

  // Accept both nested and flat-dotted top-level keys in the caller's
  // snapshot. `{ "cart.subtotalCents": 1000 }` is a natural way to author a
  // dry-run input but the engine reads nested, so normalize first.
  const normalizedSnapshot = normalizeSnapshot(snapshot);

  // Fill paths declared anywhere in the focal feature that the caller omitted,
  // so rule and invariant evaluation never sees `undefined` for a known state.
  // Without this, a feature-level invariant referencing a path declared on a
  // sibling surface would see undefined when the scenario runs on a different
  // surface, and `greater_than` etc. would evaluate to false → spurious
  // "invariant violated" error. Falls back to the action's surface when no
  // feature context is supplied (legacy callers).
  const allFeatureDefs = feature
    ? feature.surfaces.flatMap((s) => s.stateDefinitions)
    : surface.stateDefinitions;
  const completeSnapshot = mergeSnapshotWithDefaults(normalizedSnapshot, allFeatureDefs);

  const filledParams = fillDefaults(action.parameters, parameters);
  const parameterErrors = validateParameters(action.parameters, filledParams);
  if (parameterErrors.length > 0) {
    // Parameter validation failures are treated as blocks: the action could
    // not proceed because the inputs were rejected. There are only two
    // outcomes. `success` or `blocked`.
    return fromApplication({
      actionId: action.id,
      status: 'blocked',
      parameterErrors,
      evaluatedRules: [],
      application: initialApplication(completeSnapshot),
      previousState: completeSnapshot,
      invariantViolations: []
    });
  }

  // Apply parameter -> state-path bindings before any rule looks at state, so
  // rules can react to bound parameter values just like any other state.
  const boundSnapshot = applyParameterBindings(
    action.parameters,
    filledParams,
    completeSnapshot
  );

  let application = initialApplication(boundSnapshot);

  const surfaceEval = evaluateRules(surface.rules, 'surface', application, filledParams);
  application = surfaceEval.application;
  const evaluatedRules: EvaluatedRuleRecord[] = [...surfaceEval.records];

  if (!application.blocked) {
    const capabilityEval = evaluateRules(
      action.rules,
      'action',
      application,
      filledParams
    );
    application = capabilityEval.application;
    evaluatedRules.push(...capabilityEval.records);
  }

  if (!application.blocked) {
    for (const effect of action.effects) {
      application = applyEffect(application, effect, filledParams);
    }
  } else if (action.onBlockedEffects && action.onBlockedEffects.length > 0) {
    // Universal "what to do when something blocked" fallbacks. State mutations
    // still cannot land (applyEffect guards `set_state` itself), but transitions,
    // events, and messages do fire so the user gets a graceful redirect /
    // observability signal.
    for (const effect of action.onBlockedEffects) {
      application = applyEffect(application, effect, filledParams);
    }
  }

  // Feature invariants apply across every surface/action and ride alongside
  // the local ones. They show up in invariantViolations with the same shape
  // so callers (CI scenario runner, dashboard) display them identically.
  //
  // Repair / admin actions opt out via `bypassInvariants: true`. The action
  // still runs through every rule and effect; we just skip the post-flight
  // check so a broken invariant can't keep the user from fixing the data
  // that caused it (the "invariant paralysis" failure mode).
  const allInvariants = action.bypassInvariants
    ? []
    : [
        ...(featureInvariants ?? []),
        ...surface.invariants,
        ...action.invariants
      ];
  const invariantViolations = checkInvariants(
    allInvariants,
    application.snapshot,
    filledParams
  );

  let status: SimulationResult['status'] = 'success';
  if (application.blocked) status = 'blocked';
  if (invariantViolations.length > 0) status = 'blocked';

  const baseResult = fromApplication({
    actionId: action.id,
    status,
    parameterErrors: [],
    evaluatedRules,
    application,
    previousState: completeSnapshot,
    invariantViolations
  });

  // Event-handler cascade. Only triggers on a successful action that emitted
  // events AND when the caller supplied feature context (otherwise the
  // simulator has nothing to look subscribers up in). Each handler is a
  // full simulation against the running snapshot; if it succeeds, its
  // post-effect snapshot becomes the running snapshot for the next handler.
  // Handler failures don't fail the parent, they're reported individually
  // in `cascadedHandlers` so a scenario can assert on either side honestly.
  if (
    feature !== undefined &&
    status === 'success' &&
    baseResult.emittedEvents.length > 0
  ) {
    // Reserve this action's id so an event it emits can't bounce back and
    // re-trigger itself transitively. Other cascades are still free to fire
    // it (the visited set is per-simulate, not global).
    cascadeVisited.add(action.id);
    const { cascaded, finalSnapshot } = runCascade(
      feature,
      projectFeatures,
      baseResult,
      cascadeDepth,
      cascadeVisited
    );
    if (cascaded.length === 0) return baseResult;
    return { ...baseResult, nextState: finalSnapshot, cascadedHandlers: cascaded };
  }

  return baseResult;
};
