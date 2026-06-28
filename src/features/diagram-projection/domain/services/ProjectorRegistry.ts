import type { DiagramFormat } from '../DiagramSpec';
import type { Projector } from '../ports/Projector';

/**
 * Holds the available projectors keyed by format. The Projection Viewer depends
 * on this abstraction, not on concrete projectors (reverse dependency
 * inversion): a new diagram format registers a projector here and the viewer
 * picks it up without changing. Pure — no IO.
 */
export class ProjectorRegistry {
  private readonly byFormat = new Map<DiagramFormat, Projector>();

  constructor(projectors: readonly Projector[] = []) {
    for (const projector of projectors) this.register(projector);
  }

  register(projector: Projector): void {
    this.byFormat.set(projector.format, projector);
  }

  get(format: DiagramFormat): Projector | undefined {
    return this.byFormat.get(format);
  }

  has(format: DiagramFormat): boolean {
    return this.byFormat.has(format);
  }

  list(): readonly Projector[] {
    return [...this.byFormat.values()];
  }
}
