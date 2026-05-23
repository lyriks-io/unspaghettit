import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import {
  ALL_NEIGHBORHOOD_EDGE_KINDS,
  getNeighborhoodTool
} from './getNeighborhood';

describe('getNeighborhoodTool', () => {
  it('returns null when the root key does not exist', () => {
    const out = getNeighborhoodTool(
      storefrontFeature,
      'action:does-not-exist',
      1,
      ALL_NEIGHBORHOOD_EDGE_KINDS
    );
    expect(out).toBeNull();
  });

  it('returns just the root at depth 0 conceptually (BFS yields root + 0 hops)', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const out = getNeighborhoodTool(
      storefrontFeature,
      `surface:${String(surface.id)}`,
      1,
      []
    );
    expect(out).not.toBeNull();
    // edgeKinds = [] filters out every edge → only the root is reached.
    expect(out!.nodes.map((n) => n.key)).toEqual([`surface:${String(surface.id)}`]);
    expect(out!.edges).toEqual([]);
  });

  it('walks one hop and includes actions + state defs the surface contains', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const out = getNeighborhoodTool(
      storefrontFeature,
      `surface:${String(surface.id)}`,
      1,
      ALL_NEIGHBORHOOD_EDGE_KINDS
    );
    expect(out).not.toBeNull();
    const capabilityKeys = out!.nodes
      .filter((n) => n.type === 'action')
      .map((n) => n.key);
    for (const cap of surface.actions) {
      expect(capabilityKeys).toContain(`action:${String(cap.id)}`);
    }
  });

  it('filters by edge kind: actions writing to a state are the only ones reached via "writes"', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const writeTarget = surface.stateDefinitions[0];
    if (!writeTarget) return; // some surfaces have no states
    const out = getNeighborhoodTool(
      storefrontFeature,
      `state:${String(writeTarget.path)}`,
      1,
      ['writes']
    );
    expect(out).not.toBeNull();
    // Every non-root node returned must be reachable via an actual writes
    // edge from the state. We assert no reads/emits/contains/etc snuck in.
    expect(out!.edges.every((e) => e.kind === 'writes')).toBe(true);
  });

  it('records BFS distance from the root', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const rootKey = `surface:${String(surface.id)}`;
    const out = getNeighborhoodTool(
      storefrontFeature,
      rootKey,
      2,
      ALL_NEIGHBORHOOD_EDGE_KINDS
    );
    expect(out).not.toBeNull();
    expect(out!.distances[rootKey]).toBe(0);
    // Every other reached node must be at distance 1 or 2.
    for (const [key, dist] of Object.entries(out!.distances)) {
      if (key === rootKey) continue;
      expect(dist).toBeGreaterThanOrEqual(1);
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  it('respects the depth bound: depth 1 never reaches grandchildren', () => {
    // Walk from the feature root: depth 1 reaches surfaces (via contains).
    // Actions are 2 hops away (feature → surface → action), so
    // they must not appear at depth 1.
    const out = getNeighborhoodTool(
      storefrontFeature,
      `feature:${String(storefrontFeature.id)}`,
      1,
      ['contains']
    );
    expect(out).not.toBeNull();
    const reachedTypes = new Set(out!.nodes.map((n) => n.type));
    expect(reachedTypes.has('feature')).toBe(true);
    expect(reachedTypes.has('surface')).toBe(true);
    expect(reachedTypes.has('action')).toBe(false);
  });
});
