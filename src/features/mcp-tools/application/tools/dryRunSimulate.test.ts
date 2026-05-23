import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import {
  asActionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { dryRunSimulateTool } from './dryRunSimulate';

describe('dryRunSimulateTool', () => {
  it('returns success when no rule blocks the action', () => {
    const out = dryRunSimulateTool({
      feature: storefrontFeature,
      surfaceId: asSurfaceId('seed-shop-catalog'),
      actionId: asActionId('seed-shop-cap-add-to-cart'),
      snapshot: { product: { stock: 5 }, cart: { itemCount: 0, subtotal: 0 } },
      parameters: { quantity: 1 }
    });
    expect(out.status).toBe('success');
  });

  it('returns blocked when the out-of-stock rule fires', () => {
    const out = dryRunSimulateTool({
      feature: storefrontFeature,
      surfaceId: asSurfaceId('seed-shop-catalog'),
      actionId: asActionId('seed-shop-cap-add-to-cart'),
      snapshot: { product: { stock: 0 }, cart: { itemCount: 0, subtotal: 0 } },
      parameters: { quantity: 1 }
    });
    expect(out.status).toBe('blocked');
    expect(out.messages.some((m) => /stock|cannot/i.test(m.text))).toBe(true);
  });

  it('throws a clear error when the action is on a different surface', () => {
    expect(() =>
      dryRunSimulateTool({
        feature: storefrontFeature,
        surfaceId: asSurfaceId('seed-shop-catalog'),
        actionId: asActionId('seed-shop-cap-place-order'),
        snapshot: {},
        parameters: {}
      })
    ).toThrow(/Action/);
  });
});
