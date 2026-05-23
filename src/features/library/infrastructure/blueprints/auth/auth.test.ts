import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { scoreFeatureBreakdown, scoreSurface } from '$features/maturity/domain/MaturityScorer';
import { applyBlueprints } from '../../../domain/services/BlueprintApplier';
import { authBlueprints } from './index';

let counter = 0;
const ids = () => `t-${counter++}`;

const emptyFeature = (): Feature => ({
  id: asFeatureId('test-exp'),
  name: 'Test',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z'
});

describe('auth library blueprints', () => {
  it('every blueprint scores 100% maturity in isolation', () => {
    for (const blueprint of authBlueprints) {
      counter = 0;
      const result = blueprint.build({
        ids,
        ownSurfaceId: asSurfaceId('own'),
        linkTargets: new Map()
      });
      const report = scoreSurface(result.surface);
      expect(
        report.percentage,
        `${blueprint.name} maturity: missing checks → ${report.criticalIssues
          .concat(report.recommendedIssues)
          .map((i) => `${i.area}: ${i.message}`)
          .join('; ')}`
      ).toBe(100);
    }
  });

  it('the full quad applied together still scores 100% as a whole', () => {
    counter = 0;
    const { feature: applied } = applyBlueprints(emptyFeature(), authBlueprints, ids);
    const breakdown = scoreFeatureBreakdown(applied);
    expect(breakdown.global.percentage).toBe(100);
    expect(applied.surfaces).toHaveLength(authBlueprints.length);
  });

  it('wires sibling transitions between Sign in and Sign up when applied together', () => {
    counter = 0;
    const { feature: applied } = applyBlueprints(emptyFeature(), authBlueprints, ids);
    const signIn = applied.surfaces.find((s) => s.name === 'Sign in');
    const signUp = applied.surfaces.find((s) => s.name === 'Sign up');
    expect(signIn).toBeDefined();
    expect(signUp).toBeDefined();
    expect(signIn?.transitions.some((t) => t.target === signUp?.id)).toBe(true);
    expect(signUp?.transitions.some((t) => t.target === signIn?.id)).toBe(true);
  });

  it('skips sibling transitions when only one blueprint is applied', () => {
    counter = 0;
    const { feature: applied } = applyBlueprints(
      emptyFeature(),
      [authBlueprints[0]!],
      ids
    );
    const surface = applied.surfaces[0];
    expect(surface).toBeDefined();
    expect(surface?.transitions).toHaveLength(0);
  });

  it('dedupes shared resources across the quad by name', () => {
    counter = 0;
    const { feature: applied } = applyBlueprints(emptyFeature(), authBlueprints, ids);
    const names = applied.resources.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Users (Postgres)');
  });

  it('dedupes personas across the quad by name', () => {
    counter = 0;
    const { feature: applied } = applyBlueprints(emptyFeature(), authBlueprints, ids);
    const names = applied.personas.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Anonymous visitor');
    expect(names).toContain('Authenticated user');
  });

  it('dedupes personas across separate apply calls (no growth on second import)', () => {
    counter = 0;
    const first = applyBlueprints(emptyFeature(), [authBlueprints[0]!], ids);
    const personasAfterFirst = first.feature.personas.length;
    const second = applyBlueprints(first.feature, [authBlueprints[1]!], ids);
    expect(second.feature.personas.length).toBe(personasAfterFirst);
  });
});
