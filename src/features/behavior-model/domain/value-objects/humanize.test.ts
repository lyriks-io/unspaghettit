import { describe, expect, it } from 'vitest';
import { humanizeStatePath, statePathFromName } from './humanize';
import { asStatePath } from './StatePath';

describe('humanizeStatePath', () => {
  it('splits dot-separated segments', () => {
    expect(humanizeStatePath(asStatePath('search.query'))).toBe('Search query');
    expect(humanizeStatePath(asStatePath('product.stock'))).toBe('Product stock');
  });

  it('splits camelCase segments', () => {
    expect(humanizeStatePath(asStatePath('cart.itemCount'))).toBe('Cart item count');
    expect(humanizeStatePath(asStatePath('user.emailVerified'))).toBe('User email verified');
  });

  it('handles snake_case', () => {
    expect(humanizeStatePath(asStatePath('user.has_two_factor'))).toBe('User has two factor');
  });

  it('combines multiple dot segments', () => {
    expect(humanizeStatePath(asStatePath('audit.vulnerabilityCount'))).toBe(
      'Audit vulnerability count'
    );
  });

  it('returns empty string for blank input', () => {
    expect(humanizeStatePath('')).toBe('');
  });
});

describe('statePathFromName', () => {
  it('camelCases the tail words after the namespace', () => {
    expect(statePathFromName('Selection count')).toBe('selection.count');
    expect(statePathFromName('Cart item count')).toBe('cart.itemCount');
    expect(statePathFromName('User email verified')).toBe('user.emailVerified');
    expect(statePathFromName('Audit vulnerability count')).toBe('audit.vulnerabilityCount');
  });

  it('returns single-word names unchanged (no dot)', () => {
    expect(statePathFromName('Cart')).toBe('cart');
  });

  it('passes through already-canonical paths', () => {
    expect(statePathFromName('cart.itemCount')).toBe('cart.itemCount');
    expect(statePathFromName('user.role')).toBe('user.role');
  });

  it('strips punctuation', () => {
    expect(statePathFromName('Order ID!')).toBe('order.id');
    expect(statePathFromName('Cart total ($)')).toBe('cart.total');
  });

  it('returns empty string for blank input', () => {
    expect(statePathFromName('   ')).toBe('');
  });
});
