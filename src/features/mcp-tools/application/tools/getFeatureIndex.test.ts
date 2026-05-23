import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { estimateTokens } from './tokenEstimate';
import { getFeatureIndexTool } from './getFeatureIndex';

describe('getFeatureIndexTool', () => {
  it('returns the navigation shape: ids, names, and counts only', () => {
    const idx = getFeatureIndexTool(storefrontFeature);
    expect(idx.id).toBe(storefrontFeature.id);
    expect(idx.surfaces.length).toBe(storefrontFeature.surfaces.length);
    for (const s of idx.surfaces) {
      // Action listings carry only id + name, never bodies.
      for (const c of s.actions) {
        expect(Object.keys(c).sort()).toEqual(['id', 'name']);
      }
      expect(typeof s.stateCount).toBe('number');
      expect(typeof s.ruleCount).toBe('number');
    }
  });

  it('is significantly smaller than the full Feature JSON', () => {
    const idx = getFeatureIndexTool(storefrontFeature);
    const fullJson = exportFeatureToJson(storefrontFeature);
    const idxTokens = estimateTokens(idx);
    const fullTokens = estimateTokens(fullJson);
    expect(idxTokens).toBeLessThan(fullTokens / 3);
  });

  it('echoes devContext when present on the feature', () => {
    const idx = getFeatureIndexTool({
      ...storefrontFeature,
      devContext: { mode: 'auto' }
    });
    expect(idx.devContext).toEqual({ mode: 'auto' });
  });
});
