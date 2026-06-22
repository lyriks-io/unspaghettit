import type { Action } from '$features/behavior-model/domain/entities/Action';
import { isEvolution } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { ReachabilityGoalKind } from '$features/behavior-model/domain/entities/ReachabilityGoal';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  collectDerivedDefs,
  recomputeDerived
} from '$features/behavior-model/domain/services/DerivedState';
import { fillDefaults } from '$features/behavior-model/domain/services/ParameterValidator';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import { buildInitialSnapshot } from '$features/behavior-model/domain/services/StateSnapshot';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
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
 * steps", not a proof for unbounded executions — and DETERMINISTIC: actions run
 * with their parameter defaults, and an action with a required parameter that
 * has no default is skipped (and reported), since the explorer can't invent a
 * value. Those caveats are surfaced in the report so a green result is never
 * mistaken for more than it is.
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
   * goal can no longer be reached. `reachable` failures have no path (the goal
   * was simply never reached within bounds).
   */
  readonly counterexamplePath?: readonly string[];
};

export type ExplorationReport = {
  readonly statesExplored: number;
  readonly depthReached: number;
  /** True if a cap (depth or states) cut the search short — findings are then "within bounds". */
  readonly truncated: boolean;
  readonly invariantViolations: readonly InvariantCounterexample[];
  /** Non-evolution actions never observed firing successfully within the bound. */
  readonly deadActions: readonly DeadAction[];
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

type Move = { readonly surface: Surface; readonly action: Action };

const requiresUnsuppliableParam = (action: Action): boolean =>
  action.parameters.some((p) => p.required && p.defaultValue === undefined);

export const exploreStateSpace = (
  feature: Feature,
  options: ExplorerOptions = {},
  projectFeatures?: readonly Feature[]
): ExplorationReport => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;

  // Seed sibling/project state alongside the feature's own so cross-feature
  // invariants resolve against real defaults. The focal feature's derived state
  // recomputes after every effect; seeded paths ride along as static values.
  const allDefs = [
    ...feature.surfaces.flatMap((s) => s.stateDefinitions),
    ...(options.seedStateDefs ?? [])
  ];
  const derivedDefs = collectDerivedDefs(allDefs);
  const checkedInvariants = [
    ...(feature.featureInvariants ?? []),
    ...(options.extraInvariants ?? [])
  ];

  // Enumerate the moves once. Skip evolution placeholders (no committed body)
  // and actions whose required parameters have no default — record the latter
  // so they read as "not explored", never as "dead".
  const moves: Move[] = [];
  const skippedActions: SkippedAction[] = [];
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      if (isEvolution(action)) continue;
      if (requiresUnsuppliableParam(action)) {
        skippedActions.push({
          surfaceId: String(surface.id),
          actionId: String(action.id),
          actionName: action.name,
          reason: 'has a required parameter with no default; the explorer cannot invent a value'
        });
        continue;
      }
      moves.push({ surface, action });
    }
  }

  const goals = feature.reachabilityGoals ?? [];
  const trackGoals = goals.length > 0;

  const initial = recomputeDerived(buildInitialSnapshot(allDefs), derivedDefs);
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
  const goalSatisfyingKeys = new Map<string, Set<string>>();
  const goalEvaluated = new Set<string>();
  for (const goal of goals) goalSatisfyingKeys.set(String(goal.id), new Set<string>());

  const recordGoalSatisfaction = (snapshot: StateSnapshot, key: string): void => {
    if (goalEvaluated.has(key)) return;
    goalEvaluated.add(key);
    for (const goal of goals) {
      if (evaluateCondition(goal.condition, snapshot)) {
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
      const params = fillDefaults(move.action.parameters, {});
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
        }
        if (!visited.has(key) && node.path.length < maxDepth) {
          visited.add(key);
          queue.push({ snapshot: result.nextState, path: [...node.path, move.action.name], key });
        }
      }
    }

    // A reachable state from which no action could fire at all. Could be a
    // legitimate terminal state, so it's reported as a count, not an error.
    if (!anySuccess) deadlockStates += 1;
  }

  const deadActions: DeadAction[] = moves
    .filter((m) => !firedActions.has(String(m.action.id)))
    .map((m) => ({
      surfaceId: String(m.surface.id),
      actionId: String(m.action.id),
      actionName: m.action.name
    }));

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
    truncated,
    invariantViolations: violations,
    deadActions,
    deadlockStates,
    skippedActions,
    goalResults
  };
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
