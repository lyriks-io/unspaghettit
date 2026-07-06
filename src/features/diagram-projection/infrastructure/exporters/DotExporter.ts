import type { DiagramNode, DiagramSpec } from '../../domain/DiagramSpec';
import type { DiagramExporter } from '../../domain/ports/DiagramExporter';

/** Graphviz DOT chokes on unescaped quotes and newlines inside labels. */
const escape = (label: string): string => label.replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"').trim();

/** Typed attributes (ER entities) fold into the label so DOT keeps them. */
const nodeLabel = (node: DiagramNode): string =>
  node.fields?.length ? `${node.label} (${node.fields.map((field) => field.name).join(', ')})` : node.label;

/**
 * Serializes a `DiagramSpec` to Graphviz DOT. Pure string building — works for
 * every format, including the free behavior graph.
 */
export const dotExporter: DiagramExporter = {
  id: 'dot',
  label: 'Graphviz DOT',

  export(spec: DiagramSpec): string {
    const alias = new Map<string, string>();
    spec.nodes.forEach((node, index) => alias.set(node.id, `n${index}`));

    const lines: string[] = [`digraph "${escape(spec.title)}" {`, '  rankdir=LR;'];
    for (const node of spec.nodes) {
      lines.push(`  ${alias.get(node.id)} [label="${escape(nodeLabel(node))}"];`);
    }
    for (const edge of spec.edges) {
      const from = alias.get(edge.from);
      const to = alias.get(edge.to);
      if (!from || !to) continue;
      const label = edge.label ? ` [label="${escape(edge.label)}"]` : '';
      lines.push(`  ${from} -> ${to}${label};`);
    }
    lines.push('}');
    return lines.join('\n');
  }
};
