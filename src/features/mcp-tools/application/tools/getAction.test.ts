import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { asActionId } from '$features/behavior-model/domain/value-objects/ids';
import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { getActionTool } from './getAction';
import { estimateTokens } from './tokenEstimate';

describe('getActionTool', () => {
  it('returns null when the action does not exist', () => {
    const out = getActionTool(storefrontFeature, asActionId('nope'));
    expect(out).toBeNull();
  });

  it('returns the action with its enclosing surface metadata', () => {
    const out = getActionTool(storefrontFeature, asActionId('seed-shop-cap-add-to-cart'));
    expect(out).not.toBeNull();
    expect(out?.surfaceName).toBe('Catalog');
    expect(out?.action.name).toBe('Add to cart');
    expect(out?.action.parameters.map((p) => p.name)).toEqual(['quantity']);
  });

  it('includes only the StateDefinitions touched by the action', () => {
    const out = getActionTool(storefrontFeature, asActionId('seed-shop-cap-add-to-cart'));
    const linkedPaths = (out?.linkedStateDefinitions ?? []).map((d) => String(d.path)).sort();
    expect(linkedPaths).toEqual(['cart.itemCount', 'cart.subtotal', 'product.stock']);
  });

  it('produces a substantially smaller output than the full feature (the thesis)', () => {
    const focused = getActionTool(
      storefrontFeature,
      asActionId('seed-shop-cap-add-to-cart')
    );
    const full = exportFeatureToJson(storefrontFeature);

    const focusedTokens = estimateTokens(focused);
    const fullTokens = estimateTokens(full);

    expect(focusedTokens).toBeLessThan(fullTokens / 4);
  });
});
