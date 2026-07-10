import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getDigestTool, type GetDigestOutput } from './getDigest';

const asSpec = (out: GetDigestOutput) => {
  if (out.format !== 'spec') throw new Error('expected a spec-format digest');
  return out;
};

const featureId = String(storefrontFeature.id);

describe('getDigestTool', () => {
  it('returns the structured spec by default with the scope and a title', () => {
    const out = asSpec(
      getDigestTool({
        features: [storefrontFeature],
        scope: { kind: 'feature', featureId }
      })
    );
    expect(out.format).toBe('spec');
    expect(out.hasContent).toBe(true);
    expect(out.digest.scope).toBe('feature');
    expect(out.digest.title).toBe(storefrontFeature.name);
    expect(out.digest.sections.length).toBeGreaterThan(0);
  });

  it('narrows to one surface when a surfaceId is given', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const out = asSpec(
      getDigestTool({
        features: [storefrontFeature],
        scope: { kind: 'surface', featureId, surfaceId: String(surface.id) }
      })
    );
    expect(out.digest.scope).toBe('surface');
    expect(out.digest.title).toBe(surface.name);
  });

  it('serializes to Markdown when format=markdown, matching the spec title', () => {
    const out = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId },
      format: 'markdown'
    });
    if (out.format !== 'markdown') throw new Error('expected a markdown-format digest');
    expect(out.hasContent).toBe(true);
    expect(out.markdown.startsWith(`# ${storefrontFeature.name}`)).toBe(true);
    expect(out.markdown).toContain('## What you can do here');
  });

  it('summarizes a whole project as one line per member feature', () => {
    const project: Project = {
      id: 'proj-1' as ProjectId,
      name: 'Storefront',
      description: 'Owns the storefront feature.',
      featureIds: [storefrontFeature.id],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };
    const out = asSpec(
      getDigestTool({ features: [storefrontFeature], project, scope: { kind: 'project' } })
    );
    expect(out.digest.scope).toBe('project');
    expect(out.digest.title).toBe('Storefront');
    const features = out.digest.sections.find((s) => s.kind === 'features');
    expect(features?.lines.map((l) => l.label)).toContain(storefrontFeature.name);
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
