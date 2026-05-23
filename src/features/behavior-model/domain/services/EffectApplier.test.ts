import { describe, expect, it } from 'vitest';
import { asEffectId, asSurfaceId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { asEventName } from '../value-objects/EventName';
import { applyEffect, initialApplication } from './EffectApplier';

describe('EffectApplier', () => {
  it('applies set_state and updates the snapshot', () => {
    const result = applyEffect(initialApplication({ selection: { count: 3 } }), {
      id: asEffectId('e1'),
      type: 'set_state',
      path: asStatePath('selection.count'),
      value: 0
    });
    expect(result.snapshot).toEqual({ selection: { count: 0 } });
    expect(result.applied).toHaveLength(1);
    expect(result.blocked).toBe(false);
  });

  it('emits an event', () => {
    const result = applyEffect(initialApplication({}), {
      id: asEffectId('e2'),
      type: 'emit_event',
      event: asEventName('selection.deleted')
    });
    expect(result.events).toEqual(['selection.deleted']);
  });

  it('blocks state mutations after a block_action but allows observability + redirects', () => {
    const start = initialApplication({ selection: { count: 1 } });
    const blocked = applyEffect(start, {
      id: asEffectId('e3'),
      type: 'block_action',
      reason: 'Locked'
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockReasons).toContain('Locked');

    // set_state stays suppressed. The action was rejected, state must not move.
    const afterStateAttempt = applyEffect(blocked, {
      id: asEffectId('e4'),
      type: 'set_state',
      path: asStatePath('selection.count'),
      value: 0
    });
    expect(afterStateAttempt.snapshot).toEqual({ selection: { count: 1 } });

    // emit_event still fires. Observability shouldn't disappear on block.
    const afterEventAttempt = applyEffect(afterStateAttempt, {
      id: asEffectId('e5'),
      type: 'emit_event',
      event: asEventName('selection.deleted')
    });
    expect(afterEventAttempt.events).toEqual(['selection.deleted']);

    // transition_surface still fires. Useful for "redirect on block" patterns.
    const afterTransitionAttempt = applyEffect(afterEventAttempt, {
      id: asEffectId('e6'),
      type: 'transition_surface',
      target: asSurfaceId('next-surface')
    });
    expect(afterTransitionAttempt.transition).toBe('next-surface');
  });

  it('still records show_message after a block', () => {
    const start = initialApplication({});
    const blocked = applyEffect(start, {
      id: asEffectId('e6'),
      type: 'block_action',
      reason: 'No'
    });
    const withMessage = applyEffect(blocked, {
      id: asEffectId('e7'),
      type: 'show_message',
      message: 'Try again',
      tone: 'warning'
    });
    expect(withMessage.messages.map((m) => m.text)).toEqual(['No', 'Try again']);
  });

  it('throws on unknown effect.type with a useful message instead of silently returning undefined', () => {
    // Regression: a typo like {type:"block",...} (vs the correct "block_action")
    // used to fall through the switch and return undefined, then the next
    // applyEffect call would crash with "Cannot read properties of undefined
    // (reading 'blocked')". Throw here so the caller sees the real cause.
    expect(() =>
      applyEffect(initialApplication({}), {
        id: asEffectId('e-bad'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'block' as any,
        reason: 'whatever'
      })
    ).toThrowError(/unknown effect type "block"/);
  });

  it('records a surface transition target', () => {
    const result = applyEffect(initialApplication({}), {
      id: asEffectId('e8'),
      type: 'transition_surface',
      target: asSurfaceId('next-surface')
    });
    expect(result.transition).toBe('next-surface');
  });

  it('keeps the FIRST transition target when multiple transition_surface effects fire', () => {
    // Reproduces the routing-stress-test friction: a rule-driven conditional
    // transition (e.g. "if not authed, route to Auth") used to be silently
    // overwritten by an unconditional fall-through transition in
    // action.effects[]. Now the first transition wins and subsequent ones
    // are recorded in `applied` but ignored.
    let app = initialApplication({});
    app = applyEffect(app, {
      id: asEffectId('rule-routes'),
      type: 'transition_surface',
      target: asSurfaceId('auth')
    });
    app = applyEffect(app, {
      id: asEffectId('fallthrough'),
      type: 'transition_surface',
      target: asSurfaceId('success')
    });
    expect(app.transition).toBe('auth');
    // Audit trail still shows both attempts so a debugger can see the second
    // transition was attempted (and lost).
    expect(app.applied.map((a) => a.effectId)).toEqual(['rule-routes', 'fallthrough']);
  });
});
