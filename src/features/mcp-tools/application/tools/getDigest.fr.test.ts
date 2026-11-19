import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { NBSP } from '$shared/language';
import { getDigestTool } from './getDigest';

const featureId = String(storefrontFeature.id);

describe('getDigestTool in French', () => {
  // The French sentences are buildDigest.fr's test and the French colon the
  // exporter's: here, that the tool hands the language to both.
  it('hands the language to the digest and to its Markdown', () => {
    const out = getDigestTool({
      features: [storefrontFeature],
      scope: { kind: 'feature', featureId },
      format: 'markdown',
      language: 'fr'
    });
    if (out.format !== 'markdown') throw new Error('expected a markdown-format digest');
    expect(out.markdown).toContain('## Ce que vous pouvez faire ici');
    expect(out.markdown).toContain(`**${NBSP}:`);
  });
});
