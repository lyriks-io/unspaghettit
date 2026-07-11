import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Constant } from '$features/behavior-model/domain/entities/Constant';
import type { EventDelivery } from '$features/behavior-model/domain/entities/EventDefinition';
import type { ActionId } from '$features/behavior-model/domain/value-objects/ids';
import type { EventName } from '$features/behavior-model/domain/value-objects/EventName';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import {
  collectDerivedDefs,
  recomputeDerived,
  type DerivedDef
} from '$features/behavior-model/domain/services/DerivedState';
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
  type ActionOutcomeResult,
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

type ConstantMap = { readonly [name: string]: StateValue };

/**
 * Flatten a feature's declared constants into a name→value map for the
 * evaluator. Last declaration wins on a duplicate name (the validator rejects
 * duplicates before this runs, so it never matters in practice).
 */
const buildConstantMap = (constants: readonly Constant[] | undefined): ConstantMap => {
  if (!constants || constants.length === 0) return {};
  const out: { [name: string]: StateValue } = {};
  for (const c of constants) out[c.name] = c.value;
  return out;
};

const evaluateRules = (
  rules: readonly Rule[],
  origin: 'surface' | 'action',
  application: EffectApplication,
  parameters: ParameterValues,
  derivedDefs: readonly DerivedDef[],
  constants: ConstantMap
): { readonly application: EffectApplication; readonly records: readonly EvaluatedRuleRecord[] } => {
  let current = application;
  const records: EvaluatedRuleRecord[] = [];
  for (const rule of rules) {
    const held = evaluateCondition(rule.condition, current.snapshot, parameters, constants);
    records.push({
      ruleId: rule.id,
      category: rule.category,
      conditionHeld: held,
      origin
    });
    if (!held) continue;
    current = applyEffect(current, rule.effect, parameters, constants);
    // Keep derived paths consistent so a LATER rule's condition sees the
    // recomputed value, not a stale one from before this effect landed.
    current = { ...current, snapshot: recomputeDerived(current.snapshot, derivedDefs, constants) };
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
  // Derived (computed) state paths declared anywhere in scope. Recomputed after
  // every mutation below so authors never hand-maintain them and a stale write
  // can't survive (the next recompute overwrites it).
  const derivedDefs = collectDerivedDefs(allFeatureDefs);
  // Feature-level named constants, resolved once per simulate and threaded into
  // every rule/effect/derived/invariant evaluation below so a `{kind:"const"}`
  // reference sees the declared value. Cross-feature cascade handlers build
  // their OWN map from their own feature (simulateInternal runs per handler),
  // so a handler in feature B reads B's constants, not the emitter's.
  const constants = buildConstantMap(feature?.constants);
  // Note: the simulation clock (`clock.now`) is NOT auto-seeded here — it
  // materializes only when time is actually advanced (an `advance_time` effect
  // or a scenario `timeAdvance`), so time-free features keep a clean snapshot.
  // Until advanced the clock reads 0 (via readNow), and future-deadline
  // comparisons degrade correctly when the path is still absent.
  const completeSnapshot = recomputeDerived(
    mergeSnapshotWithDefaults(normalizedSnapshot, allFeatureDefs),
    derivedDefs,
    constants
  );

  const filledParams = fillDefaults(action.parameters, parameters);
  const parameterErrors = validateParameters(
    action.parameters,
    filledParams,
    feature?.valueSets
  );
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
  // Recompute derived afterwards: a bound parameter can feed a derived value.
  const boundSnapshot = recomputeDerived(
    applyParameterBindings(action.parameters, filledParams, completeSnapshot),
    derivedDefs,
    constants
  );

  let application = initialApplication(boundSnapshot);

  const surfaceEval = evaluateRules(
    surface.rules,
    'surface',
    application,
    filledParams,
    derivedDefs,
    constants
  );
  application = surfaceEval.application;
  const evaluatedRules: EvaluatedRuleRecord[] = [...surfaceEval.records];

  if (!application.blocked) {
    const capabilityEval = evaluateRules(
      action.rules,
      'action',
      application,
      filledParams,
      derivedDefs,
      constants
    );
    application = capabilityEval.application;
    evaluatedRules.push(...capabilityEval.records);
  }

  let selectedOutcome: ActionOutcomeResult | undefined;
  if (!application.blocked) {
    for (const effect of action.effects) {
      application = applyEffect(application, effect, filledParams, constants);
      application = {
        ...application,
        snapshot: recomputeDerived(application.snapshot, derivedDefs, constants)
      };
    }
    // First-class outcomes: after the action's own effects, resolve which
    // declared result the run landed on — the first outcome whose condition
    // holds (a condition-less outcome is the catch-all default) — and apply
    // that outcome's effects. Purely additive: with no outcomes declared the
    // action just succeeds, exactly as before.
    const outcome = (action.outcomes ?? []).find((candidate) =>
      evaluateCondition(candidate.condition, application.snapshot, filledParams, constants)
    );
    if (outcome) {
      selectedOutcome = { name: outcome.name, kind: outcome.kind, outcomeId: outcome.id };
      for (const effect of outcome.effects ?? []) {
        application = applyEffect(application, effect, filledParams, constants);
        application = {
          ...application,
          snapshot: recomputeDerived(application.snapshot, derivedDefs, constants)
        };
      }
    }
  } else if (action.onBlockedEffects && action.onBlockedEffects.length > 0) {
    // Universal "what to do when something blocked" fallbacks. State mutations
    // still cannot land (applyEffect guards `set_state` itself), but transitions,
    // events, and messages do fire so the user gets a graceful redirect /
    // observability signal.
    for (const effect of action.onBlockedEffects) {
      application = applyEffect(application, effect, filledParams, constants);
      application = {
        ...application,
        snapshot: recomputeDerived(application.snapshot, derivedDefs, constants)
      };
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
  //
  // `invariantRelaxation` is the scoped, preferred form: it names only the
  // invariants (by id) this action may leave violated, so every OTHER invariant
  // is still enforced. `bypassInvariants` (all-or-nothing) still wins if set.
  const relaxedIds = new Set(
    (action.invariantRelaxation?.invariantIds ?? []).map(String)
  );
  const allInvariants = action.bypassInvariants
    ? []
    : [
        ...(featureInvariants ?? []),
        ...surface.invariants,
        // Action invariants are post-conditions of THIS action COMPLETING. When
        // a rule blocked the action, no effects ran, so checking its
        // post-condition is vacuous and would falsely flag a precondition guard
        // — e.g. an action invariant "order.status == delivered" on "Confirm
        // delivery", invoked from a state where a rule blocks it, would report a
        // violation even though the action never happened. Skip them on a
        // rule-block, mirroring the scenario runner skipping assertions on a
        // blocked action. Feature + surface invariants are state predicates that
        // must hold in EVERY reachable state, so they're still checked (the
        // unchanged pre-action state was already valid, so they hold).
        ...(application.blocked ? [] : action.invariants)
      ].filter((invariant) => !relaxedIds.has(String(invariant.id)));
  const invariantViolations = checkInvariants(
    allInvariants,
    application.snapshot,
    filledParams,
    constants
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
    invariantViolations,
    outcome: selectedOutcome
  });

  // Event-handler cascade. Only triggers on a successful action that emitted
  // events AND when the caller supplied feature context (otherwise the
  // simulator has nothing to look subscribers up in). Each handler is a
  // full simulation against the running snapshot; if it succeeds, its
  // post-effect snapshot becomes the running snapshot for the next handler.
  //
  // Delivery semantics decide whether a handler failure reaches the emitter:
  // a `best_effort` event (the default) reports the failure but leaves the
  // emitter a success; a failing handler of a `required` or `transactional`
  // event blocks the emitter (it cannot be a clean success when a mandatory
  // consumer failed), and `transactional` additionally rolls the emitter's
  // state back to before the action ran so nothing partial lands.
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

    const deliveryOf = (eventName: EventName): EventDelivery =>
      (feature.events ?? []).find((e) => String(e.name) === String(eventName))?.delivery ??
      'best_effort';
    const failedDeliveries = cascaded.filter(
      (handler) =>
        handler.result.status !== 'success' && deliveryOf(handler.triggeredBy) !== 'best_effort'
    );
    if (failedDeliveries.length > 0) {
      const transactional = failedDeliveries.some(
        (handler) => deliveryOf(handler.triggeredBy) === 'transactional'
      );
      return {
        ...baseResult,
        status: 'blocked',
        // transactional: nothing lands. required: the emitter's own effects
        // stand, but it is reported blocked so the failed delivery is visible.
        nextState: transactional ? completeSnapshot : finalSnapshot,
        cascadedHandlers: cascaded
      };
    }
    return { ...baseResult, nextState: finalSnapshot, cascadedHandlers: cascaded };
  }

  return baseResult;
};
