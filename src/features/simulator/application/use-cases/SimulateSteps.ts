import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  applyPersonaToParameters,
  applyPersonaToSnapshot
} from '$features/behavior-model/domain/services/PersonaApplier';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import { advanceClock } from '$features/behavior-model/domain/value-objects/SimulationClock';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import { seedOtherFeatureDefaults } from '$features/behavior-model/domain/services/StateSnapshot';
import { simulate } from '$features/simulator/domain/SimulatorEngine';
import type {
  ActionOutcomeResult,
  SimulationMessage,
  SimulationResult
} from '$features/simulator/domain/SimulationResult';

/**
 * Play a sequence of actions against a feature, threading the state from one to
 * the next, and say what each one did in words a reader can check: the rule that
 * refused it, the state it changed (before and after), the messages, the events,
 * the move to another surface and the handlers the events woke up.
 *
 * This is the step-by-step half of the simulator. A scenario asserts an expected
 * result; a walk only reports, so it is what an author uses to try a feature as
 * it is being written ("add to cart, then check out: what happens?"). Pure: it
 * never writes the feature.
 *
 * A refused step changes nothing and the walk goes on from the same state, since
 * a person who is refused tries the next thing; `stopOnBlocked` ends it instead.
 */

export type WalkStep = {
  /** The action to run, by id. */
  readonly actionId: string;
  /** Its surface. Optional: an action id names one action in the feature. */
  readonly surfaceId?: string;
  /** Values by parameter name, `$channel` included (the channel the call arrives through). */
  readonly parameters?: ParameterValues;
  /** Logical time to let pass before this step (moves `clock.now`). */
  readonly timeAdvance?: number;
};

export type WalkInput = {
  readonly feature: Feature;
  readonly steps: readonly WalkStep[];
  /** State to start from, over the declared defaults. */
  readonly snapshot?: StateSnapshot;
  /** A persona of the feature: its state first, its parameter values as defaults. */
  readonly personaId?: string;
  /** Other features of the project, so an emitted event reaches their handlers. */
  readonly projectFeatures?: readonly Feature[];
  readonly stopOnBlocked?: boolean;
  /**
   * Invariants that hold across the project (its cross-feature invariants):
   * checked after every step like the feature's own, so a step that breaks
   * one is refused. They read state other features declare, hence
   * `seedStateDefs`.
   */
  readonly extraInvariants?: readonly Invariant[];
  /** Other features' state, whose defaults fill the start where the snapshot says nothing. */
  readonly seedStateDefs?: readonly StateDefinition[];
};

export type StateChange = {
  readonly path: string;
  readonly before: StateValue | undefined;
  readonly after: StateValue | undefined;
};

export type CascadedStep = {
  readonly triggeredBy: string;
  readonly depth: number;
  readonly actionId: string;
  readonly actionName: string;
  readonly status: 'success' | 'blocked';
};

export type WalkStepResult = {
  readonly index: number;
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly parameters: ParameterValues;
  readonly status: 'success' | 'blocked';
  /** Why it was refused, one sentence each: a rule's reason, a rejected input, a broken invariant. */
  readonly refusedBecause: readonly string[];
  readonly changes: readonly StateChange[];
  /**
   * On a step refused AFTER its effects ran (an invariant it would break), the
   * change it tried to make: the state that would have broken the invariant.
   * Never applied; the walk goes on from the state before the step.
   */
  readonly rejectedChanges?: readonly StateChange[];
  readonly messages: readonly SimulationMessage[];
  readonly emittedEvents: readonly string[];
  /** The surface the step moved to, or null when it stayed. */
  readonly movedTo: { readonly surfaceId: string; readonly surfaceName: string } | null;
  readonly outcome?: ActionOutcomeResult;
  readonly cascaded?: readonly CascadedStep[];
};

export type WalkResult = {
  readonly steps: readonly WalkStepResult[];
  /** Steps not run because `stopOnBlocked` ended the walk. */
  readonly notRun: number;
  readonly finalState: StateSnapshot;
};

/** Thrown for a step that names nothing the feature holds. */
export class WalkStepNotFoundError extends Error {}

const locate = (
  feature: Feature,
  step: WalkStep,
  index: number
): { readonly surface: Surface; readonly action: Action } => {
  const surfaces = step.surfaceId
    ? feature.surfaces.filter((s) => String(s.id) === step.surfaceId)
    : feature.surfaces;
  if (step.surfaceId && surfaces.length === 0) {
    throw new WalkStepNotFoundError(
      `Step ${index}: surface ${step.surfaceId} is not in feature ${String(feature.id)}.`
    );
  }
  for (const surface of surfaces) {
    const action = surface.actions.find((a) => String(a.id) === step.actionId);
    if (action) return { surface, action };
  }
  const known = feature.surfaces
    .flatMap((s) => s.actions.map((a) => `${String(a.id)} (${a.name})`))
    .slice(0, 30)
    .join(', ');
  throw new WalkStepNotFoundError(
    `Step ${index}: action ${step.actionId} is not in feature ${String(feature.id)}${
      step.surfaceId ? ` on surface ${step.surfaceId}` : ''
    }. Actions: ${known || 'none'}.`
  );
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every leaf of a nested snapshot by dotted path; arrays are one value. */
const leaves = (
  value: unknown,
  prefix: string,
  out: Map<string, StateValue>
): Map<string, StateValue> => {
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    out.set(prefix, value as StateValue);
  }
  return out;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What moved between two snapshots, path by path, in path order. */
export const diffSnapshots = (before: StateSnapshot, after: StateSnapshot): StateChange[] => {
  const a = leaves(before, '', new Map());
  const b = leaves(after, '', new Map());
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((path) => !same(a.get(path), b.get(path)))
    .map((path) => ({ path, before: a.get(path), after: b.get(path) }));
};

const refusalReasons = (result: SimulationResult, surface: Surface, action: Action): string[] => {
  if (result.status !== 'blocked') return [];
  const rules = new Map(
    [...surface.rules, ...action.rules].map((rule) => [String(rule.id), rule] as const)
  );
  const reasons: string[] = [];
  for (const e of result.parameterErrors) reasons.push(`${e.parameterName}: ${e.reason}`);
  for (const record of result.evaluatedRules) {
    if (!record.conditionHeld) continue;
    const effect = rules.get(String(record.ruleId))?.effect;
    if (effect?.type === 'block_action') {
      reasons.push((effect as { reason?: string }).reason || `rule ${String(record.ruleId)}`);
    }
  }
  for (const v of result.invariantViolations) reasons.push(`${v.invariantName}: ${v.message}`);
  return reasons;
};

const actionNames = (features: readonly Feature[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const f of features) {
    for (const s of f.surfaces) for (const a of s.actions) names.set(String(a.id), a.name);
  }
  return names;
};

const flattenCascade = (
  result: SimulationResult,
  names: ReadonlyMap<string, string>
): CascadedStep[] =>
  (result.cascadedHandlers ?? []).flatMap((c) => [
    {
      triggeredBy: String(c.triggeredBy),
      depth: c.depth,
      actionId: String(c.result.actionId),
      actionName: names.get(String(c.result.actionId)) ?? String(c.result.actionId),
      status: c.result.status
    },
    ...flattenCascade(c.result, names)
  ]);

export const simulateSteps = (input: WalkInput): WalkResult => {
  const { feature } = input;
  const persona =
    input.personaId !== undefined
      ? feature.personas.find((p) => String(p.id) === input.personaId)
      : undefined;
  if (input.personaId !== undefined && !persona) {
    throw new WalkStepNotFoundError(
      `Persona ${input.personaId} is not in feature ${String(feature.id)}. Personas: ${
        feature.personas.map((p) => `${String(p.id)} (${p.name})`).join(', ') || 'none'
      }.`
    );
  }
  // Resolve every step before running one, so a typo in step 5 is refused
  // before steps 1 to 4 print a walk that looks complete.
  const located = input.steps.map((step, i) => locate(feature, step, i));
  const surfaceNames = new Map(feature.surfaces.map((s) => [String(s.id), s.name] as const));
  const names = actionNames([feature, ...(input.projectFeatures ?? [])]);

  let snapshot: StateSnapshot = persona
    ? applyPersonaToSnapshot(persona, input.snapshot ?? {})
    : (input.snapshot ?? {});
  // The other features' state fills only what the feature declares none of,
  // so it starts from its own values, as in the exploration and the solver.
  snapshot = seedOtherFeatureDefaults(
    snapshot,
    feature.surfaces.flatMap((s) => s.stateDefinitions),
    input.seedStateDefs ?? []
  );
  const invariants = [...(feature.featureInvariants ?? []), ...(input.extraInvariants ?? [])];
  const results: WalkStepResult[] = [];
  for (const [index, step] of input.steps.entries()) {
    const { surface, action } = located[index]!;
    if (step.timeAdvance !== undefined && step.timeAdvance !== 0) {
      snapshot = advanceClock(snapshot, step.timeAdvance);
    }
    const parameters: ParameterValues = {
      ...(persona ? applyPersonaToParameters(persona, action, {}) : {}),
      ...(step.parameters ?? {})
    };
    const result = simulate({
      surface,
      action,
      snapshot,
      parameters,
      featureInvariants: invariants,
      feature,
      ...(input.projectFeatures ? { projectFeatures: input.projectFeatures } : {})
    });
    const cascaded = flattenCascade(result, names);
    // The simulator reports the state an invariant violation would have left
    // as `nextState`; a refused step must not carry it into the next one.
    const attempted = diffSnapshots(result.previousState, result.nextState);
    const refused = result.status === 'blocked';
    results.push({
      index,
      surfaceId: String(surface.id),
      surfaceName: surface.name,
      actionId: String(action.id),
      actionName: action.name,
      parameters,
      status: result.status,
      refusedBecause: refusalReasons(result, surface, action),
      // Against the state the step started from, defaults filled, so the first
      // step does not report every declared default as a change.
      changes: refused ? [] : attempted,
      ...(refused && attempted.length > 0 ? { rejectedChanges: attempted } : {}),
      messages: result.messages,
      emittedEvents: result.emittedEvents.map(String),
      movedTo: result.transition
        ? {
            surfaceId: String(result.transition),
            surfaceName: surfaceNames.get(String(result.transition)) ?? String(result.transition)
          }
        : null,
      ...(result.outcome ? { outcome: result.outcome } : {}),
      ...(cascaded.length > 0 ? { cascaded } : {})
    });
    snapshot = refused ? snapshot : result.nextState;
    if (refused && input.stopOnBlocked) {
      return { steps: results, notRun: input.steps.length - index - 1, finalState: snapshot };
    }
  }
  return { steps: results, notRun: 0, finalState: snapshot };
};
