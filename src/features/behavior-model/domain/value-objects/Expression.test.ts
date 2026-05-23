import { describe, expect, it } from 'vitest';
import {
  evaluateExpression,
  isExpression,
  normalizeExpression,
  resolveValueOrExpression,
  type Expression
} from './Expression';
import { asStatePath, type StateSnapshot } from './StatePath';

describe('Expression', () => {
  describe('isExpression', () => {
    it('matches the known AST kinds', () => {
      expect(isExpression({ kind: 'literal', value: 1 })).toBe(true);
      expect(isExpression({ kind: 'state', path: asStatePath('x') })).toBe(true);
      expect(isExpression({ kind: 'param', name: 'p' })).toBe(true);
      expect(isExpression({ kind: 'add', left: {}, right: {} })).toBe(true);
    });

    it('rejects primitives, arrays, null, and objects with unknown kinds', () => {
      expect(isExpression(1)).toBe(false);
      expect(isExpression('s')).toBe(false);
      expect(isExpression(true)).toBe(false);
      expect(isExpression(null)).toBe(false);
      expect(isExpression([])).toBe(false);
      expect(isExpression({})).toBe(false);
      expect(isExpression({ kind: 'unknown' })).toBe(false);
      expect(isExpression({ kind: 123 })).toBe(false);
    });
  });

  describe('evaluateExpression', () => {
    const snapshot: StateSnapshot = {
      player: { vx: 3, vy: 4 },
      match: { lapsToWin: 5 }
    };
    const parameters = { ax: 2, name: 'Alice' };

    it('returns literal values', () => {
      expect(
        evaluateExpression({ kind: 'literal', value: 7 }, { snapshot, parameters })
      ).toBe(7);
    });

    it('resolves state paths', () => {
      expect(
        evaluateExpression(
          { kind: 'state', path: asStatePath('player.vx') },
          { snapshot, parameters }
        )
      ).toBe(3);
    });

    it('resolves parameter references', () => {
      expect(
        evaluateExpression({ kind: 'param', name: 'ax' }, { snapshot, parameters })
      ).toBe(2);
    });

    it('computes vx + ax across state and parameters', () => {
      const expr: Expression = {
        kind: 'add',
        left: { kind: 'state', path: asStatePath('player.vx') },
        right: { kind: 'param', name: 'ax' }
      };
      expect(evaluateExpression(expr, { snapshot, parameters })).toBe(5);
    });

    it('short-circuits to undefined on non-numeric operands', () => {
      const expr: Expression = {
        kind: 'add',
        left: { kind: 'param', name: 'name' },
        right: { kind: 'literal', value: 1 }
      };
      expect(evaluateExpression(expr, { snapshot, parameters })).toBeUndefined();
    });

    it('returns undefined for divide-by-zero rather than Infinity', () => {
      const expr: Expression = {
        kind: 'div',
        left: { kind: 'literal', value: 10 },
        right: { kind: 'literal', value: 0 }
      };
      expect(evaluateExpression(expr, { snapshot, parameters })).toBeUndefined();
    });

    it('supports nested arithmetic and min/max', () => {
      const expr: Expression = {
        kind: 'min',
        left: {
          kind: 'add',
          left: { kind: 'state', path: asStatePath('player.vx') },
          right: { kind: 'state', path: asStatePath('player.vy') }
        },
        right: { kind: 'literal', value: 6 }
      };
      expect(evaluateExpression(expr, { snapshot, parameters })).toBe(6); // min(7, 6)
    });

    it('negates a numeric expression', () => {
      const expr: Expression = {
        kind: 'neg',
        operand: { kind: 'state', path: asStatePath('player.vx') }
      };
      expect(evaluateExpression(expr, { snapshot, parameters })).toBe(-3);
    });

    it('inverts a boolean state value with `not`', () => {
      const boolSnapshot: StateSnapshot = {
        log: { isPublic: false }
      };
      const flip: Expression = {
        kind: 'not',
        operand: { kind: 'state', path: asStatePath('log.isPublic') }
      };
      expect(evaluateExpression(flip, { snapshot: boolSnapshot, parameters: {} })).toBe(true);
      expect(
        evaluateExpression(flip, { snapshot: { log: { isPublic: true } }, parameters: {} })
      ).toBe(false);
    });

    it('returns undefined when `not` operand is missing', () => {
      const expr: Expression = {
        kind: 'not',
        operand: { kind: 'state', path: asStatePath('nope') }
      };
      expect(evaluateExpression(expr, { snapshot: {}, parameters: {} })).toBeUndefined();
    });

    it('sums a numeric array via `sum`', () => {
      const ctx = {
        snapshot: { shares: [10, 20, 30] } as StateSnapshot,
        parameters: {}
      };
      const expr: Expression = {
        kind: 'sum',
        operand: { kind: 'state', path: asStatePath('shares') }
      };
      expect(evaluateExpression(expr, ctx)).toBe(60);
    });

    it('returns 0 for `sum` on empty array', () => {
      const expr: Expression = {
        kind: 'sum',
        operand: { kind: 'state', path: asStatePath('shares') }
      };
      expect(
        evaluateExpression(expr, { snapshot: { shares: [] }, parameters: {} })
      ).toBe(0);
    });

    it('returns undefined for `sum` of non-array / non-numeric', () => {
      const exprStr: Expression = {
        kind: 'sum',
        operand: { kind: 'state', path: asStatePath('not_array') }
      };
      expect(
        evaluateExpression(exprStr, { snapshot: { not_array: 'hi' }, parameters: {} })
      ).toBeUndefined();
      const exprMixed: Expression = {
        kind: 'sum',
        operand: { kind: 'state', path: asStatePath('mixed') }
      };
      expect(
        evaluateExpression(exprMixed, {
          snapshot: { mixed: [1, 'two', 3] },
          parameters: {}
        })
      ).toBeUndefined();
    });

    it('counts array length via `count`', () => {
      const expr: Expression = {
        kind: 'count',
        operand: { kind: 'state', path: asStatePath('shares') }
      };
      expect(
        evaluateExpression(expr, { snapshot: { shares: [1, 2, 3, 4] }, parameters: {} })
      ).toBe(4);
      expect(
        evaluateExpression(expr, { snapshot: { shares: [] }, parameters: {} })
      ).toBe(0);
    });

    it('composes with arithmetic, sum equals amount check', () => {
      // sum(shares) - amount → used as a difference; condition `equals 0` would
      // assert the accounting equation Σ shares = amount in a single rule.
      const expr: Expression = {
        kind: 'sub',
        left: {
          kind: 'sum',
          operand: { kind: 'state', path: asStatePath('shares') }
        },
        right: { kind: 'state', path: asStatePath('amount') }
      };
      expect(
        evaluateExpression(expr, {
          snapshot: { shares: [30, 30, 40], amount: 100 },
          parameters: {}
        })
      ).toBe(0);
      expect(
        evaluateExpression(expr, {
          snapshot: { shares: [30, 30, 30], amount: 100 },
          parameters: {}
        })
      ).toBe(-10);
    });

    it('sum_pluck sums a field across an array of objects', () => {
      const expr: Expression = {
        kind: 'sum_pluck',
        operand: { kind: 'state', path: asStatePath('shares') },
        field: 'amount'
      };
      expect(
        evaluateExpression(expr, {
          snapshot: {
            shares: [
              { userId: 'a', amount: 30 },
              { userId: 'b', amount: 70 }
            ]
          },
          parameters: {}
        })
      ).toBe(100);
      // Missing field on one element → undefined (not silently zero).
      expect(
        evaluateExpression(expr, {
          snapshot: {
            shares: [{ userId: 'a', amount: 30 }, { userId: 'b' }]
          },
          parameters: {}
        })
      ).toBeUndefined();
    });

    it('count_where counts elements whose field equals a value', () => {
      const expr: Expression = {
        kind: 'count_where',
        operand: { kind: 'state', path: asStatePath('apps') },
        field: 'status',
        equals: { kind: 'literal', value: 'enrolled' }
      };
      const apps = [
        { id: '1', status: 'enrolled' },
        { id: '2', status: 'waitlisted' },
        { id: '3', status: 'enrolled' },
        { id: '4', status: 'dropped' }
      ];
      expect(evaluateExpression(expr, { snapshot: { apps }, parameters: {} })).toBe(2);
    });

    it('switch picks the first matching case, falls through to default', () => {
      // The Cohorty case: status='enrolled' if enrolledCount < capacity, else 'waitlisted'.
      const expr: Expression = {
        kind: 'switch',
        cases: [
          {
            when: {
              left: asStatePath('enrolledCount'),
              operator: 'lower_than',
              right: { kind: 'state', path: asStatePath('capacity') }
            },
            then: { kind: 'literal', value: 'enrolled' }
          }
        ],
        default: { kind: 'literal', value: 'waitlisted' }
      };
      expect(
        evaluateExpression(expr, {
          snapshot: { enrolledCount: 5, capacity: 10 },
          parameters: {}
        })
      ).toBe('enrolled');
      expect(
        evaluateExpression(expr, {
          snapshot: { enrolledCount: 10, capacity: 10 },
          parameters: {}
        })
      ).toBe('waitlisted');
    });

    it('switch handles composite conditions in `when`', () => {
      const expr: Expression = {
        kind: 'switch',
        cases: [
          {
            when: {
              kind: 'all',
              conditions: [
                { left: asStatePath('mode'), operator: 'equals', right: 'premium' },
                { left: asStatePath('credits'), operator: 'greater_than', right: 0 }
              ]
            },
            then: { kind: 'literal', value: 'allowed' }
          }
        ],
        default: { kind: 'literal', value: 'blocked' }
      };
      expect(
        evaluateExpression(expr, {
          snapshot: { mode: 'premium', credits: 5 },
          parameters: {}
        })
      ).toBe('allowed');
      expect(
        evaluateExpression(expr, {
          snapshot: { mode: 'premium', credits: 0 },
          parameters: {}
        })
      ).toBe('blocked');
      expect(
        evaluateExpression(expr, {
          snapshot: { mode: 'free', credits: 100 },
          parameters: {}
        })
      ).toBe('blocked');
    });
  });

  describe('normalizeExpression', () => {
    it('passes top-level raw literals through untouched (literal slot)', () => {
      expect(normalizeExpression(5)).toBe(5);
      expect(normalizeExpression('hi')).toBe('hi');
      expect(normalizeExpression(undefined)).toBeUndefined();
      expect(normalizeExpression(null)).toBeNull();
    });

    it('wraps raw scalar children of arithmetic nodes as literal expressions', () => {
      const input = {
        kind: 'add',
        left: { kind: 'state', path: 'x' },
        right: 1
      } as unknown as Expression;
      expect(normalizeExpression(input)).toEqual({
        kind: 'add',
        left: { kind: 'state', path: 'x' },
        right: { kind: 'literal', value: 1 }
      });
    });

    it('wraps raw scalar operand of a neg node', () => {
      const input = { kind: 'neg', operand: 7 } as unknown as Expression;
      expect(normalizeExpression(input)).toEqual({
        kind: 'neg',
        operand: { kind: 'literal', value: 7 }
      });
    });

    it('wraps raw scalar operand of a not node', () => {
      const input = { kind: 'not', operand: true } as unknown as Expression;
      expect(normalizeExpression(input)).toEqual({
        kind: 'not',
        operand: { kind: 'literal', value: true }
      });
    });

    it('recurses into nested arithmetic so deep children are also normalized', () => {
      const input = {
        kind: 'sub',
        left: {
          kind: 'add',
          left: { kind: 'state', path: 'a' },
          right: { kind: 'mul', left: { kind: 'state', path: 'b' }, right: 2 }
        },
        right: 0
      } as unknown as Expression;
      expect(normalizeExpression(input)).toEqual({
        kind: 'sub',
        left: {
          kind: 'add',
          left: { kind: 'state', path: 'a' },
          right: {
            kind: 'mul',
            left: { kind: 'state', path: 'b' },
            right: { kind: 'literal', value: 2 }
          }
        },
        right: { kind: 'literal', value: 0 }
      });
    });

    it('is idempotent on already-normalized trees', () => {
      const normalized: Expression = {
        kind: 'add',
        left: { kind: 'state', path: 'x' as never },
        right: { kind: 'literal', value: 1 }
      };
      expect(normalizeExpression(normalized)).toEqual(normalized);
    });

    it('leaves literal/state/param leaves untouched', () => {
      const literal: Expression = { kind: 'literal', value: 9 };
      const stateExpr: Expression = { kind: 'state', path: 'p' as never };
      const param: Expression = { kind: 'param', name: 'x' };
      expect(normalizeExpression(literal)).toBe(literal);
      expect(normalizeExpression(stateExpr)).toBe(stateExpr);
      expect(normalizeExpression(param)).toBe(param);
    });
  });

  describe('resolveValueOrExpression', () => {
    it('returns literal values untouched', () => {
      expect(
        resolveValueOrExpression(5, { snapshot: {}, parameters: {} })
      ).toBe(5);
      expect(
        resolveValueOrExpression('hello', { snapshot: {}, parameters: {} })
      ).toBe('hello');
    });

    it('returns undefined for undefined inputs', () => {
      expect(
        resolveValueOrExpression(undefined, { snapshot: {}, parameters: {} })
      ).toBeUndefined();
    });

    it('evaluates expression inputs', () => {
      expect(
        resolveValueOrExpression(
          { kind: 'param', name: 'x' },
          { snapshot: {}, parameters: { x: 42 } }
        )
      ).toBe(42);
    });
  });
});
