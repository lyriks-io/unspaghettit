import { digestProjector } from '../domain/services/buildDigest';
import { markdownDigestExporter } from '../infrastructure/exporters/MarkdownDigestExporter';

/**
 * Composition root for the behavior-digest context. Wires the concrete projector
 * and exporter behind their domain ports and hands them to the presentation
 * layer, so components depend on the ports, not on concrete modules (reverse DI).
 * Mirrors diagram-projection's `projectionComposition`.
 */
export { digestProjector, markdownDigestExporter };
