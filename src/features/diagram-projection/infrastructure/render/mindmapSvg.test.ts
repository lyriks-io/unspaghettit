import { describe, expect, it } from 'vitest';
import type { DiagramSpec } from '../../domain/DiagramSpec';
import { layoutMindmap, renderMindmapSvg } from './mindmapSvg';

/** The shape that breaks Mermaid's mindmap: one surface fanning out into
 *  dozens of actions. */
const wideFanout = (actionCount: number): DiagramSpec => {
  const nodes = [
    { id: 'root', label: 'Framing', kind: 'root' },
    { id: 'surf', label: 'Framing Screen', kind: 'surface' },
    ...Array.from({ length: actionCount }, (_, i) => ({
      id: `a${i}`,
      label: `Set Some Longish Action Name ${i}`,
      kind: 'action'
    }))
  ];
  const edges = [
    { from: 'root', to: 'surf' },
    ...Array.from({ length: actionCount }, (_, i) => ({ from: 'surf', to: `a${i}` }))
  ];
  return { format: 'mindmap', title: 'Framing', nodes, edges };
};

const boxesOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe('layoutMindmap', () => {
  it('places a 60-action fan-out with zero overlapping boxes', () => {
    const { nodes } = layoutMindmap(wideFanout(60));
    expect(nodes).toHaveLength(62);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b) continue;
        expect(boxesOverlap(a, b), `${a.node.label} overlaps ${b.node.label}`).toBe(false);
      }
    }
  });

  it('wraps a huge all-leaf flock into a grid panel that stays compact', () => {
    const { nodes, panels } = layoutMindmap(wideFanout(60));
    expect(panels).toHaveLength(1);
    const panel = panels[0]!;
    const leaves = nodes.filter((n) => n.inPanel);
    expect(leaves).toHaveLength(60);
    for (const leaf of leaves) {
      expect(leaf.x - leaf.w / 2).toBeGreaterThanOrEqual(panel.x);
      expect(leaf.x + leaf.w / 2).toBeLessThanOrEqual(panel.x + panel.w);
      expect(leaf.y - leaf.h / 2).toBeGreaterThanOrEqual(panel.y);
      expect(leaf.y + leaf.h / 2).toBeLessThanOrEqual(panel.y + panel.h);
    }
    // The point of the grid: the block must not degenerate into one tall column.
    expect(panel.w / panel.h).toBeGreaterThan(0.8);
  });

  it('centers the root and pushes columns outward by depth', () => {
    const { nodes } = layoutMindmap(wideFanout(8));
    const root = nodes.find((n) => n.depth === 0);
    const surface = nodes.find((n) => n.depth === 1);
    const action = nodes.find((n) => n.depth === 2);
    expect(root).toMatchObject({ x: 0, y: 0 });
    expect(Math.abs(surface!.x)).toBeGreaterThan(0);
    expect(Math.abs(action!.x)).toBeGreaterThan(Math.abs(surface!.x));
  });

  it('balances multiple branches across both sides of the root', () => {
    const specNodes = [
      { id: 'root', label: 'Project', kind: 'root' },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, label: `Feature ${i}`, kind: 'feature' }))
    ];
    const edges = Array.from({ length: 4 }, (_, i) => ({ from: 'root', to: `f${i}` }));
    const { nodes } = layoutMindmap({ format: 'mindmap', title: 'P', nodes: specNodes, edges });
    const features = nodes.filter((n) => n.depth === 1);
    expect(features.some((n) => n.x > 0)).toBe(true);
    expect(features.some((n) => n.x < 0)).toBe(true);
  });

  it('keeps unreachable nodes by attaching them under the root', () => {
    const spec: DiagramSpec = {
      format: 'mindmap',
      title: 'M',
      nodes: [
        { id: 'root', label: 'Root', kind: 'root' },
        { id: 'lost', label: 'Orphan' }
      ],
      edges: []
    };
    const { nodes } = layoutMindmap(spec);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.node.id === 'lost')?.depth).toBe(1);
  });
});

describe('renderMindmapSvg', () => {
  it('emits alias ids so spotlight and click-to-pick keep working', () => {
    const svg = renderMindmapSvg(wideFanout(3));
    expect(svg).toContain('id="mindmap-s0"');
    expect(svg).toContain('id="mindmap-s4"'); // last action, spec order
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it('escapes XML-special labels and keeps the full text in a title', () => {
    const svg = renderMindmapSvg({
      format: 'mindmap',
      title: 'M',
      nodes: [
        { id: 'root', label: 'A & <B>', kind: 'root' },
        {
          id: 'long',
          label: 'A very very long action name that will not fit in one box',
          kind: 'action'
        }
      ],
      edges: [{ from: 'root', to: 'long' }]
    });
    expect(svg).toContain('A &amp; &lt;B&gt;');
    expect(svg).toContain('…');
    expect(svg).toContain('<title>A very very long action name that will not fit in one box</title>');
  });
});
