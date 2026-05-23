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
});
