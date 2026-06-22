import type { Action } from '$features/behavior-model/domain/entities/Action';
import { isEvolution } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  collectDerivedDefs,
  recomputeDerived
} from '$features/behavior-model/domain/services/DerivedState';
import { fillDefaults } from '$features/behavior-model/domain/services/ParameterValidator';
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

  const allDefs = feature.surfaces.flatMap((s) => s.stateDefinitions);
  const derivedDefs = collectDerivedDefs(allDefs);

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

  const initial = recomputeDerived(buildInitialSnapshot(allDefs), derivedDefs);

  const queue: { snapshot: StateSnapshot; path: readonly string[] }[] = [
    { snapshot: initial, path: [] }
  ];
  const visited = new Set<string>([canonical(initial)]);
  const firedActions = new Set<string>();
  const violations: InvariantCounterexample[] = [];
  const violationSeen = new Set<string>();
  let statesExplored = 0;
  let depthReached = 0;
  let deadlockStates = 0;
  let truncated = false;

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (statesExplored >= maxStates) {
      truncated = true;
      break;
    }
    statesExplored += 1;
    depthReached = Math.max(depthReached, node.path.length);

    let anySuccess = false;
    for (const move of moves) {
      const params = fillDefaults(move.action.parameters, {});
      const result = simulate({
        surface: move.surface,
        action: move.action,
        snapshot: node.snapshot,
        parameters: params,
        featureInvariants: feature.featureInvariants,
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
        if (!visited.has(key) && node.path.length < maxDepth) {
          visited.add(key);
          queue.push({ snapshot: result.nextState, path: [...node.path, move.action.name] });
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

  return {
    statesExplored,
    depthReached,
    truncated,
    invariantViolations: violations,
    deadActions,
    deadlockStates,
    skippedActions
  };
};
