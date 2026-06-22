import { describe, expect, it } from 'vitest';
import type { Invariant } from '../entities/Invariant';
import { asInvariantId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { checkInvariants } from './InvariantChecker';

const invariant = (
  name: string,
  condition: Invariant['condition'],
  message = 'violated'
): Invariant => ({
  id: asInvariantId(name),
  name,
  condition,
  message
});

describe('checkInvariants', () => {
  it('returns no violations when conditions hold', () => {
    const inv = invariant('non-negative count', {
      left: asStatePath('selection.count'),
      operator: 'greater_than',
      right: -1
    });
    const violations = checkInvariants([inv], { selection: { count: 0 } });
    expect(violations).toHaveLength(0);
  });

  it('returns violations when conditions break', () => {
    const inv = invariant('cap', {
      left: asStatePath('quota.used'),
      operator: 'lower_than',
      right: 10
    });
    const violations = checkInvariants([inv], { quota: { used: 11 } });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.invariantName).toBe('cap');
  });

  describe('all_match quantifier — per-element invariants', () => {
    const everyLinePositive = invariant('every line qty > 0', {
      kind: 'all_match',
      overPath: asStatePath('order.lines'),
      as: 'line',
      where: { left: asStatePath('line.qty'), operator: 'greater_than', right: 0 }
    });

    it('holds when every element satisfies the body', () => {
      const violations = checkInvariants([everyLinePositive], {
        order: { lines: [{ qty: 1 }, { qty: 3 }] }
      });
      expect(violations).toHaveLength(0);
    });

    it('is violated when any single element fails', () => {
      const violations = checkInvariants([everyLinePositive], {
        order: { lines: [{ qty: 1 }, { qty: 0 }] }
      });
      expect(violations.map((v) => v.invariantName)).toEqual(['every line qty > 0']);
    });

    it('is vacuously true over a missing or empty array', () => {
      expect(checkInvariants([everyLinePositive], { order: { lines: [] } })).toHaveLength(0);
      expect(checkInvariants([everyLinePositive], {})).toHaveLength(0);
    });
  });

  describe('any_match quantifier', () => {
    const someLineFree = invariant('at least one free line', {
      kind: 'any_match',
      overPath: asStatePath('order.lines'),
      as: 'line',
      where: { left: asStatePath('line.price'), operator: 'equals', right: 0 }
    });

    it('holds when at least one element matches', () => {
      const violations = checkInvariants([someLineFree], {
        order: { lines: [{ price: 5 }, { price: 0 }] }
      });
      expect(violations).toHaveLength(0);
    });

    it('fails when no element matches (and is false over an empty array)', () => {
      expect(
        checkInvariants([someLineFree], { order: { lines: [{ price: 5 }] } })
      ).toHaveLength(1);
      expect(checkInvariants([someLineFree], { order: { lines: [] } })).toHaveLength(1);
    });
  });
});
