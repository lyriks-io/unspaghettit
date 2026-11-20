import type { Action } from '$features/behavior-model/domain/entities/Action';
import { effectiveActor, isEvolution } from '$features/behavior-model/domain/entities/Action';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { ReachabilityGoalKind } from '$features/behavior-model/domain/entities/ReachabilityGoal';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  collectDerivedDefs,
  recomputeDerived
} from '$features/behavior-model/domain/services/DerivedState';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import {
  buildInitialSnapshot,
  startingDeclarations
} from '$features/behavior-model/domain/services/StateSnapshot';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import {
  DEFAULT_MAX_COMBOS,
  parameterCombinations,
  type ParameterCoverage
} from './ParameterDomains';
import { simulate } from './SimulatorEngine';

/**
 * Bounded model checking over a feature. Where `run_all_scenarios` replays the
 * example flows a human authored (unit tests), this EXPLORES the reachable
 * state space — applying every action from every reachable state via the real
 * simulator — to answer the questions no hand-authored scenario can:
 *
 *   - Can an invariant EVER be violated, and if so by what action sequence?
 *   - Which actions are dead (never enabled from any reachable state)?
 *   - Are there deadlock states (reachable, but no action can fire)?
 *
 * It is BOUNDED (depth + total-states caps) — "no violation found within N
 * steps", not a proof for unbounded executions — and DETERMINISTIC: each action
 * runs across a bounded set of parameter-value combinations drawn from each
 * parameter's domain (every enum value, both booleans, a number's min/max
 * bounds; see ParameterDomains). An action is skipped (and reported) only when a
 * required parameter has no default and no enumerable domain, and the run is
 * marked truncated when a parameter grid is capped. Those caveats are surfaced
 * in the report so a green result is never mistaken for more than it is.
 *
 * A truncated run never calls an action dead: what did not fire is reported as
 * UNREACHED, with the bound that cut the search. "Dead" is kept for a search
 * that expanded every reachable state up to the depth bound.
 */
export type ExplorerOptions = {
  /** Max action-steps from the initial state. */
  readonly maxDepth?: number;
  /** Hard cap on states dequeued, so a wide model can't run away. */
  readonly maxStates?: number;
  /**
   * Invariants checked at every explored state IN ADDITION to the feature's
   * own. Used to enforce PROJECT-level (cross-feature) invariants while
   * exploring one feature's actions — they ride the same invariantViolations
   * channel, attributed to the action that reaches the violating state.
   */
  readonly extraInvariants?: readonly Invariant[];
  /**
   * State definitions whose defaults seed the initial snapshot beyond the
   * feature's own — typically the OTHER features' state in the project, so a
   * cross-feature invariant referencing their paths resolves against real
   * defaults instead of undefined.
   */
  readonly seedStateDefs?: readonly StateDefinition[];
  /**
   * Inputs the solver chose, by action id: one set per branch it witnessed.
   * Tried first for that action, and they let an action whose required input
   * has no enumerable domain be explored instead of skipped.
   */
  readonly witnessedInputs?: ReadonlyMap<string, readonly ParameterValues[]>;
};

export type InvariantCounterexample = {
  readonly invariantId: string;
  readonly invariantName: string;
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
  /** Action names from the initial state up to and including the violating one. */
  readonly path: readonly string[];
};

export type DeadAction = {
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
};

/**
 * An action never observed firing in a search that was cut short. Same row as
 * a dead action, but it proves nothing: the state that enables it may simply
 * lie past the cut.
 */
export type UnreachedAction = DeadAction & {
  /** Which bound cut the search, e.g. "exploration stopped at 2000 states". */
  readonly reason: string;
};

/** An action whose parameter grid was too wide to enumerate, and how much of it ran. */
export type SampledAction = DeadAction & Pick<ParameterCoverage, 'fullGridSize' | 'sampled'>;

export type SkippedAction = {
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly reason: string;
};

export type GoalResult = {
  readonly goalId: string;
  readonly goalName: string;
  readonly kind: ReachabilityGoalKind;
  /**
   * `reachable`: a reachable state satisfied the goal. `always_reachable`: every
   * reachable state can still reach a goal-satisfying state (no traps).
   */
  readonly satisfied: boolean;
  /**
   * `always_reachable` failures: shortest path to a TRAP state from which the
   * goal can no longer be reached: no way back was found, the search going on
   * up to maxDepth more steps past the bound (within maxStates) to look for
   * one. `reachable` failures have no path (the goal was simply never reached
   * within bounds).
   */
  readonly counterexamplePath?: readonly string[];
};

export type ExplorationReport = {
  readonly statesExplored: number;
  readonly depthReached: number;
  /** True if a cap (the states cap, a sampled parameter grid), a skipped action or an input tried at its sign edge alone cut the search short: findings are then "within bounds". */
  readonly truncated: boolean;
  readonly invariantViolations: readonly InvariantCounterexample[];
  /**
   * Non-evolution actions that never fired in a search that was NOT truncated:
   * every reachable state up to `maxDepth` was expanded with whole parameter
   * grids. Always empty when `truncated` is true (see `unreachedActions`). Still
   * bounded by depth: an action that needs more than `maxDepth` steps reads dead.
   */
  readonly deadActions: readonly DeadAction[];
  /**
   * Actions that never fired in a TRUNCATED search: not reached within bounds,
   * which is not evidence of a dead action. Always empty when not truncated.
   */
  readonly unreachedActions: readonly UnreachedAction[];
  /** Actions explored on a covering sample of their parameter grid, not all of it. */
  readonly sampledActions: readonly SampledAction[];
  /** Count of reachable states from which no action could fire (potential dead-ends). */
  readonly deadlockStates: number;
  readonly skippedActions: readonly SkippedAction[];
  /** One entry per authored reachability/liveness goal; empty when none are declared. */
  readonly goalResults: readonly GoalResult[];
};

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_STATES = 2000;

/**
 * Order-stable canonical serialization for the visited set: object keys sorted,
 * array order preserved (order is semantically meaningful for lists).
 */
const canonical = (v: StateValue | undefined): string => {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const obj = v as { [k: string]: StateValue };
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
};

type Move = {
  readonly surface: Surface;
  readonly action: Action;
  /** Parameter-value combinations to fire this action with (from its domains). */
  readonly combos: readonly ParameterValues[];
};

export const exploreStateSpace = (
  feature: Feature,
  options: ExplorerOptions = {},
  projectFeatures?: readonly Feature[]
): ExplorationReport => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  // A bound that is not a whole number of at least 1 cut the search without a
  // word: NaN steps explored the start alone and passed, NaN states never
  // stopped it. Refused, so a host or a mistyped option is told.
  for (const [name, bound] of [
    ['maxDepth', maxDepth],
    ['maxStates', maxStates]
  ] as const) {
    if (!Number.isSafeInteger(bound) || bound < 1) {
      throw new Error(`model check: ${name} must be a whole number of at least 1, got ${String(bound)}.`);
    }
  }

  // Seed sibling/project state alongside the feature's own so cross-feature
  // invariants resolve against real defaults. A path the feature declares keeps
  // its own value, as in the step simulation and the solver. The focal
  // feature's derived state recomputes after every effect; seeded paths ride
  // along as static values.
  const allDefs = startingDeclarations(
    feature.surfaces.flatMap((s) => s.stateDefinitions),
    options.seedStateDefs ?? []
  );
  const derivedDefs = collectDerivedDefs(allDefs);
  // The feature's named constants, as the simulator reads them: a goal or a
  // derived state comparing with one read it as unknown here, so a goal on a
  // constant never held and a derived state on one was wrong at the start.
  const constants: { [name: string]: StateValue } = {};
  for (const constant of feature.constants ?? []) constants[constant.name] = constant.value;
  const checkedInvariants = [
    ...(feature.featureInvariants ?? []),
    ...(options.extraInvariants ?? [])
  ];

  // Enumerate the moves once. Skip evolution placeholders (no committed body)
  // and actions whose required parameters have no default — record the latter
  // so they read as "not explored", never as "dead".
  // An event handler runs when its event is emitted, in the cascade of the
  // action that emits it; fired on its own it reached states the model never
  // reaches (a "recount" counting an expense nobody added), and broke
  // invariants there with a counterexample that cannot happen. A handler of an
  // event nothing in the model emits stays a move: the host may fire it.
  const emitted = emittedEventNames([feature, ...(projectFeatures ?? [])]);
  const moves: Move[] = [];
  const skippedActions: SkippedAction[] = [];
  const sampledActions: SampledAction[] = [];
  /** Actions whose number inputs were tried only at the edge of their sign. */
  const edgeOnlyActions: { readonly actionName: string; readonly inputs: readonly string[] }[] = [];
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      if (isEvolution(action)) continue;
      if (
        action.triggeredByEvent !== undefined &&
        effectiveActor(action) === 'event' &&
        emitted.has(String(action.triggeredByEvent))
      ) {
        continue;
      }
      const domains = parameterCombinations(action, feature.valueSets, DEFAULT_MAX_COMBOS, {
        surfaceRules: surface.rules,
        surfaceInvariants: surface.invariants,
        featureInvariants: feature.featureInvariants,
        constants: feature.constants,
        witnessed: options.witnessedInputs?.get(String(action.id)) ?? []
      });
      if (!domains.explorable) {
        skippedActions.push({
          surfaceId: String(surface.id),
          actionId: String(action.id),
          actionName: action.name,
          reason: domains.reason ?? 'has a required parameter the explorer cannot supply'
        });
        continue;
      }
      if (domains.capped && domains.coverage) {
        sampledActions.push({
          surfaceId: String(surface.id),
          actionId: String(action.id),
          actionName: action.name,
          fullGridSize: domains.coverage.fullGridSize,
          sampled: domains.coverage.sampled
        });
      }
      if (domains.edgeOnlyInputs) {
        edgeOnlyActions.push({ actionName: action.name, inputs: domains.edgeOnlyInputs });
      }
      moves.push({ surface, action, combos: domains.combos });
    }
  }

  const goals = feature.reachabilityGoals ?? [];
  const trackGoals = goals.length > 0;

  const initial = recomputeDerived(buildInitialSnapshot(allDefs), derivedDefs, constants);
  const initialKey = canonical(initial);

  const queue: { snapshot: StateSnapshot; path: readonly string[]; key: string }[] = [
    { snapshot: initial, path: [], key: initialKey }
  ];
  const visited = new Set<string>([initialKey]);
  const firedActions = new Set<string>();
  const violations: InvariantCounterexample[] = [];
  const violationSeen = new Set<string>();
  let statesExplored = 0;
  let depthReached = 0;
  let deadlockStates = 0;
  let truncated = false;

  // Liveness bookkeeping, populated only when goals are declared so the common
  // path stays allocation-light: the forward transition graph between
  // discovered states, the shortest path to each EXPANDED (dequeued) state, and
  // per-goal the set of state keys satisfying the goal condition. Goal
  // satisfaction is evaluated once per discovered state (dedup via goalEvaluated)
  // so frontier states cut at the depth bound still count toward reachability.
  const forwardEdges = new Map<string, Set<string>>();
  const expandedPath = new Map<string, readonly string[]>();
  // The states found but never expanded (cut by the depth bound or the states
  // cap), kept for the recovery search below when an always_reachable goal is
  // declared: the way back to the goal may run through them.
  const alwaysGoals = goals.filter((goal) => goal.kind === 'always_reachable');
  const discovered = new Map<string, StateSnapshot>();
  const goalSatisfyingKeys = new Map<string, Set<string>>();
  const goalEvaluated = new Set<string>();
  for (const goal of goals) goalSatisfyingKeys.set(String(goal.id), new Set<string>());

  const recordGoalSatisfaction = (snapshot: StateSnapshot, key: string): void => {
    if (goalEvaluated.has(key)) return;
    goalEvaluated.add(key);
    for (const goal of goals) {
      if (evaluateCondition(goal.condition, snapshot, {}, constants)) {
        goalSatisfyingKeys.get(String(goal.id))!.add(key);
      }
    }
  };
  if (trackGoals) recordGoalSatisfaction(initial, initialKey);

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (statesExplored >= maxStates) {
      truncated = true;
      break;
    }
    statesExplored += 1;
    depthReached = Math.max(depthReached, node.path.length);
    if (trackGoals) expandedPath.set(node.key, node.path);

    let anySuccess = false;
    for (const move of moves) {
      // Fire the action once per parameter-value combination from its domain, so
      // branches gated on an enum / boolean / bounded number are all exercised.
      for (const params of move.combos) {
        const result = simulate({
          surface: move.surface,
          action: move.action,
          snapshot: node.snapshot,
          parameters: params,
          featureInvariants: checkedInvariants,
          feature,
          ...(projectFeatures ? { projectFeatures } : {})
        });

        if (result.invariantViolations.length > 0) {
          // A reachable action that breaks an invariant: the counterexample is
          // the path to here plus this action. BFS means the first time we see a
          // given (invariant, action) pair the path is shortest.
          for (const v of result.invariantViolations) {
            const key = `${v.invariantId}@${move.action.id}`;
            if (violationSeen.has(key)) continue;
            violationSeen.add(key);
            violations.push({
              invariantId: String(v.invariantId),
              invariantName: v.invariantName,
              surfaceId: String(move.surface.id),
              actionId: String(move.action.id),
              actionName: move.action.name,
              path: [...node.path, move.action.name]
            });
          }
          // The engine blocks on violation, so this is not an enabling
          // transition — don't enqueue the violating state.
          continue;
        }

        if (result.status === 'success') {
          firedActions.add(String(move.action.id));
          anySuccess = true;
          const key = canonical(result.nextState as StateValue);
          if (trackGoals) {
            let succ = forwardEdges.get(node.key);
            if (!succ) {
              succ = new Set<string>();
              forwardEdges.set(node.key, succ);
            }
            succ.add(key);
            // Evaluate the goal on the successor even if it sits beyond the depth
            // bound (never enqueued) — a frontier state can still BE the goal.
            recordGoalSatisfaction(result.nextState, key);
            if (alwaysGoals.length > 0 && !discovered.has(key)) discovered.set(key, result.nextState);
          }
          if (!visited.has(key) && node.path.length < maxDepth) {
            visited.add(key);
            queue.push({ snapshot: result.nextState, path: [...node.path, move.action.name], key });
          }
        }
      }
    }

    // A reachable state from which no action could fire at all. Could be a
    // legitimate terminal state, so it's reported as a count, not an error.
    if (!anySuccess) deadlockStates += 1;
  }

  // Recovery search for always_reachable goals. A state reads as a trap when
  // no goal state is reachable from it in the graph the search built; but a
  // state near the bound has its way back cut by the bound itself, so a reset
  // that takes two steps read as a trap with a precise counterexample path.
  // From the unexpanded states such a candidate trap reaches, the search goes
  // on (only to find a way back: no finding, no fired action, no deadlock is
  // read there) for up to maxDepth more steps, within what is left of
  // maxStates. A trap is then a state with no way back within that horizon.
  if (alwaysGoals.length > 0) {
    const reached = alwaysGoals.map((goal) =>
      reverseReachable(goalSatisfyingKeys.get(String(goal.id))!, forwardEdges)
    );
    const candidates = [...expandedPath.keys()].filter((key) =>
      reached.some((reaches) => !reaches.has(key))
    );
    const seeds = [...forwardClosure(candidates, forwardEdges)].filter(
      (key) => !expandedPath.has(key) && discovered.has(key)
    );
    let budget = Math.max(0, maxStates - statesExplored);
    const recoveryQueue = seeds.map((key) => ({ key, snapshot: discovered.get(key)!, level: 0 }));
    const recoverySeen = new Set<string>([...expandedPath.keys(), ...seeds]);
    while (recoveryQueue.length > 0 && budget > 0) {
      const node = recoveryQueue.shift()!;
      budget -= 1;
      for (const move of moves) {
        for (const params of move.combos) {
          const result = simulate({
            surface: move.surface,
            action: move.action,
            snapshot: node.snapshot,
            parameters: params,
            featureInvariants: checkedInvariants,
            feature,
            ...(projectFeatures ? { projectFeatures } : {})
          });
          if (result.invariantViolations.length > 0 || result.status !== 'success') continue;
          const key = canonical(result.nextState as StateValue);
          let succ = forwardEdges.get(node.key);
          if (!succ) {
            succ = new Set<string>();
            forwardEdges.set(node.key, succ);
          }
          succ.add(key);
          if (!goalEvaluated.has(key)) {
            goalEvaluated.add(key);
            for (const goal of alwaysGoals) {
              if (evaluateCondition(goal.condition, result.nextState, {}, constants)) {
                goalSatisfyingKeys.get(String(goal.id))!.add(key);
              }
            }
          }
          if (!recoverySeen.has(key) && node.level + 1 < maxDepth) {
            recoverySeen.add(key);
            recoveryQueue.push({ key, snapshot: result.nextState, level: node.level + 1 });
          }
        }
      }
    }
  }

  const neverFired: DeadAction[] = moves
    .filter((m) => !firedActions.has(String(m.action.id)))
    .map((m) => ({
      surfaceId: String(m.surface.id),
      actionId: String(m.action.id),
      actionName: m.action.name
    }));

  // Only an exhaustive search can call an action dead. Cut short, the state
  // that enables it may lie past the cut, so the same rows are reported as
  // unreached, each saying which bound hit. A skipped action cuts the search
  // too: the states it produces were never explored.
  const combosCapped = sampledActions.length > 0;
  const skippedNames = skippedActions.map((a) => `"${a.actionName}"`);
  const cutShort =
    truncated || combosCapped || skippedNames.length > 0 || edgeOnlyActions.length > 0;
  const sampledById = new Map(sampledActions.map((a) => [a.actionId, a]));
  const unreachedReason = (actionId: string): string => {
    const own = sampledById.get(actionId);
    return [
      truncated
        ? `exploration stopped at ${statesExplored} states (depth ${depthReached} of ${maxDepth})`
        : null,
      own
        ? `only ${own.sampled} of its ${own.fullGridSize} parameter combinations were tried`
        : combosCapped
          ? 'another action ran on a sampled parameter grid'
          : null,
      skippedNames.length > 0
        ? `the exploration skipped ${skippedNames.join(', ')}, so the states ${skippedNames.length > 1 ? 'they produce' : 'it produces'} were never explored`
        : null,
      edgeOnlyActions.length > 0
        ? `${edgeOnlyActions
            .map((a) => `"${a.actionName}" was tried with ${a.inputs.map((i) => `"${i}"`).join(', ')} at the edge of its sign only`)
            .join('; ')}, an open domain that one value does not cover`
        : null
    ]
      .filter((part): part is string => part !== null)
      .join('; ');
  };
  const deadActions: DeadAction[] = cutShort ? [] : neverFired;
  const unreachedActions: UnreachedAction[] = cutShort
    ? neverFired.map((a) => ({ ...a, reason: unreachedReason(a.actionId) }))
    : [];

  const goalResults: GoalResult[] = goals.map((goal) => {
    const satisfyingKeys = goalSatisfyingKeys.get(String(goal.id))!;
    if (goal.kind === 'reachable') {
      return {
        goalId: String(goal.id),
        goalName: goal.name,
        kind: goal.kind,
        satisfied: satisfyingKeys.size > 0
      };
    }
    // always_reachable: every expanded state must still be able to reach a
    // goal-satisfying state. Reverse-reach from the satisfying set; any expanded
    // state left out is a trap (shortest path to it is the counterexample).
    const reachesGoal = reverseReachable(satisfyingKeys, forwardEdges);
    let trapPath: readonly string[] | null = null;
    for (const [key, path] of expandedPath) {
      if (!reachesGoal.has(key) && (trapPath === null || path.length < trapPath.length)) {
        trapPath = path;
      }
    }
    return {
      goalId: String(goal.id),
      goalName: goal.name,
      kind: goal.kind,
      satisfied: trapPath === null,
      ...(trapPath ? { counterexamplePath: trapPath } : {})
    };
  });

  return {
    statesExplored,
    depthReached,
    // A capped parameter grid, a skipped action or an input tried at its sign
    // edge alone means some runs were never tried, so the result is bounded in
    // the same honest sense as a depth/state cutoff.
    truncated: cutShort,
    invariantViolations: violations,
    deadActions,
    unreachedActions,
    sampledActions,
    deadlockStates,
    skippedActions,
    goalResults
  };
};

/**
 * The events some committed action of these features emits through an
 * `emit_event` effect (its own, a rule's or an outcome's): the ones that wake
 * their handlers in a cascade. A blocked action wakes none, so the effects run
 * on a block are left out.
 */
const emittedEventNames = (features: readonly Feature[]): ReadonlySet<string> => {
  const names = new Set<string>();
  const note = (effect: Effect | undefined) => {
    if (effect?.type === 'emit_event') names.add(String(effect.event));
  };
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const rule of surface.rules) note(rule.effect);
      for (const action of surface.actions) {
        if (isEvolution(action)) continue;
        for (const effect of action.effects) note(effect);
        for (const rule of action.rules) note(rule.effect);
        for (const outcome of action.outcomes ?? []) for (const effect of outcome.effects ?? []) note(effect);
      }
    }
  }
  return names;
};

/** Every state key reachable from `starts` (themselves included) along the transition graph. */
const forwardClosure = (
  starts: readonly string[],
  forwardEdges: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> => {
  const reached = new Set<string>(starts);
  const stack = [...starts];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of forwardEdges.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  return reached;
};

/**
 * The set of state keys that can reach any key in `targets` by following the
 * transition graph forward — computed by walking the graph BACKWARD from the
 * targets. Used for `always_reachable`: a state outside this set is one from
 * which the goal can no longer be reached (a liveness trap).
 */
const reverseReachable = (
  targets: ReadonlySet<string>,
  forwardEdges: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> => {
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of forwardEdges) {
    for (const to of tos) {
      const preds = reverse.get(to);
      if (preds) preds.push(from);
      else reverse.set(to, [from]);
    }
  }
  const reached = new Set<string>(targets);
  const stack = [...targets];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const pred of reverse.get(current) ?? []) {
      if (!reached.has(pred)) {
        reached.add(pred);
        stack.push(pred);
      }
    }
  }
  return reached;
};
