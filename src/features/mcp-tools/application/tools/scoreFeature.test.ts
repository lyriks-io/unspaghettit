import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { estimateTokens } from './tokenEstimate';
import { scoreFeatureTool, scoreFeatureFullReport } from './scoreFeature';

describe('scoreFeatureTool', () => {
  it('returns a compact summary. Never the per-check passed list', () => {
    const out = scoreFeatureTool(storefrontFeature);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.maxScore).toBeGreaterThan(0);
    expect(out.percentage).toBeLessThanOrEqual(100);
    expect(typeof out.criticalIssueCount).toBe('number');
    expect(typeof out.recommendedIssueCount).toBe('number');
    expect(typeof out.passedCheckCount).toBe('number');
    expect(Array.isArray(out.issuesByArea)).toBe(true);
    expect(Array.isArray(out.worstSurfaces)).toBe(true);
    // No issues until explicitly requested.
    expect(out.issues).toBeUndefined();
    // The full passedChecks/criticalIssues/recommendedIssues arrays must never
    // leak into a non-filter response.
    expect((out as unknown as Record<string, unknown>).criticalIssues).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).recommendedIssues).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).passedChecks).toBeUndefined();
  });

  it('appends the issue array when includeIssues:true', () => {
    const out = scoreFeatureTool(storefrontFeature, { includeIssues: true });
    expect(Array.isArray(out.issues)).toBe(true);
    // Still no passedChecks even with includeIssues. Those are dead weight.
    expect((out as unknown as Record<string, unknown>).passedChecks).toBeUndefined();
  });

  it('summary alone is dramatically smaller than the source feature JSON', () => {
    const summary = scoreFeatureTool(storefrontFeature);
    const fullJson = exportFeatureToJson(storefrontFeature);
    expect(estimateTokens(summary) * 5).toBeLessThan(estimateTokens(fullJson));
  });

  it('scopes counts AND issue array when surfaceId is provided', () => {
    const first = storefrontFeature.surfaces[0];
    if (!first) throw new Error('seed has no surfaces');
    const scoped = scoreFeatureTool(storefrontFeature, {
      surfaceId: String(first.id),
      includeIssues: true
    });
    for (const w of scoped.worstSurfaces) {
      expect(w.surfaceId).toBe(String(first.id));
    }
    for (const issue of scoped.issues ?? []) {
      expect(issue.surfaceId).toBe(String(first.id));
    }
  });

  it('filters by area', () => {
    // Pick whichever area shows up in the full summary.
    const full = scoreFeatureTool(storefrontFeature, { includeIssues: true });
    const targetArea = full.issuesByArea[0]?.area;
    if (!targetArea) return; // feature has no issues; nothing to test.
    const filtered = scoreFeatureTool(storefrontFeature, {
      area: targetArea,
      includeIssues: true
    });
    for (const issue of filtered.issues ?? []) {
      expect(issue.area).toBe(targetArea);
    }
  });

  it('filters by severity', () => {
    const out = scoreFeatureTool(storefrontFeature, {
      severity: 'recommended',
      includeIssues: true
    });
    for (const issue of out.issues ?? []) {
      expect(issue.severity).toBe('recommended');
    }
  });

  it('scoreFeatureFullReport still returns the legacy verbose shape (escape hatch for the demo page)', () => {
    const full = scoreFeatureFullReport(storefrontFeature);
    expect(Array.isArray(full.criticalIssues)).toBe(true);
    expect(Array.isArray(full.recommendedIssues)).toBe(true);
    expect(Array.isArray(full.passedChecks)).toBe(true);
  });
});
