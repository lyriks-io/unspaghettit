import { describe, expect, it } from 'vitest';
import { toSlug } from './slug';

describe('toSlug', () => {
  it('lowercases and dasherizes spaces', () => {
    expect(toSlug('Add to cart')).toBe('add-to-cart');
  });

  it('collapses runs of non-alphanumerics into a single dash', () => {
    expect(toSlug('Sign in / sign up')).toBe('sign-in-sign-up');
  });

  it('trims surrounding dashes and whitespace', () => {
    expect(toSlug('  Multi   spaces  ')).toBe('multi-spaces');
  });

  it('returns an empty string for blank input', () => {
    expect(toSlug('   ')).toBe('');
  });
});
