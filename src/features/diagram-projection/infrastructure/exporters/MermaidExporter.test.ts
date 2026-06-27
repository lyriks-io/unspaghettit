import { describe, expect, it } from 'vitest';
import type { DiagramSpec } from '../../domain/DiagramSpec';
import { mermaidExporter } from './MermaidExporter';

const statechartSpec: DiagramSpec = {
  format: 'statechart',
  title: 'Checkout',
  nodes: [
    { id: 'a', label: 'Cart' },
    { id: 'b', label: 'Payment' }
  ],
  edges: [{ from: 'a', to: 'b', label: 'Pay' }]
};

describe('mermaidExporter', () => {
  it('emits a stateDiagram-v2 for a statechart', () => {
    const out = mermaidExporter.export(statechartSpec);

    expect(out.startsWith('stateDiagram-v2')).toBe(true);
    expect(out).toContain('state "Cart" as s0');
    expect(out).toContain('state "Payment" as s1');
    expect(out).toContain('s0 --> s1 : Pay');
  });

  it('sanitizes labels that would break Mermaid syntax', () => {
    const out = mermaidExporter.export({
      ...statechartSpec,
      nodes: [{ id: 'a', label: 'Weird "Name": line' }],
      edges: []
    });

    expect(out).not.toContain('"Name"');
    expect(out).toContain('state "Weird Name  line" as s0');
  });

  it('falls back to a flowchart for non-statechart formats', () => {
    const out = mermaidExporter.export({
      format: 'er',
      title: 'Data',
      nodes: [{ id: 'a', label: 'User' }],
      edges: []
    });

    expect(out.startsWith('flowchart TD')).toBe(true);
    expect(out).toContain('s0["User"]');
  });

  it('emits a native mindmap with indentation-encoded hierarchy', () => {
    const out = mermaidExporter.export({
      format: 'mindmap',
      title: 'Shop',
      nodes: [
        { id: 'root', label: 'Shop', kind: 'root' },
        { id: 'surf', label: 'Catalog', kind: 'surface' },
        { id: 'act', label: 'Add to Cart', kind: 'action' }
      ],
      edges: [
        { from: 'root', to: 'surf' },
        { from: 'surf', to: 'act' }
      ]
    });
    const lines = out.split('\n');

    expect(lines[0]).toBe('mindmap');
    // Root is circled and least-indented; children nest one level deeper each.
    expect(lines[1]).toBe('  s0((Shop))');
    expect(lines[2]).toBe('    s1[Catalog]');
    expect(lines[3]).toBe('      s2[Add to Cart]');
  });

  it('strips shape delimiters that would break mindmap labels', () => {
    const out = mermaidExporter.export({
      format: 'mindmap',
      title: 'Root',
      nodes: [
        { id: 'root', label: 'Root', kind: 'root' },
        { id: 'a', label: 'Pay (now) [fast]' }
      ],
      edges: [{ from: 'root', to: 'a' }]
    });

    expect(out).toContain('s1[Pay now fast]');
    expect(out).not.toContain('(now)');
  });
});
