import type { DigestSpec } from '../DigestSpec';

/**
 * Serializes a `DigestSpec` to a text format (Markdown, plain text, ...).
 * Pure: a spec in, a string out. Implementations live in infrastructure and are
 * injected; the domain only knows this port. Because the exporter and the
 * on-screen panel consume the SAME `DigestSpec`, the copied text can never
 * diverge from what the reader saw.
 */
export type DigestExporter = {
  /** Stable id, e.g. 'markdown'. */
  readonly id: string;
  readonly label: string;
  export(spec: DigestSpec): string;
};
