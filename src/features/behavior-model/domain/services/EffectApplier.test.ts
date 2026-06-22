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

  describe('collection mutations', () => {
    it('append_to_list pushes onto an existing array', () => {
      const result = applyEffect(initialApplication({ cart: { lines: [{ id: 'a' }] } }), {
        id: asEffectId('e-app'),
        type: 'append_to_list',
        path: asStatePath('cart.lines'),
        item: { id: 'b' }
      });
      expect(result.snapshot).toEqual({ cart: { lines: [{ id: 'a' }, { id: 'b' }] } });
    });

    it('append_to_list seeds an empty list when the path holds no array', () => {
      const result = applyEffect(initialApplication({}), {
        id: asEffectId('e-app2'),
        type: 'append_to_list',
        path: asStatePath('cart.lines'),
        item: { id: 'a' }
      });
      expect(result.snapshot).toEqual({ cart: { lines: [{ id: 'a' }] } });
    });

    it('append_to_list resolves an Expression item against params', () => {
      const result = applyEffect(
        initialApplication({ cart: { ids: [1] } }),
        {
          id: asEffectId('e-app3'),
          type: 'append_to_list',
          path: asStatePath('cart.ids'),
          item: { kind: 'param', name: 'next' }
        },
        { next: 2 }
      );
      expect(result.snapshot).toEqual({ cart: { ids: [1, 2] } });
    });

    it('append_to_list skips an unresolvable item rather than pushing undefined', () => {
      const result = applyEffect(
        initialApplication({ cart: { ids: [1] } }),
        {
          id: asEffectId('e-app4'),
          type: 'append_to_list',
          path: asStatePath('cart.ids'),
          item: { kind: 'param', name: 'missing' }
        },
        {}
      );
      expect(result.snapshot).toEqual({ cart: { ids: [1] } });
    });

    it('remove_from_list drops object elements matching where{field,equals}', () => {
      const result = applyEffect(
        initialApplication({ cart: { lines: [{ pid: 'a' }, { pid: 'b' }, { pid: 'a' }] } }),
        {
          id: asEffectId('e-rem'),
          type: 'remove_from_list',
          path: asStatePath('cart.lines'),
          where: { field: 'pid', equals: { kind: 'param', name: 'pid' } }
        },
        { pid: 'a' }
      );
      expect(result.snapshot).toEqual({ cart: { lines: [{ pid: 'b' }] } });
    });

    it('remove_from_list drops scalar elements deep-equal to value', () => {
      const result = applyEffect(initialApplication({ tags: ['x', 'y', 'x'] }), {
        id: asEffectId('e-rem2'),
        type: 'remove_from_list',
        path: asStatePath('tags'),
        value: 'x'
      });
      expect(result.snapshot).toEqual({ tags: ['y'] });
    });

    it('remove_from_list with no selector never clears the list', () => {
      const result = applyEffect(initialApplication({ tags: ['x', 'y'] }), {
        id: asEffectId('e-rem3'),
        type: 'remove_from_list',
        path: asStatePath('tags')
      });
      expect(result.snapshot).toEqual({ tags: ['x', 'y'] });
    });

    it('update_list_item sets a field on every matching element', () => {
      const result = applyEffect(
        initialApplication({ cart: { lines: [{ pid: 'a', qty: 1 }, { pid: 'b', qty: 1 }] } }),
        {
          id: asEffectId('e-upd'),
          type: 'update_list_item',
          path: asStatePath('cart.lines'),
          where: { field: 'pid', equals: 'a' },
          field: 'qty',
          value: { kind: 'param', name: 'qty' }
        },
        { qty: 5 }
      );
      expect(result.snapshot).toEqual({
        cart: { lines: [{ pid: 'a', qty: 5 }, { pid: 'b', qty: 1 }] }
      });
    });

    it('suppresses collection mutations after a block but still records them', () => {
      const blocked = applyEffect(initialApplication({ cart: { lines: [] } }), {
        id: asEffectId('e-blk'),
        type: 'block_action',
        reason: 'nope'
      });
      const after = applyEffect(blocked, {
        id: asEffectId('e-app-blk'),
        type: 'append_to_list',
        path: asStatePath('cart.lines'),
        item: { id: 'a' }
      });
      expect(after.snapshot).toEqual({ cart: { lines: [] } });
      expect(after.applied.map((a) => a.effectId)).toContain('e-app-blk');
    });
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
