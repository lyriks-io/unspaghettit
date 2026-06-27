import type { DiagramSpec } from '../DiagramSpec';

/**
 * Serializes a `DiagramSpec` to a text format (Mermaid, Graphviz DOT, ...).
 * Pure: a string in, a string out. Implementations live in infrastructure and
 * are injected; the domain only knows this port.
 */
export type DiagramExporter = {
  /** Stable id, e.g. 'mermaid' | 'dot'. */
  readonly id: string;
  readonly label: string;
  export(spec: DiagramSpec): string;
};
