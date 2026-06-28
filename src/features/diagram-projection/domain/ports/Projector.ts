import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';
import type { DiagramFormat, DiagramSpec } from '../DiagramSpec';

/**
 * The read-only slice of the behavior model a projection is built from. The
 * projection bounded context consumes the model; it never mutates it.
 */
export type ProjectionSource = {
  readonly features: readonly Feature[];
  readonly project?: Project;
};

/**
 * A Projector turns the behavior model into a format-specific `DiagramSpec`.
 * One implementation per diagram format (SRP). Pure: no IO, no mutation of the
 * source model. Projectors are discovered through the `ProjectorRegistry`, so
 * the viewer depends on this port, not on concrete projectors (reverse DI).
 */
export type Projector = {
  readonly format: DiagramFormat;
  readonly label: string;
  /** Whether this projection can be serialized to text (Mermaid / DOT). */
  readonly supportsText: boolean;
  project(source: ProjectionSource): DiagramSpec;
};
