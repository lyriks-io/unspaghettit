import { describe, expect, it } from 'vitest';
import type { DiagramSpec } from '../../domain/DiagramSpec';
import { dotExporter } from './DotExporter';

const spec: DiagramSpec = {
  format: 'statechart',
  title: 'Checkout',
  nodes: [
    { id: 'a', label: 'Cart' },
    { id: 'b', label: 'Payment' }
  ],
  edges: [{ from: 'a', to: 'b', label: 'Pay' }]
};

describe('dotExporter', () => {
  it('emits a directed graph with labelled nodes and edges', () => {
    const out = dotExporter.export(spec);
    expect(out.startsWith('digraph "Checkout" {')).toBe(true);
    expect(out).toContain('n0 [label="Cart"];');
    expect(out).toContain('n1 [label="Payment"];');
    expect(out).toContain('n0 -> n1 [label="Pay"];');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('escapes quotes in labels', () => {
    const out = dotExporter.export({
      ...spec,
      nodes: [{ id: 'a', label: 'a "quoted" name' }],
      edges: []
    });
    expect(out).toContain('label="a \\"quoted\\" name"');
  });
});
