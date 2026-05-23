import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import { getSurfaceTool, type FocusedSurfaceIndex, type FocusedSurfaceVerbose } from './getSurface';

describe('getSurfaceTool', () => {
  it('returns null when the surface does not exist', () => {
    const out = getSurfaceTool(storefrontFeature, asSurfaceId('does-not-exist'), false);
    expect(out).toBeNull();
  });

  it('returns a compact index by default with counts and action summaries', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const out = getSurfaceTool(storefrontFeature, surface.id, false) as FocusedSurfaceIndex;
    expect(out).not.toBeNull();
    expect(out.surface.id).toBe(surface.id);
    expect(out.surface.stateCount).toBe(surface.stateDefinitions.length);
    expect(out.surface.ruleCount).toBe(surface.rules.length);
    expect(out.surface.invariantCount).toBe(surface.invariants.length);
    expect(out.surface.transitionCount).toBe(surface.transitions.length);
    expect(out.surface.actions).toHaveLength(surface.actions.length);
    // Compact response must NOT include nested action internals.
    expect('parameters' in out.surface.actions[0]!).toBe(false);
  });

  it('returns the full nested surface when verbose=true', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const out = getSurfaceTool(storefrontFeature, surface.id, true) as FocusedSurfaceVerbose;
    expect(out).not.toBeNull();
    expect(out.surface).toBe(surface);
    // The verbose surface still references the original actions array.
    expect(out.surface.actions[0]).toBe(surface.actions[0]);
  });
});
