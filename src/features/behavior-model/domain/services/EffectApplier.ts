import type { Effect, ListItemMatch, SetStateEffect } from '../value-objects/Effect';
import {
  deepEqualValue,
  isExpression,
  resolveValueOrExpression,
  type EvaluationContext,
  type Expression
} from '../value-objects/Expression';
import { humanizeStatePath } from '../value-objects/humanize';
import type { EffectId, SurfaceId } from '../value-objects/ids';
import type { EventName } from '../value-objects/EventName';
import type { StateValue } from '../value-objects/StateValue';
import { advanceClock } from '../value-objects/SimulationClock';
import { readPath, writePath, type StateSnapshot, type StatePath } from '../value-objects/StatePath';

export type AppliedEffectRecord = {
  readonly effectId: EffectId;
  readonly type: Effect['type'];
  readonly summary: string;
};

export type EffectApplication = {
  readonly snapshot: StateSnapshot;
  readonly applied: readonly AppliedEffectRecord[];
  readonly messages: readonly { readonly tone: string; readonly text: string }[];
  readonly events: readonly EventName[];
  readonly transition: SurfaceId | null;
  readonly blocked: boolean;
  readonly blockReasons: readonly string[];
};

export type EffectContext = EvaluationContext['parameters'];
export type EffectConstants = NonNullable<EvaluationContext['constants']>;

const EMPTY_PARAMETERS: EffectContext = {};
const EMPTY_CONSTANTS: EffectConstants = {};

/**
 * Converts legacy sentinel strings written into JSON specs before the
 * Expression AST was documented. Keeps old snapshots runnable without
 * requiring a data migration.
 *
 * Sentinels:
 *   "$increment"          → selfPath + 1
 *   "$decrement"          → selfPath - 1
 *   "$param.<name>"       → param value by name
 *   "$compute.<l><op><r>" → binary arithmetic on two state paths or a path + literal
 */
const coerceSentinel = (
  value: SetStateEffect['value'],
  selfPath: StatePath
): SetStateEffect['value'] => {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  if (value === '$increment') {
    return { kind: 'add', left: { kind: 'state', path: selfPath }, right: { kind: 'literal', value: 1 } };
  }
  if (value === '$decrement') {
    return { kind: 'sub', left: { kind: 'state', path: selfPath }, right: { kind: 'literal', value: 1 } };
  }
  if (value.startsWith('$param.')) {
    return { kind: 'param', name: value.slice(7) };
  }
  if (value.startsWith('$compute.')) {
    const m = value.slice(9).match(/^([a-zA-Z_][a-zA-Z0-9_.]*)([+\-*/])([a-zA-Z0-9_.]+)$/);
    if (m) {
      const left: Expression = { kind: 'state', path: m[1] as unknown as StatePath };
      const rightNum = Number(m[3]);
      const right: Expression = isNaN(rightNum)
        ? { kind: 'state', path: m[3] as unknown as StatePath }
        : { kind: 'literal', value: rightNum };
      const opKind = ({ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' } as const)[
        m[2] as '+' | '-' | '*' | '/'
      ];
      if (opKind) return { kind: opKind, left, right } as SetStateEffect['value'];
    }
  }
  return value;
};

export const initialApplication = (snapshot: StateSnapshot): EffectApplication => ({
  snapshot,
  applied: [],
  messages: [],
  events: [],
  transition: null,
  blocked: false,
  blockReasons: []
});

const summarize = (effect: Effect): string => {
  switch (effect.type) {
    case 'set_state':
      return `set ${humanizeStatePath(effect.path)} to ${isExpression(effect.value) ? `<expr:${effect.value.kind}>` : JSON.stringify(effect.value)}`;
    case 'show_message':
      return `show "${effect.message}"`;
    case 'emit_event':
      return `emit ${effect.event}`;
    case 'block_action':
      return `block: ${effect.reason}`;
    case 'allow_action':
      return 'allow';
    case 'transition_surface':
      return `transition to surface ${effect.target}`;
    case 'append_to_list':
      return `append to ${humanizeStatePath(effect.path)}`;
    case 'remove_from_list':
      return `remove from ${humanizeStatePath(effect.path)}${effect.where ? ` where ${effect.where.field} matches` : ''}`;
    case 'update_list_item':
      return `set ${effect.field} on ${humanizeStatePath(effect.path)} items where ${effect.where.field} matches`;
    case 'advance_time':
      return `advance time by ${isExpression(effect.by) ? `<expr:${effect.by.kind}>` : JSON.stringify(effect.by)}`;
    case 'invoke_operation':
      return `invoke ${effect.operation}${effect.resultPath ? ` → ${humanizeStatePath(effect.resultPath)}` : ''}`;
  }
};

/** Read the array at `path`, or `null` when the slot is absent or not an array. */
const readArray = (snapshot: StateSnapshot, path: StatePath): readonly StateValue[] | null => {
  const current = readPath(snapshot, path);
  return Array.isArray(current) ? current : null;
};

/**
 * True when `element` is an object whose `match.field` deep-equals the
 * resolved `match.equals`. Non-object elements never match (the predicate is
 * field-based). The comparand resolves against the running snapshot + params so
 * "where productId equals the productId param" works.
 */
const elementMatches = (
  element: StateValue,
  match: ListItemMatch,
  context: EvaluationContext
): boolean => {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return false;
  const field = (element as { [k: string]: StateValue })[match.field];
  const target = resolveValueOrExpression(match.equals, context);
  return deepEqualValue(field, target);
};

/**
 * Apply an effect. `parameters` defaults to empty so existing call-sites
 * (and tests that only deal with literal effects) keep working. Pass real
 * params when the effect can use `{ kind: 'param', ... }` inside an
 * Expression-valued `set_state.value`.
 */
export const applyEffect = (
  current: EffectApplication,
  effect: Effect,
  parameters: EffectContext = EMPTY_PARAMETERS,
  constants: EffectConstants = EMPTY_CONSTANTS
): EffectApplication => {
  const record: AppliedEffectRecord = {
    effectId: effect.id,
    type: effect.type,
    summary: summarize(effect)
  };

  switch (effect.type) {
    case 'set_state': {
      // If a prior block has fired, refuse to mutate state.
      if (current.blocked) {
        return { ...current, applied: [...current.applied, record] };
      }
      // Resolve Expression values against the running snapshot + parameters.
      // When the expression cannot be evaluated (non-numeric operand, missing
      // path) we skip the write rather than poisoning the snapshot with
      // `undefined`. Invariants and follow-up rules can still observe the
      // pre-mutation state and react.
      const coerced = coerceSentinel(effect.value, effect.path);
      const resolved = resolveValueOrExpression(coerced, {
        snapshot: current.snapshot,
        parameters,
        constants
      });
      if (resolved === undefined) {
        return { ...current, applied: [...current.applied, record] };
      }
      const nextSnapshot = writePath(current.snapshot, effect.path, resolved);
      return {
        ...current,
        snapshot: nextSnapshot,
        applied: [...current.applied, record]
      };
    }
    case 'show_message': {
      return {
        ...current,
        applied: [...current.applied, record],
        messages: [
          ...current.messages,
          { tone: effect.tone ?? 'info', text: effect.message }
        ]
      };
    }
    case 'emit_event': {
      // Events fire even when blocked. Observability shouldn't disappear just
      // because a rule rejected the action. Downstream listeners want to know
      // the attempt happened.
      return {
        ...current,
        applied: [...current.applied, record],
        events: [...current.events, effect.event]
      };
    }
    case 'block_action': {
      return {
        ...current,
        applied: [...current.applied, record],
        blocked: true,
        blockReasons: [...current.blockReasons, effect.reason],
        messages: [
          ...current.messages,
          { tone: 'warning', text: effect.reason }
        ]
      };
    }
    case 'allow_action': {
      return {
        ...current,
        applied: [...current.applied, record]
      };
    }
    case 'transition_surface': {
      // First-fire-wins. A natural authoring pattern is:
      //
      //   action.rules:  if A → transition X, if B → transition Y, ...
      //   action.effects: transition Z          (the fall-through default)
      //
      // Under "last write wins" the unconditional Z silently clobbered any
      // conditional X / Y, with no signal. By keeping the first transition
      // and recording (but not applying) subsequent ones, the conditional
      // route is honoured and the fall-through naturally acts as the
      // default. The audit trail in `applied` still shows every transition
      // effect that fired, so a debugger can see what was attempted.
      //
      // Transitions still fire even when blocked so a rule can redirect
      // ("you are suspended → go to /support"). State mutations remain
      // blocked, but the redirect target records.
      if (current.transition !== null) {
        return {
          ...current,
          applied: [...current.applied, record]
        };
      }
      return {
        ...current,
        applied: [...current.applied, record],
        transition: effect.target
      };
    }
    case 'append_to_list': {
      // List mutations follow set_state's block discipline: once a rule has
      // blocked, no state lands.
      if (current.blocked) {
        return { ...current, applied: [...current.applied, record] };
      }
      const context: EvaluationContext = { snapshot: current.snapshot, parameters, constants };
      const item = resolveValueOrExpression(effect.item, context);
      // An item that can't be resolved (missing param / non-computable expr)
      // is skipped rather than pushing `undefined` and poisoning the array.
      if (item === undefined) {
        return { ...current, applied: [...current.applied, record] };
      }
      const existing = readArray(current.snapshot, effect.path) ?? [];
      const nextSnapshot = writePath(current.snapshot, effect.path, [...existing, item]);
      return { ...current, snapshot: nextSnapshot, applied: [...current.applied, record] };
    }
    case 'remove_from_list': {
      if (current.blocked) {
        return { ...current, applied: [...current.applied, record] };
      }
      const existing = readArray(current.snapshot, effect.path);
      // No array → nothing to remove. Record the attempt and move on.
      if (existing === null) {
        return { ...current, applied: [...current.applied, record] };
      }
      const context: EvaluationContext = { snapshot: current.snapshot, parameters, constants };
      let kept: readonly StateValue[];
      if (effect.where !== undefined) {
        kept = existing.filter((el) => !elementMatches(el, effect.where!, context));
      } else if (effect.value !== undefined) {
        const target = resolveValueOrExpression(effect.value, context);
        // Unresolvable comparand removes nothing (safer than removing all).
        kept =
          target === undefined ? existing : existing.filter((el) => !deepEqualValue(el, target));
      } else {
        // No selector: never implicitly clear the whole list.
        kept = existing;
      }
      const nextSnapshot = writePath(current.snapshot, effect.path, [...kept]);
      return { ...current, snapshot: nextSnapshot, applied: [...current.applied, record] };
    }
    case 'update_list_item': {
      if (current.blocked) {
        return { ...current, applied: [...current.applied, record] };
      }
      const existing = readArray(current.snapshot, effect.path);
      if (existing === null) {
        return { ...current, applied: [...current.applied, record] };
      }
      const context: EvaluationContext = { snapshot: current.snapshot, parameters, constants };
      const value = resolveValueOrExpression(effect.value, context);
      // Unresolvable value → leave every element untouched (don't write undefined).
      if (value === undefined) {
        return { ...current, applied: [...current.applied, record] };
      }
      const nextArray = existing.map((el) =>
        elementMatches(el, effect.where, context)
          ? { ...(el as { [k: string]: StateValue }), [effect.field]: value }
          : el
      );
      const nextSnapshot = writePath(current.snapshot, effect.path, nextArray);
      return { ...current, snapshot: nextSnapshot, applied: [...current.applied, record] };
    }
    case 'advance_time': {
      if (current.blocked) {
        return { ...current, applied: [...current.applied, record] };
      }
      const context: EvaluationContext = { snapshot: current.snapshot, parameters, constants };
      const by = resolveValueOrExpression(effect.by, context);
      // Non-numeric / unresolvable duration → no-op (advanceClock clamps).
      const nextSnapshot = advanceClock(current.snapshot, typeof by === 'number' ? by : 0);
      return { ...current, snapshot: nextSnapshot, applied: [...current.applied, record] };
    }
    case 'invoke_operation': {
      // Model the boundary call. When blocked, or when there is no modeled
      // result to write, record the attempt and move on. Otherwise write the
      // resolved result to resultPath, exactly like set_state, so downstream
      // rules and outcomes can branch on what the call "returned".
      if (
        current.blocked ||
        effect.resultPath === undefined ||
        effect.resultValue === undefined
      ) {
        return { ...current, applied: [...current.applied, record] };
      }
      const resolved = resolveValueOrExpression(effect.resultValue, {
        snapshot: current.snapshot,
        parameters,
        constants
      });
      if (resolved === undefined) {
        return { ...current, applied: [...current.applied, record] };
      }
      const nextSnapshot = writePath(current.snapshot, effect.resultPath, resolved);
      return { ...current, snapshot: nextSnapshot, applied: [...current.applied, record] };
    }
    default: {
      // An unrecognized effect type means malformed data slipped past the
      // Zod schema (the only legitimate route into `Effect`). Falling through
      // to `undefined` poisons the chained `applyEffect` call and surfaces as
      // a baffling "Cannot read properties of undefined (reading 'blocked')"
      // a few frames later. Throw here so the simulator response carries the
      // real cause back to the caller.
      const unknown = effect as { type?: string };
      throw new Error(
        `EffectApplier: unknown effect type "${unknown.type ?? '<missing>'}". ` +
          `Valid types: set_state, show_message, emit_event, block_action, allow_action, ` +
          `transition_surface, append_to_list, remove_from_list, update_list_item, advance_time.`
      );
    }
  }
};
