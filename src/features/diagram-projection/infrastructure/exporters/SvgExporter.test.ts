import { describe, expect, it } from 'vitest';
import type { DiagramSpec } from '../../domain/DiagramSpec';
import { svgExporter } from './SvgExporter';

const spec: DiagramSpec = {
  format: 'statechart',
  title: 'Checkout',
  nodes: [
    { id: 'a', label: 'Cart' },
    { id: 'b', label: 'Payment' }
  ],
  edges: [{ from: 'a', to: 'b', label: 'Pay' }]
};

describe('svgExporter', () => {
  it('produces a standalone svg with a box and label per node', () => {
    const out = svgExporter.export(spec);
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out).toContain('>Cart</text>');
    expect(out).toContain('>Payment</text>');
    expect((out.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(3); // bg + 2 nodes
    expect(out.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('folds typed attributes into the node label', () => {
    const out = svgExporter.export({
      format: 'er',
      title: 'Data',
      nodes: [
        {
          id: 'a',
          label: 'User',
          kind: 'entity',
          fields: [{ name: 'email', type: 'string' }]
        }
      ],
      edges: []
    });
    expect(out).toContain('>User (email)</text>');
  });

  it('escapes XML-special characters in labels', () => {
    const out = svgExporter.export({
      ...spec,
      nodes: [{ id: 'a', label: 'A & <B>' }],
      edges: []
    });
    expect(out).toContain('A &amp; &lt;B&gt;');
  });
});
