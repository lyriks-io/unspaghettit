import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '../entities/StateDefinition';
import { asStateDefinitionId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { collectDerivedDefs, recomputeDerived } from './DerivedState';

const def = (
  path: string,
  derived?: StateDefinition['derived']
): StateDefinition => ({
  id: asStateDefinitionId(path),
  path: asStatePath(path),
  type: 'number',
  defaultValue: 0,
  ...(derived ? { derived } : {})
});

describe('recomputeDerived', () => {
  it('computes a derived sum from a sibling array', () => {
    const defs = collectDerivedDefs([
      def('cart.lines'),
      def('cart.subtotal', {
        kind: 'sum_pluck',
        operand: { kind: 'state', path: asStatePath('cart.lines') },
        field: 'amount'
      })
    ]);
    const out = recomputeDerived(
      { cart: { lines: [{ amount: 3 }, { amount: 7 }], subtotal: 0 } },
      defs
    );
    expect((out.cart as { subtotal: number }).subtotal).toBe(10);
  });

  it('settles a chain where one derived value reads another', () => {
    const defs = collectDerivedDefs([
      def('a'),
      def('b', { kind: 'add', left: { kind: 'state', path: asStatePath('a') }, right: { kind: 'literal', value: 1 } }),
      def('c', { kind: 'add', left: { kind: 'state', path: asStatePath('b') }, right: { kind: 'literal', value: 1 } })
    ]);
    // c depends on b depends on a. Declaration order here is a→b→c, but the
    // fixpoint must also settle if they were declared out of order.
    const out = recomputeDerived({ a: 10, b: 0, c: 0 }, defs);
    expect(out).toMatchObject({ a: 10, b: 11, c: 12 });
  });

  it('settles a chain declared OUT of dependency order via the fixpoint', () => {
    const defs = collectDerivedDefs([
      def('c', { kind: 'add', left: { kind: 'state', path: asStatePath('b') }, right: { kind: 'literal', value: 1 } }),
      def('b', { kind: 'add', left: { kind: 'state', path: asStatePath('a') }, right: { kind: 'literal', value: 1 } }),
      def('a')
    ]);
    const out = recomputeDerived({ a: 10, b: 0, c: 0 }, defs);
    expect(out).toMatchObject({ a: 10, b: 11, c: 12 });
  });

  it('leaves the existing fallback value when the expression cannot evaluate', () => {
    const defs = collectDerivedDefs([
      def('ratio', {
        kind: 'div',
        left: { kind: 'state', path: asStatePath('numer') },
        right: { kind: 'state', path: asStatePath('denom') }
      })
    ]);
    // denom is 0 → div short-circuits to undefined → keep the prior value.
    const out = recomputeDerived({ numer: 5, denom: 0, ratio: -1 }, defs);
    expect((out as { ratio: number }).ratio).toBe(-1);
  });

  it('is a no-op when there are no derived defs', () => {
    const snap = { x: 1 };
    expect(recomputeDerived(snap, [])).toBe(snap);
  });
});
