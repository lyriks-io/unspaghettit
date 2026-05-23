import type { Effect, SetStateEffect } from '../value-objects/Effect';
import {
  isExpression,
  resolveValueOrExpression,
  type EvaluationContext,
  type Expression
} from '../value-objects/Expression';
import { humanizeStatePath } from '../value-objects/humanize';
import type { EffectId, SurfaceId } from '../value-objects/ids';
import type { EventName } from '../value-objects/EventName';
import { writePath, type StateSnapshot, type StatePath } from '../value-objects/StatePath';

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

const EMPTY_PARAMETERS: EffectContext = {};

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
  }
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
  parameters: EffectContext = EMPTY_PARAMETERS
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
        parameters
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
          `Valid types: set_state, show_message, emit_event, block_action, allow_action, transition_surface.`
      );
    }
  }
};
