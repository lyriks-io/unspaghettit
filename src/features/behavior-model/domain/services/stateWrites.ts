import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import { isExpression } from '$features/behavior-model/domain/value-objects/Expression';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import { buildInitialSnapshot } from '$features/behavior-model/domain/services/StateSnapshot';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import { statesReadBy } from './conditionReads';

/**
 * One write an action can make to the state: the path, and when it writes a
 * fixed value, that value (a `set_state` of a literal). Any other write (an
 * expression, a list change, a parameter bound to the path, an operation's
 * result, time passing) can move the path to another value.
 */
export type StateWrite = {
  readonly path: string;
  readonly literal?: { readonly value: StateValue };
};

const writeOf = (effect: Effect | undefined): StateWrite | undefined => {
  if (!effect) return undefined;
  switch (effect.type) {
    case 'set_state':
      return isExpression(effect.value)
        ? { path: String(effect.path) }
        : { path: String(effect.path), literal: { value: effect.value as StateValue } };
    case 'append_to_list':
    case 'remove_from_list':
    case 'update_list_item':
      return { path: String(effect.path) };
    case 'invoke_operation':
      return effect.resultPath ? { path: String(effect.resultPath) } : undefined;
    case 'advance_time':
      return { path: 'clock.now' };
    default:
      return undefined;
  }
};

/**
 * Every write an action can make: its effects, the effects of its rules and
 * of its surface's rules, the effects of its outcomes, and the parameters bound
 * to a state path. Same reading as the prover's crossing into other features.
 */
export const stateWritesOf = (surface: Surface, action: Action): StateWrite[] => {
  const effects: (Effect | undefined)[] = [
    ...surface.rules.map((rule) => rule.effect),
    ...action.rules.map((rule) => rule.effect),
    ...action.effects,
    ...(action.outcomes ?? []).flatMap((outcome) => outcome.effects ?? [])
  ];
  const out: StateWrite[] = [];
  for (const effect of effects) {
    const write = writeOf(effect);
    if (write) out.push(write);
  }
  for (const parameter of action.parameters) {
    if (parameter.bindToStatePath) out.push({ path: String(parameter.bindToStatePath) });
  }
  return out;
};

/** Whether writing `written` can change what reading `read` returns: the same path, a parent or a child. */
export const touchesPath = (written: string, read: string): boolean =>
  written === read || read.startsWith(`${written}.`) || written.startsWith(`${read}.`);

/**
 * The state paths that decide whether an action is let through: those its
 * block rules read (its own and its surface's) and its required states.
 */
export const guardReads = (surface: Surface, action: Action): string[] => {
  const blocking = [...surface.rules, ...action.rules].filter(
    (rule) => rule.effect?.type === 'block_action'
  );
  const paths = new Set<string>();
  for (const rule of blocking) for (const path of statesReadBy(rule.condition)) paths.add(path);
  for (const path of action.requiredStates ?? []) paths.add(String(path));
  return [...paths];
};

/**
 * Whether `condition` holds on its own because of `path` at the value it has
 * in `snapshot`: a comparison that reads nothing but that path and holds, an
 * `any` with one such member, an `all` made only of them. A rule that refuses
 * this way refuses as long as the path keeps that value, whatever the rest of
 * the state; a goal whose condition fails this way stays unmet the same way.
 */
export const decidedBy = (
  condition: unknown,
  path: string,
  snapshot: StateSnapshot,
  constants: { readonly [name: string]: StateValue } = {},
  wanted = true
): boolean => {
  if (!condition || typeof condition !== 'object') return false;
  const node = condition as { kind?: string; conditions?: unknown[]; left?: unknown; operator?: unknown };
  if (node.kind === 'any' && Array.isArray(node.conditions)) {
    return wanted
      ? node.conditions.some((child) => decidedBy(child, path, snapshot, constants, true))
      : node.conditions.length > 0 && node.conditions.every((child) => decidedBy(child, path, snapshot, constants, false));
  }
  if (node.kind === 'all' && Array.isArray(node.conditions)) {
    return wanted
      ? node.conditions.length > 0 && node.conditions.every((child) => decidedBy(child, path, snapshot, constants, true))
      : node.conditions.some((child) => decidedBy(child, path, snapshot, constants, false));
  }
  if (typeof node.left !== 'string' || node.operator === undefined) return false;
  const reads = statesReadBy(condition);
  if (reads.length !== 1 || reads[0] !== path) return false;
  try {
    return evaluateCondition(condition as never, snapshot, {}, constants) === wanted;
  } catch {
    return false;
  }
};

/**
 * Whether a write moves `path` away from `startsAt`. Writing exactly the value
 * the path starts at, to the path itself, never moves it (a timer that "starts"
 * by setting its elapsed minutes to 0 does not make them grow).
 */
export const writeMoves = (write: StateWrite, path: string, startsAt: StateValue | null): boolean => {
  if (!touchesPath(write.path, path)) return false;
  if (write.path !== path || !write.literal) return true;
  return JSON.stringify(write.literal.value) !== JSON.stringify(startsAt);
};

/**
 * The warnings a behavior batch answers with when it leaves an action guarded
 * on a state nothing moves (criterion 3f9c8167 of feat-behavior-model): for
 * each action the batch added or whose rules (its own or its surface's)
 * changed, each state of the feature its guard reads that no other action of
 * the project can move from where it starts and that no persona of the
 * feature sets. Such an action can never run; the author learns it at the
 * write, not at the final check. Advisory: it never refuses anything.
 */
export const unmovedGuardWarnings = (
  before: Feature | null,
  after: Feature,
  siblings: readonly Feature[] = []
): string[] => {
  const rulesOf = (feature: Feature | null): Map<string, string> => {
    const out = new Map<string, string>();
    for (const surface of feature?.surfaces ?? []) {
      const surfaceRules = JSON.stringify(surface.rules);
      for (const action of surface.actions) {
        out.set(String(action.id), `${surfaceRules}\u0000${JSON.stringify(action.rules)}\u0000${JSON.stringify(action.requiredStates ?? [])}`);
      }
    }
    return out;
  };
  const was = rulesOf(before);
  const now = rulesOf(after);
  const declared = new Map<string, { defaultValue: StateValue; derived: boolean }>();
  for (const surface of after.surfaces) {
    for (const def of surface.stateDefinitions) {
      if (!declared.has(String(def.path))) {
        declared.set(String(def.path), {
          defaultValue: def.defaultValue as StateValue,
          derived: def.derived !== undefined
        });
      }
    }
  }
  const start = buildInitialSnapshot(after.surfaces.flatMap((surface) => surface.stateDefinitions));
  const constants: { [name: string]: StateValue } = {};
  for (const constant of after.constants ?? []) constants[constant.name] = constant.value as StateValue;
  const personaPaths = (after.personas ?? []).flatMap((persona) =>
    (persona.stateOverrides ?? []).map((override) => String(override.path))
  );
  const writers = [after, ...siblings.filter((f) => String(f.id) !== String(after.id))].flatMap((feature) =>
    feature.surfaces.flatMap((surface) =>
      surface.actions.map((action) => ({ id: String(action.id), writes: stateWritesOf(surface, action) }))
    )
  );
  const warnings: string[] = [];
  for (const surface of after.surfaces) {
    for (const action of surface.actions) {
      const key = String(action.id);
      if (was.get(key) === now.get(key)) continue;
      const blocking = [...surface.rules, ...action.rules].filter((rule) => rule.effect?.type === 'block_action');
      for (const path of guardReads(surface, action)) {
        const def = declared.get(path);
        if (!def || def.derived) continue;
        if (!blocking.some((rule) => decidedBy(rule.condition, path, start, constants))) continue;
        if (personaPaths.some((set) => touchesPath(set, path))) continue;
        const moved = writers.some(
          (writer) => writer.id !== key && writer.writes.some((write) => writeMoves(write, path, def.defaultValue))
        );
        if (moved) continue;
        warnings.push(
          `Action "${action.name}" is guarded on "${path}", which starts at ${JSON.stringify(def.defaultValue)} and that no other action of the project changes and no persona of this feature sets, while a rule of the action refuses it at that value: as modelled, the action can never run. Add what moves it: an action of a person, of the system or of a schedule (one that advances time when time is what changes it), or a persona that starts with another value.`
        );
      }
    }
  }
  return warnings;
};
