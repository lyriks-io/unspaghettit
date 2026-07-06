import type { DiagramSpec } from '../../domain/DiagramSpec';
import type { DiagramExporter } from '../../domain/ports/DiagramExporter';

/**
 * Serializes a `DiagramSpec` to Mermaid source text, each format in its
 * native Mermaid dialect so the drawing carries the format's real semantics:
 * statechart -> `stateDiagram-v2`, sequence -> `sequenceDiagram`, er ->
 * `erDiagram` (with typed attribute rows), mindmap -> `mindmap`, and
 * flowchart -> `flowchart TD` with kind-shaped, kind-colored nodes. Pure
 * string building: no Mermaid runtime needed to *produce* the text
 * (rendering it visually is a separate adapter).
 *
 * Node aliases are always `s{index}` in `spec.nodes` order; the viewer relies
 * on that to map an element chip to its drawn node (spotlight).
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

/**
 * ER attribute names/types must be bare words (`erDiagram` has no quoting for
 * them), so squash anything else to underscores and guarantee a letter start.
 */
const sanitizeWord = (value: string, fallback: string): string => {
  const word = value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z]/.test(word) ? word : word ? `x${word}` : fallback;
};

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

/**
 * Event choreography as a real sequence diagram: every action is a
 * participant, every emitted-and-handled event is an async message labelled
 * with the event name. `autonumber` gives the flow a readable order.
 */
const sequence = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const lines: string[] = ['sequenceDiagram', '  autonumber'];
  for (const node of spec.nodes) {
    lines.push(`  participant ${alias.get(node.id)} as ${sanitize(node.label)}`);
  }
  for (const edge of spec.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(`  ${from}->>${to}: ${sanitize(edge.label ?? 'event')}`);
  }
  return lines.join('\n');
};

/**
 * A real ER diagram: each entity draws as a titled box with typed attribute
 * rows (from `node.fields`). Entities are aliased so arbitrary display names
 * stay safe inside `["…"]`.
 */
const er = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const lines: string[] = ['erDiagram'];
  spec.nodes.forEach((node, index) => {
    const name = `${alias.get(node.id)}["${sanitize(node.label) || `Entity ${index}`}"]`;
    const fields = node.fields ?? [];
    if (fields.length === 0) {
      lines.push(`  ${name}`);
      return;
    }
    lines.push(`  ${name} {`);
    fields.forEach((field, fieldIndex) => {
      const type = sanitizeWord(field.type, 'field');
      const attr = sanitizeWord(field.name, `field${fieldIndex}`);
      lines.push(`    ${type} ${attr}`);
    });
    lines.push('  }');
  });
  for (const edge of spec.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(
      edge.label ? `  ${from} ||--o{ ${to} : "${sanitize(edge.label)}"` : `  ${from} ||--o{ ${to} : ""`
    );
  }
  return lines.join('\n');
};

/**
 * Kind-aware flowchart: features are dark stadiums, surfaces solid brand
 * boxes, actions light rounded pills: the same palette as the interactive
 * behavior graph, so every projection reads as one system. Labelled edges are
 * cross-surface navigation and draw dotted; unlabelled edges are containment
 * and stay solid.
 */
const FLOWCHART_CLASS_DEFS: Readonly<Record<string, string>> = {
  feature: 'fill:#0f172a,stroke:#020617,color:#f8fafc,stroke-width:1.5px',
  surface: 'fill:#0e7490,stroke:#155e75,color:#ecfeff,stroke-width:1.5px',
  action: 'fill:#ffffff,stroke:#2563eb,color:#1e3a8a,stroke-width:1.5px',
  entity: 'fill:#faf5ff,stroke:#9333ea,color:#581c87,stroke-width:1.5px'
};

const flowchartNodeShape = (kind: string | undefined, text: string): string => {
  if (kind === 'feature') return `(["${text}"])`;
  if (kind === 'action') return `("${text}")`;
  return `["${text}"]`;
};

const flowchart = (spec: DiagramSpec): string => {
  const alias = aliasMap(spec);
  const usedClasses = new Set<string>();
  const lines: string[] = ['flowchart TD'];
  for (const node of spec.nodes) {
    const kind = node.kind && FLOWCHART_CLASS_DEFS[node.kind] ? node.kind : undefined;
    const shape = flowchartNodeShape(node.kind, sanitize(node.label));
    lines.push(`  ${alias.get(node.id)}${shape}${kind ? `:::${kind}` : ''}`);
    if (kind) usedClasses.add(kind);
  }
  for (const edge of spec.edges) {
    const from = alias.get(edge.from);
    const to = alias.get(edge.to);
    if (!from || !to) continue;
    lines.push(edge.label ? `  ${from} -.->|${sanitize(edge.label)}| ${to}` : `  ${from} --> ${to}`);
  }
  for (const kind of usedClasses) {
    lines.push(`  classDef ${kind} ${FLOWCHART_CLASS_DEFS[kind]}`);
  }
  return lines.join('\n');
};

/**
 * A native Mermaid `mindmap`: indentation encodes the hierarchy, so the same
 * root -> feature -> surface -> action tree renders as a compact radial map
 * instead of a sprawling top-down flowchart. The root draws as a circle,
 * surfaces as rounded nodes, everything else square: shape encodes the level.
 * Mermaid mindmaps need exactly one root, so we pick the `root`-kind node (or
 * the first node with no parent) and attach any unreachable nodes underneath
 * it rather than dropping them.
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
    const shaped =
      depth === 0 ? `((${text}))` : node.kind === 'surface' ? `(${text})` : `[${text}]`;
    lines.push(`${indent}${key}${shaped}`);
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
      : spec.format === 'sequence'
        ? sequence(spec)
        : spec.format === 'er'
          ? er(spec)
          : spec.format === 'mindmap'
            ? mindmap(spec)
            : flowchart(spec)
};
