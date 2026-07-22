import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { summarizeFeature } from './featureSummary';

describe('summarizeFeature', () => {
  it('counts what the project sidebar totals, without loading a full feature', () => {
    const summary = summarizeFeature(storefrontFeature);
    const surfaces = storefrontFeature.surfaces;
    expect(summary.surfaceCount).toBe(surfaces.length);
    expect(summary.actionCount).toBe(
      surfaces.reduce((n, s) => n + s.actions.length, 0)
    );
    expect(summary.stateCount).toBe(
      surfaces.reduce((n, s) => n + s.stateDefinitions.length, 0)
    );
    expect(summary.surfaceRuleCount).toBe(surfaces.reduce((n, s) => n + s.rules.length, 0));
    expect(summary.personaCount).toBe(storefrontFeature.personas.length);
  });

  it('is what the repository returns, so a client sees the same numbers', async () => {
    // The sidebar answers its counters from `list()` while the per-feature
    // fetches are still in flight; if an adapter built its own summary the
    // counts could differ from the panel they label.
    const repo = new InMemoryFeatureRepository();
    await repo.save(storefrontFeature);
    const [row] = await repo.list();
    expect(row).toEqual(summarizeFeature(storefrontFeature));
  });

  it('counts an empty feature as zero rather than omitting the fields', () => {
    const summary = summarizeFeature({ ...storefrontFeature, surfaces: [], personas: [] });
    expect(summary.surfaceCount).toBe(0);
    expect(summary.actionCount).toBe(0);
    expect(summary.stateCount).toBe(0);
    expect(summary.surfaceRuleCount).toBe(0);
    expect(summary.personaCount).toBe(0);
  });
});
