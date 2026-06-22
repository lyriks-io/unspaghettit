import { describe, expect, it } from 'vitest';
import { asStatePath } from '../value-objects/StatePath';
import { evaluateCondition } from './RuleEvaluator';

const path = (s: string) => asStatePath(s);

describe('evaluateCondition', () => {
  const snapshot = {
    selection: { count: 0, locked: false, ids: ['a', 'b'] },
    user: { role: 'editor' }
  };

  it('handles equals / not_equals on primitives', () => {
    expect(
      evaluateCondition({ left: path('selection.count'), operator: 'equals', right: 0 }, snapshot)
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('user.role'), operator: 'not_equals', right: 'viewer' },
        snapshot
      )
    ).toBe(true);
  });

  it('handles greater_than / lower_than only for numbers', () => {
    expect(
      evaluateCondition(
        { left: path('selection.count'), operator: 'greater_than', right: -1 },
        snapshot
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('selection.count'), operator: 'lower_than', right: 5 },
        snapshot
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('user.role'), operator: 'greater_than', right: 0 },
        snapshot
      )
    ).toBe(false);
  });

  it('compares ISO date strings chronologically with lower_than / greater_than', () => {
    const dateSnap = {
      trip: { startDate: '2026-06-17', endDate: '2026-06-15', when: '2026-06-15T08:30:00Z' }
    };
    expect(
      evaluateCondition(
        { left: path('trip.endDate'), operator: 'lower_than', right: '2026-06-17' },
        dateSnap
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('trip.startDate'), operator: 'greater_than', right: '2026-06-15' },
        dateSnap
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('trip.when'), operator: 'lower_than', right: '2026-06-16T00:00:00Z' },
        dateSnap
      )
    ).toBe(true);
    // Non-ISO strings still fall through to "false" instead of producing a
    // lexicographic surprise on arbitrary text.
    expect(
      evaluateCondition(
        { left: path('user.role'), operator: 'lower_than', right: 'zzz' },
        { user: { role: 'editor' } }
      )
    ).toBe(false);
  });

  it('handles is_true / is_false', () => {
    expect(
      evaluateCondition({ left: path('selection.locked'), operator: 'is_false' }, snapshot)
    ).toBe(true);
    expect(
      evaluateCondition({ left: path('selection.locked'), operator: 'is_true' }, snapshot)
    ).toBe(false);
  });

  it('handles exists / does_not_exist', () => {
    expect(
      evaluateCondition({ left: path('user.role'), operator: 'exists' }, snapshot)
    ).toBe(true);
    expect(
      evaluateCondition({ left: path('user.email'), operator: 'does_not_exist' }, snapshot)
    ).toBe(true);
  });

  it('handles contains for arrays and strings', () => {
    expect(
      evaluateCondition(
        { left: path('selection.ids'), operator: 'contains', right: 'a' },
        snapshot
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { left: path('user.role'), operator: 'contains', right: 'edit' },
        snapshot
      )
    ).toBe(true);
  });

  it('treats undefined / null condition as always true (unconditional rule)', () => {
    expect(evaluateCondition(undefined, snapshot)).toBe(true);
    expect(evaluateCondition(null, snapshot)).toBe(true);
  });

  it('composes leaf conditions with `all` (AND), short-circuiting on false', () => {
    const allTrue = {
      kind: 'all' as const,
      conditions: [
        { left: path('selection.count'), operator: 'equals' as const, right: 0 },
        { left: path('user.role'), operator: 'equals' as const, right: 'editor' }
      ]
    };
    expect(evaluateCondition(allTrue, snapshot)).toBe(true);

    const oneFalse = {
      kind: 'all' as const,
      conditions: [
        { left: path('selection.count'), operator: 'equals' as const, right: 0 },
        { left: path('user.role'), operator: 'equals' as const, right: 'viewer' }
      ]
    };
    expect(evaluateCondition(oneFalse, snapshot)).toBe(false);

    // Empty `all` is vacuously true.
    expect(
      evaluateCondition({ kind: 'all', conditions: [] }, snapshot)
    ).toBe(true);
  });

  it('composes leaf conditions with `any` (OR)', () => {
    const oneTrue = {
      kind: 'any' as const,
      conditions: [
        { left: path('user.role'), operator: 'equals' as const, right: 'viewer' },
        { left: path('user.role'), operator: 'equals' as const, right: 'editor' }
      ]
    };
    expect(evaluateCondition(oneTrue, snapshot)).toBe(true);

    const allFalse = {
      kind: 'any' as const,
      conditions: [
        { left: path('user.role'), operator: 'equals' as const, right: 'viewer' },
        { left: path('user.role'), operator: 'equals' as const, right: 'admin' }
      ]
    };
    expect(evaluateCondition(allFalse, snapshot)).toBe(false);

    // Empty `any` is vacuously false.
    expect(
      evaluateCondition({ kind: 'any', conditions: [] }, snapshot)
    ).toBe(false);
  });

  it('negates with `not`', () => {
    const truthy = {
      left: path('user.role'),
      operator: 'equals' as const,
      right: 'editor'
    };
    expect(evaluateCondition({ kind: 'not', condition: truthy }, snapshot)).toBe(false);
    const falsy = {
      left: path('user.role'),
      operator: 'equals' as const,
      right: 'viewer'
    };
    expect(evaluateCondition({ kind: 'not', condition: falsy }, snapshot)).toBe(true);
  });

  it('composes mixed nestings (implication via any/not)', () => {
    // "if role=editor then count=0" ≡ "any: [not(role=editor), count=0]"
    const implication = {
      kind: 'any' as const,
      conditions: [
        {
          kind: 'not' as const,
          condition: {
            left: path('user.role'),
            operator: 'equals' as const,
            right: 'editor'
          }
        },
        { left: path('selection.count'), operator: 'equals' as const, right: 0 }
      ]
    };
    expect(evaluateCondition(implication, snapshot)).toBe(true);
    // Falsifier: role=editor AND count != 0.
    const falsified = {
      ...snapshot,
      selection: { ...snapshot.selection, count: 3 }
    };
    expect(evaluateCondition(implication, falsified)).toBe(false);
  });

  it('all_match over a scalar array reads the element via the bound name', () => {
    // selection.ids = ['a','b']; assert every id is a non-empty string-ish
    // value by checking it exists.
    const cond = {
      kind: 'all_match' as const,
      overPath: path('selection.ids'),
      as: 'id',
      where: { left: path('id'), operator: 'exists' as const }
    };
    expect(evaluateCondition(cond, snapshot)).toBe(true);
  });

  it('quantifier body can compare an element field to an OUTER state path', () => {
    const snap = {
      config: { minQty: 2 },
      cart: { lines: [{ qty: 2 }, { qty: 5 }] }
    };
    // every line.qty >= config.minQty (expressed as NOT lower_than)
    const cond = {
      kind: 'all_match' as const,
      overPath: path('cart.lines'),
      as: 'line',
      where: {
        kind: 'not' as const,
        condition: {
          left: path('line.qty'),
          operator: 'lower_than' as const,
          right: { kind: 'state' as const, path: path('config.minQty') }
        }
      }
    };
    expect(evaluateCondition(cond, snap)).toBe(true);
    // Drop one line below the threshold → fails.
    expect(
      evaluateCondition(cond, { config: { minQty: 2 }, cart: { lines: [{ qty: 1 }] } })
    ).toBe(false);
  });
});
