import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { NBSP } from '$shared/language';
import { getDigestTool } from './getDigest';

const featureId = String(storefrontFeature.id);

describe('getDigestTool in French', () => {
  it('writes the markdown digest the platform asks for in French', () => {
    const out = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId },
      detailLevel: 'full',
      format: 'markdown',
      language: 'fr'
    });
    if (out.format !== 'markdown') throw new Error('expected a markdown-format digest');
    expect(out.hasContent).toBe(true);
    expect(out.markdown.startsWith(`# ${storefrontFeature.name}`)).toBe(true);
    expect(out.markdown).toContain('## Ce que vous pouvez faire ici');
    expect(out.markdown).not.toContain('## What you can do here');
    expect(out.markdown).not.toMatch(/\*\*:/);
    expect(out.markdown).not.toMatch(/\b(Guard|Emits|Sets|Updates|Reachable|Fired by)\b/);
    // A labelled line's colon is written the French way.
    expect(out.markdown).toContain(`**${NBSP}:`);
  });

  it('keeps the structured spec identical in shape and English by default', () => {
    const fr = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId },
      language: 'fr'
    });
    const en = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId }
    });
    if (fr.format !== 'spec' || en.format !== 'spec') throw new Error('expected spec digests');
    expect(fr.digest.sections.map((s) => s.kind)).toEqual(en.digest.sections.map((s) => s.kind));
    expect(fr.maturity).toEqual(en.maturity);
    expect(en.digest.sections[0]?.heading).toBe('What you can do here');
  });
});
