import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { computeFeatureMaturity } from '$features/maturity/domain/computeFeatureMaturity';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getDigestTool, type GetDigestOutput } from './getDigest';

// What each scope says is buildDigest's test, how it reads in Markdown is the
// exporter's: the tool picks the format, says whether there is content, and
// carries each feature's maturity.

const asSpec = (out: GetDigestOutput) => {
  if (out.format !== 'spec') throw new Error('expected a spec-format digest');
  return out;
};

const featureId = String(storefrontFeature.id);

describe('getDigestTool', () => {
  it('returns the structured spec by default, with content', () => {
    const out = asSpec(getDigestTool({ features: [storefrontFeature], scope: { kind: 'feature', featureId } }));
    expect(out.hasContent).toBe(true);
    expect(out.digest).toMatchObject({ scope: 'feature', title: storefrontFeature.name });
  });

  it('serializes to Markdown when format=markdown, under the spec title', () => {
    const out = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId },
      format: 'markdown'
    });
    if (out.format !== 'markdown') throw new Error('expected a markdown-format digest');
    expect(out.hasContent).toBe(true);
    expect(out.markdown.startsWith(`# ${storefrontFeature.name}\n`)).toBe(true);
  });

  it('carries the maturity of every feature it was given, the same numbers as the scorer', () => {
    const empty: Feature = { ...storefrontFeature, id: asFeatureId('empty'), name: 'Empty', surfaces: [] };
    const project: Project = {
      id: 'proj-1' as ProjectId,
      name: 'Shop',
      description: 'Two features.',
      featureIds: [storefrontFeature.id, empty.id],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };
    for (const format of ['spec', 'markdown'] as const) {
      const out = getDigestTool({ features: [storefrontFeature, empty], project, scope: { kind: 'project' }, format });
      expect(out.maturity.map((m) => [m.featureName, m.percentage, m.criticalIssueCount])).toEqual(
        [storefrontFeature, empty].map((f) => {
          const scored = computeFeatureMaturity(f);
          return [f.name, scored.percentage, scored.criticalIssues.length];
        })
      );
    }
    expect(computeFeatureMaturity(storefrontFeature).percentage).not.toBe(computeFeatureMaturity(empty).percentage);
  });

  it('reports hasContent=false for a scope that does not resolve', () => {
    const out = asSpec(
      getDigestTool({
        features: [storefrontFeature],
        scope: { kind: 'feature', featureId: 'does-not-exist' }
      })
    );
    expect(out.hasContent).toBe(false);
    expect(out.digest.sections).toEqual([]);
  });
});
