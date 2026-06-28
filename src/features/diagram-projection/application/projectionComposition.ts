import type { DiagramExporter } from '../domain/ports/DiagramExporter';
import { ProjectorRegistry } from '../domain/services/ProjectorRegistry';
import { erProjector } from '../domain/services/projections/erProjector';
import { flowchartProjector } from '../domain/services/projections/flowchartProjector';
import { mindmapProjector } from '../domain/services/projections/mindmapProjector';
import { sequenceProjector } from '../domain/services/projections/sequenceProjector';
import { statechartProjector } from '../domain/services/projections/statechartProjector';
import { dotExporter } from '../infrastructure/exporters/DotExporter';
import { mermaidExporter } from '../infrastructure/exporters/MermaidExporter';
import { svgExporter } from '../infrastructure/exporters/SvgExporter';

/**
 * Composition root for the projection context: the ONLY module that imports
 * concrete projectors and exporters and wires them into the registry. Every
 * other module depends on the ports / registry abstraction (reverse DI), so
 * adding a format means adding a projector and registering it here, with no
 * change to the viewer.
 */
export const projectorRegistry = new ProjectorRegistry([
  statechartProjector,
  sequenceProjector,
  erProjector,
  flowchartProjector,
  mindmapProjector
]);

/** Text serializers, referenced directly by the viewer / export panel. */
export const mermaidTextExporter: DiagramExporter = mermaidExporter;
export const dotTextExporter: DiagramExporter = dotExporter;

/** Image serializer (SVG source; PNG is rasterized from it in the adapter). */
export const imageExporter: DiagramExporter = svgExporter;
