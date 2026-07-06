import type { DiagramNode, DiagramSpec } from '../../domain/DiagramSpec';
import type { DiagramExporter } from '../../domain/ports/DiagramExporter';

/**
 * Renders a `DiagramSpec` to a standalone SVG with a simple vertical layout:
 * nodes stacked as rounded boxes, edges drawn as curved connectors on the
 * right. Dependency-free (no Mermaid runtime) so it works for image downloads
 * everywhere; a richer layout engine can replace it behind the same port.
 */

const NODE_W = 220;
const NODE_H = 46;
const GAP_Y = 34;
const PAD = 40;
const LANE = 220; // horizontal room for edge connectors + labels

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Typed attributes (ER entities) fold into the label so the image keeps them. */
const nodeLabel = (node: DiagramNode): string =>
  node.fields?.length ? `${node.label} (${node.fields.map((field) => field.name).join(', ')})` : node.label;

export const svgExporter: DiagramExporter = {
  id: 'svg',
  label: 'SVG',

  export(spec: DiagramSpec): string {
    const positions = new Map<string, { x: number; y: number }>();
    spec.nodes.forEach((node, index) => positions.set(node.id, { x: PAD, y: PAD + index * (NODE_H + GAP_Y) }));

    const width = NODE_W + PAD * 2 + LANE;
    const height = Math.max(PAD * 2, PAD * 2 + spec.nodes.length * (NODE_H + GAP_Y) - GAP_Y);

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>'
    ];

    for (const edge of spec.edges) {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) continue;
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x + NODE_W;
      const y2 = b.y + NODE_H / 2;
      const bend = Math.max(x1, x2) + 36;
      parts.push(
        `<path d="M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`
      );
      if (edge.label) {
        parts.push(
          `<text x="${bend + 4}" y="${(y1 + y2) / 2 - 4}" font-family="sans-serif" font-size="11" fill="#475569">${escapeXml(edge.label)}</text>`
        );
      }
    }

    for (const node of spec.nodes) {
      const p = positions.get(node.id);
      if (!p) continue;
      parts.push(
        `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="#0e7490" stroke="#155e75"/>`
      );
      parts.push(
        `<text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#ffffff">${escapeXml(nodeLabel(node))}</text>`
      );
    }

    parts.push('</svg>');
    return parts.join('\n');
  }
};
