import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import { listActionsTool } from './listActions';

describe('listActionsTool', () => {
  it('lists every action across surfaces with rule and parameter counts', () => {
    const out = listActionsTool(storefrontFeature);
    expect(out.length).toBeGreaterThanOrEqual(8);
    const addToCart = out.find((c) => c.actionName === 'Add to cart');
    expect(addToCart?.surfaceName).toBe('Catalog');
    expect(addToCart?.parameterCount).toBe(1);
    expect(addToCart?.ruleCount).toBe(2);
  });

  it('filters to a single surface when surfaceId is provided', () => {
    const out = listActionsTool(storefrontFeature, asSurfaceId('seed-shop-checkout'));
    expect(out.every((c) => c.surfaceName === 'Checkout')).toBe(true);
    expect(out.map((c) => c.actionName)).toEqual([
      'Confirm shipping address',
      'Select payment method',
      'Place order'
    ]);
  });
});
