import type { DiagramSpec } from '../../domain/DiagramSpec';
import type { DiagramExporter } from '../../domain/ports/DiagramExporter';

/**
 * Serializes a `DiagramSpec` to Mermaid source text. A statechart becomes a
 * `stateDiagram-v2`; a mindmap becomes a native `mindmap` (a compact radial
 * tree, far smaller than a top-down flowchart of the same hierarchy); any other
 * format falls back to a `flowchart TD`. Pure string building — no Mermaid
 * runtime needed to *produce* the text (rendering it visually is a separate
 * adapter).
 */

/** Mermaid chokes on quotes, colons, and newlines inside labels. */
const sanitize = (label: string): string =>
  label.replace(/[\r\n]+/g, ' ').replace(/["]/g, '').replace(/:/g, ' ').trim();

/**
 * Mermaid's mindmap parser also treats (), [], {} as node-shape delimiters, so
 * strip those (on top of the base sanitize) to keep arbitrary labels safe.
 */
const sanitizeMindmap = (label: string): string =>
  sanitize(label)
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const aliasMap = (spec: DiagramSpec): Map<string, string> => {
  const alias = new Map<string, string>();
  spec.nodes.forEach((node, index) => alias.set(node.id, `s${index}`));
  return alias;
};

const statechart = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const lines: string[] = ['stateDiagram-v2'];
  if (spec.title) lines.push(`  %% ${sanitize(spec.title)}`);
  for (const node of spec.nodes) {
    lines.push(`  state "${sanitize(node.label)}" as ${alias.get(node.id)}`);
  }
  for (const edge of spec.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(edge.label ? `  ${from} --> ${to} : ${sanitize(edge.label)}` : `  ${from} --> ${to}`);
  }
  return lines.join('\n');
};

const flowchart = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const lines: string[] = ['flowchart TD'];
  for (const node of spec.nodes) {
    lines.push(`  ${alias.get(node.id)}["${sanitize(node.label)}"]`);
  }
  for (const edge of spec.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(edge.label ? `  ${from} -->|${sanitize(edge.label)}| ${to}` : `  ${from} --> ${to}`);
  }
  return lines.join('\n');
};

/**
 * A native Mermaid `mindmap`: indentation encodes the hierarchy, so the same
 * root -> feature -> surface -> action tree renders as a compact radial map
 * instead of a sprawling top-down flowchart. Mermaid mindmaps need exactly one
 * root, so we pick the `root`-kind node (or the first node with no parent) and
 * attach any unreachable nodes underneath it rather than dropping them.
 */
const mindmap = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of spec.edges) {
    const children = childrenOf.get(edge.from) ?? [];
    children.push(edge.to);
    childrenOf.set(edge.from, children);
    hasParent.add(edge.to);
  }

  const root =
    spec.nodes.find((node) => node.kind === 'root') ??
    spec.nodes.find((node) => !hasParent.has(node.id)) ??
    spec.nodes[0];
  if (!root) return 'mindmap';

  const lines: string[] = ['mindmap'];
  const seen = new Set<string>();
  const walk = (id: string, depth: number): void => {
    if (seen.has(id)) return; // guard against repeated edges / cycles
    seen.add(id);
    const node = byId.get(id);
    if (!node) return;
    const indent = '  '.repeat(depth + 1);
    const key = alias.get(id) ?? id;
    const text = sanitizeMindmap(node.label) || key;
    // Circle the root; square brackets carry arbitrary (sanitized) text safely.
    lines.push(depth === 0 ? `${indent}${key}((${text}))` : `${indent}${key}[${text}]`);
    for (const child of childrenOf.get(id) ?? []) walk(child, depth + 1);
  };
  walk(root.id, 0);
  for (const node of spec.nodes) if (!seen.has(node.id)) walk(node.id, 1);
  return lines.join('\n');
};

export const mermaidExporter: DiagramExporter = {
  id: 'mermaid',
  label: 'Mermaid',
  export: (spec: DiagramSpec): string =>
    spec.format === 'statechart'
      ? statechart(spec)
      : spec.format === 'mindmap'
        ? mindmap(spec)
        : flowchart(spec)
};
