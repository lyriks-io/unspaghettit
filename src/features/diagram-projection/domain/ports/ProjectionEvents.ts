import type { DiagramFormat } from '../DiagramSpec';

export type ProjectionScope = 'feature' | 'project';

/**
 * Domain events the projection viewer emits. Mirrors the feature spec's
 * emitted events (`projection.rendered`, `projection.copied`,
 * `projection.exported`). Outbound notifications — the domain defines the
 * shape; an adapter (the event bus) delivers them.
 */
export type ProjectionEvent =
  | { readonly type: 'projection.rendered'; readonly format: DiagramFormat; readonly scope: ProjectionScope }
  | { readonly type: 'projection.copied'; readonly format: string }
  | { readonly type: 'projection.exported'; readonly imageFormat: 'svg' | 'png' };

export type ProjectionEventSink = (event: ProjectionEvent) => void;

export type ProjectionEventBus = {
  emit: ProjectionEventSink;
  subscribe(listener: ProjectionEventSink): () => void;
};
