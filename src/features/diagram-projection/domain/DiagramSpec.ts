/**
 * The neutral, format-independent intermediate representation every projector
 * emits and every renderer / exporter consumes. A projector turns the behavior
 * model into a `DiagramSpec`; a renderer draws it; an exporter serializes it.
 *
 * Pure data — no IO, no dependency on any rendering library. This is the seam
 * that lets one model fan out into many diagram formats.
 */

export type DiagramFormat = 'graph' | 'statechart' | 'sequence' | 'er' | 'flowchart' | 'mindmap';

export type DiagramNodeField = {
  readonly name: string;
  readonly type: string;
};

export type DiagramNode = {
  readonly id: string;
  readonly label: string;
  /** Semantic kind (e.g. a surface type) for renderers and themes. Optional. */
  readonly kind?: string;
  /** Typed attributes (ER entities). Renderers may show them as rows. Optional. */
  readonly fields?: readonly DiagramNodeField[];
};

export type DiagramEdge = {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
};

export type DiagramSpec = {
  readonly format: DiagramFormat;
  readonly title: string;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
};

/**
 * Whether the spec carries anything worth showing. A statechart is only
 * meaningful once it has transitions (states alone are not a state machine);
 * every other format needs at least one node. Mirrors the feature spec's
 * `projection.hasContent` rule.
 */
export const diagramHasContent = (spec: DiagramSpec): boolean =>
  spec.format === 'statechart' ? spec.edges.length > 0 : spec.nodes.length > 0;
