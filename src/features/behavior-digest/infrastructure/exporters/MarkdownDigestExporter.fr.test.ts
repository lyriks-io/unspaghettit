import { describe, expect, it } from 'vitest';
import { NBSP } from '$shared/language';
import type { DigestSpec } from '../../domain/DigestSpec';
import { markdownDigestExporter } from './MarkdownDigestExporter';

const spec: DigestSpec = {
  scope: 'feature',
  detailLevel: 'full',
  title: 'Behavioral Digest',
  purposeLine: 'Summarize any scope of the model: in plain language.',
  sections: [
    {
      kind: 'capabilities',
      heading: 'Ce que vous pouvez faire ici',
      lines: [
        {
          label: 'Generate Digest',
          text: 'Build a summary: fast.',
          details: [`Garde${NBSP}: Open a scope first.`]
        },
        { label: 'Open Export', text: '' }
      ]
    }
  ]
};

describe('markdownDigestExporter in French', () => {
  it('puts a no-break space before the colon it writes and keeps model text verbatim', () => {
    const md = markdownDigestExporter.export(spec, 'fr');
    expect(md).toBe(
      [
        '# Behavioral Digest',
        '> Summarize any scope of the model: in plain language.',
        '## Ce que vous pouvez faire ici',
        [
          `- **Generate Digest**${NBSP}: Build a summary: fast.`,
          `  - Garde${NBSP}: Open a scope first.`,
          '- **Open Export**'
        ].join('\n')
      ].join('\n\n')
    );
  });

  it('falls back to a French title', () => {
    expect(markdownDigestExporter.export({ ...spec, title: '', sections: [] }, 'fr')).toBe(
      '# Résumé\n\n> Summarize any scope of the model: in plain language.'
    );
  });

  it('stays English when no language is given', () => {
    const md = markdownDigestExporter.export({ ...spec, title: '' });
    expect(md.startsWith('# Summary')).toBe(true);
    expect(md).toContain('- **Generate Digest**: Build a summary: fast.');
  });
});
