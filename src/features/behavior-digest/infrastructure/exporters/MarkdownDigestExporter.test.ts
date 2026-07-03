import { describe, expect, it } from 'vitest';
import type { DigestSpec } from '../../domain/DigestSpec';
import { markdownDigestExporter } from './MarkdownDigestExporter';

const spec: DigestSpec = {
  scope: 'feature',
  detailLevel: 'full',
  title: 'Behavioral Digest',
  purposeLine: 'Summarize any scope of the model in plain language.',
  sections: [
    {
      kind: 'capabilities',
      heading: 'What you can do here',
      lines: [
        { label: 'Generate Digest', text: 'Build a plain-language summary of the scope.', sourceElementId: 'gen' },
        { label: 'Open Export', text: 'Open the export panel.', sourceElementId: 'open' }
      ]
    },
    {
      kind: 'navigation',
      heading: 'Where you can go',
      lines: [{ text: 'Digest Panel to Digest Export (Open Export)' }]
    }
  ]
};

describe('markdownDigestExporter', () => {
  it('renders the title, purpose, section headings, and bulleted labelled lines', () => {
    const md = markdownDigestExporter.export(spec);

    expect(md).toContain('# Behavioral Digest');
    expect(md).toContain('> Summarize any scope of the model in plain language.');
    expect(md).toContain('## What you can do here');
    expect(md).toContain('- **Generate Digest**: Build a plain-language summary of the scope.');
    expect(md).toContain('## Where you can go');
    expect(md).toContain('- Digest Panel to Digest Export (Open Export)');
  });

  it('falls back to a Summary title and omits the blockquote when there is no purpose', () => {
    const md = markdownDigestExporter.export({ ...spec, title: '', purposeLine: '', sections: [] });

    expect(md).toBe('# Summary');
    expect(md).not.toContain('>');
  });

  it('renders a label-only line (a glance item) as a bold bullet with no trailing colon', () => {
    const md = markdownDigestExporter.export({
      ...spec,
      sections: [
        {
          kind: 'capabilities',
          heading: 'What you can do here',
          lines: [{ label: 'Generate Digest', text: '' }]
        }
      ]
    });

    expect(md).toContain('- **Generate Digest**');
    expect(md).not.toContain('- **Generate Digest**:');
  });

  it('renders a line\'s details as indented nested bullets under it', () => {
    const md = markdownDigestExporter.export({
      ...spec,
      sections: [
        {
          kind: 'capabilities',
          heading: 'What you can do here',
          lines: [
            {
              label: 'Generate Digest',
              text: 'Build a summary.',
              details: ['Sets Digest status to "ready"', 'Guard: Open a scope first']
            }
          ]
        }
      ]
    });

    expect(md).toContain('- **Generate Digest**: Build a summary.');
    expect(md).toContain('  - Sets Digest status to "ready"');
    expect(md).toContain('  - Guard: Open a scope first');
  });

  it('skips sections that have no lines', () => {
    const md = markdownDigestExporter.export({
      ...spec,
      sections: [{ kind: 'guardrails', heading: 'What always holds', lines: [] }]
    });

    expect(md).not.toContain('## What always holds');
  });
});
