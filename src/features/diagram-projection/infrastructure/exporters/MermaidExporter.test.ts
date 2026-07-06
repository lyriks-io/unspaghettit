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

  it('emits a native sequenceDiagram with participants and event messages', () => {
    const out = mermaidExporter.export({
      format: 'sequence',
      title: 'Checkout events',
      nodes: [
        { id: 'a', label: 'Pay', kind: 'action' },
        { id: 'b', label: 'Send Receipt', kind: 'action' }
      ],
      edges: [{ from: 'a', to: 'b', label: 'order.paid' }]
    });
    const lines = out.split('\n');

    expect(lines[0]).toBe('sequenceDiagram');
    expect(out).toContain('autonumber');
    expect(out).toContain('participant s0 as Pay');
    expect(out).toContain('participant s1 as Send Receipt');
    expect(out).toContain('s0->>s1: order.paid');
  });

  it('emits a native erDiagram with typed attribute rows', () => {
    const out = mermaidExporter.export({
      format: 'er',
      title: 'Data',
      nodes: [
        {
          id: 'a',
          label: 'User',
          kind: 'entity',
          fields: [
            { name: 'email', type: 'string' },
            { name: 'age', type: 'number' }
          ]
        },
        { id: 'b', label: 'Cart', kind: 'entity' }
      ],
      edges: []
    });

    expect(out.startsWith('erDiagram')).toBe(true);
    expect(out).toContain('s0["User"] {');
    expect(out).toContain('string email');
    expect(out).toContain('number age');
    // A fieldless entity still draws, just without an attribute block.
    expect(out).toContain('s1["Cart"]');
    expect(out).not.toContain('s1["Cart"] {');
  });

  it('sanitizes ER attribute words that erDiagram cannot quote', () => {
    const out = mermaidExporter.export({
      format: 'er',
      title: 'Data',
      nodes: [
        {
          id: 'a',
          label: 'User',
          kind: 'entity',
          fields: [{ name: 'weird name!', type: '123 type' }]
        }
      ],
      edges: []
    });

    expect(out).toContain('x123_type weird_name');
  });

  it('styles flowchart nodes by kind and draws labelled navigation dotted', () => {
    const out = mermaidExporter.export({
      format: 'flowchart',
      title: 'Shop',
      nodes: [
        { id: 'f', label: 'Shop', kind: 'feature' },
        { id: 's', label: 'Catalog', kind: 'surface' },
        { id: 'a', label: 'Add to Cart', kind: 'action' }
      ],
      edges: [
        { from: 'f', to: 's' },
        { from: 'a', to: 's', label: 'go to' }
      ]
    });

    expect(out.startsWith('flowchart TD')).toBe(true);
    expect(out).toContain('s0(["Shop"]):::feature');
    expect(out).toContain('s1["Catalog"]:::surface');
    expect(out).toContain('s2("Add to Cart"):::action');
    expect(out).toContain('s0 --> s1');
    expect(out).toContain('s2 -.->|go to| s1');
    expect(out).toContain('classDef feature');
    expect(out).toContain('classDef surface');
    expect(out).toContain('classDef action');
  });

  it('falls back to a flowchart for unknown formats', () => {
    const out = mermaidExporter.export({
      format: 'graph',
      title: 'Free graph',
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
    // Surfaces draw rounded, actions square: shape encodes the level.
    expect(lines[1]).toBe('  s0((Shop))');
    expect(lines[2]).toBe('    s1(Catalog)');
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
