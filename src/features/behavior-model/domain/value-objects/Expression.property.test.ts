import { describe, expect, it } from 'vitest';
import { forAll, type Rng } from '$shared/__tests__/property';
import { evaluateCondition } from '../services/RuleEvaluator';
import { evaluateExpression, type Expression } from './Expression';
import type { Operator } from './Operator';
import type { RuleCondition } from './RuleCondition';
import { asStatePath, type StateSnapshot } from './StatePath';

/**
 * The evaluator checked against the algebra it must respect, on random
 * expressions and conditions over a few numbers (some missing) and a flag:
 * De Morgan, double negation, the empty and single combinators, the
 * operator pairs that are each other's negation, and the arithmetic
 * identities that hold whenever both sides have a value. No second
 * evaluator is written: the identities are the reference.
 */

const NUMBERS = ['n.a', 'n.b', 'n.c'] as const;
const ORDER = ['greater_than', 'greater_or_equal', 'lower_than', 'lower_or_equal'] as const;

const genExpr = (rng: Rng, depth: number): Expression => {
  if (depth <= 0 || rng.chance(0.3)) {
    return rng.chance(0.5)
      ? { kind: 'literal', value: rng.int(-5, 5) }
      : { kind: 'state', path: asStatePath(rng.pick(NUMBERS)) };
  }
  const kind = rng.pick(['add', 'sub', 'mul', 'min', 'max', 'neg', 'mod', 'div', 'switch'] as const);
  if (kind === 'neg') return { kind, operand: genExpr(rng, depth - 1) };
  if (kind === 'switch') {
    return {
      kind,
      cases: [{ when: genCond(rng, depth - 1), then: genExpr(rng, depth - 1) }],
      default: genExpr(rng, depth - 1)
    };
  }
  return { kind, left: genExpr(rng, depth - 1), right: genExpr(rng, depth - 1) };
};

const genCond = (rng: Rng, depth: number): RuleCondition => {
  if (depth <= 0 || rng.chance(0.4)) {
    if (rng.chance(0.15)) return { left: asStatePath('flag'), operator: rng.pick(['is_true', 'is_false', 'exists'] as const) };
    return {
      left: asStatePath(rng.pick(NUMBERS)),
      operator: rng.pick(['equals', 'not_equals', ...ORDER] as const),
      right: genExpr(rng, depth - 1)
    };
  }
  const kind = rng.pick(['all', 'any', 'not'] as const);
  if (kind === 'not') return { kind, condition: genCond(rng, depth - 1) };
  return { kind, conditions: Array.from({ length: rng.int(0, 3) }, () => genCond(rng, depth - 1)) };
};

const genState = (rng: Rng): StateSnapshot => {
  const n: Record<string, number> = {};
  for (const path of NUMBERS) if (rng.chance(0.8)) n[path.slice(2)] = rng.int(-4, 4);
  return { n, ...(rng.chance(0.8) ? { flag: rng.chance(0.5) } : {}) };
};

const holds = (condition: RuleCondition, snapshot: StateSnapshot) => evaluateCondition(condition, snapshot);
const value = (expression: Expression, snapshot: StateSnapshot) => evaluateExpression(expression, { snapshot, parameters: {} });

const RUNS = { runs: 300, maxSize: 4 };

describe('the condition evaluator respects boolean algebra', () => {
  it('double negation, De Morgan, and the empty and single combinators', () => {
    forAll(
      { seed: 101, ...RUNS },
      (rng, size) => ({ parts: Array.from({ length: rng.int(0, 3) }, () => genCond(rng, size)), state: genState(rng) }),
      ({ parts, state }) => {
        const all: RuleCondition = { kind: 'all', conditions: parts };
        const any: RuleCondition = { kind: 'any', conditions: parts };
        const nots = parts.map((c): RuleCondition => ({ kind: 'not', condition: c }));
        expect(holds({ kind: 'not', condition: all }, state)).toBe(holds({ kind: 'any', conditions: nots }, state));
        expect(holds({ kind: 'not', condition: any }, state)).toBe(holds({ kind: 'all', conditions: nots }, state));
        expect(holds(all, state)).toBe(parts.every((c) => holds(c, state)));
        expect(holds(any, state)).toBe(parts.some((c) => holds(c, state)));
        for (const c of parts) {
          expect(holds({ kind: 'not', condition: { kind: 'not', condition: c } }, state)).toBe(holds(c, state));
          expect(holds({ kind: 'all', conditions: [c] }, state)).toBe(holds(c, state));
        }
      }
    );
  });

  it('not_equals is the negation of equals, and an order and its opposite never both hold', () => {
    forAll(
      { seed: 202, ...RUNS },
      (rng, size) => ({ left: asStatePath(rng.pick(NUMBERS)), right: genExpr(rng, size), state: genState(rng) }),
      ({ left, right, state }) => {
        const leaf = (operator: Operator): RuleCondition => ({ left, operator, right });
        expect(holds(leaf('not_equals'), state)).toBe(!holds(leaf('equals'), state));
        expect(holds(leaf('greater_than'), state) && holds(leaf('lower_or_equal'), state)).toBe(false);
        expect(holds(leaf('lower_than'), state) && holds(leaf('greater_or_equal'), state)).toBe(false);
        // Both numbers: exactly one of each opposite pair holds, and >= is > or =.
        const l = value({ kind: 'state', path: left }, state);
        const r = value(right, state);
        if (typeof l === 'number' && typeof r === 'number') {
          expect(holds(leaf('greater_than'), state)).toBe(!holds(leaf('lower_or_equal'), state));
          expect(holds(leaf('lower_than'), state)).toBe(!holds(leaf('greater_or_equal'), state));
          expect(holds(leaf('greater_or_equal'), state)).toBe(holds(leaf('greater_than'), state) || holds(leaf('equals'), state));
        } else {
          for (const operator of ORDER) expect(holds(leaf(operator), state)).toBe(false);
        }
      }
    );
  });
});

describe('the expression evaluator respects arithmetic', () => {
  it('commutes add, mul, min and max, and orders min below max, whenever both sides have a value', () => {
    forAll(
      { seed: 303, ...RUNS },
      (rng, size) => ({ a: genExpr(rng, size), b: genExpr(rng, size), state: genState(rng) }),
      ({ a, b, state }) => {
        for (const kind of ['add', 'mul', 'min', 'max'] as const) {
          expect(value({ kind, left: a, right: b }, state)).toBe(value({ kind, left: b, right: a }, state));
        }
        const x = value(a, state);
        const y = value(b, state);
        const low = value({ kind: 'min', left: a, right: b }, state);
        const high = value({ kind: 'max', left: a, right: b }, state);
        if (typeof x === 'number' && typeof y === 'number') {
          expect(low).toBe(Math.min(x, y));
          expect(high).toBe(Math.max(x, y));
          expect(value({ kind: 'sub', left: a, right: b }, state)).toBe(x - y);
          expect(value({ kind: 'neg', operand: { kind: 'neg', operand: a } }, state)).toBe(x);
          expect(value({ kind: 'add', left: { kind: 'neg', operand: a }, right: a }, state)).toBe(0);
        } else {
          // A missing operand leaves the whole operation without a value.
          expect(low).toBeUndefined();
          expect(value({ kind: 'add', left: a, right: b }, state)).toBeUndefined();
        }
      }
    );
  });

  it('takes a switch\'s first case that holds, else its default', () => {
    forAll(
      { seed: 404, ...RUNS },
      (rng, size) => ({
        cases: Array.from({ length: rng.int(1, 3) }, () => ({ when: genCond(rng, size), then: genExpr(rng, size) })),
        fallback: genExpr(rng, size),
        state: genState(rng)
      }),
      ({ cases, fallback, state }) => {
        const first = cases.find((c) => holds(c.when, state));
        expect(value({ kind: 'switch', cases, default: fallback }, state)).toBe(value(first ? first.then : fallback, state));
      }
    );
  });
});
