/**
 * Application-layer port for receiving spec events the tour engine
 * listens to (e.g. `feature.created`, `editor.surface.added`). Decouples
 * the tour use cases from the concrete shared/events module so:
 *   - tests can inject a fake bus and emit synthetic events
 *   - the engine can be retargeted at a different transport later
 *     (server-pushed events, postMessage, etc) without touching domain
 *     or presentation
 *
 * The shape mirrors the shared eventBus minus its writer half (`emit`).
 * The tour engine is a subscriber, not a producer.
 */
export type SpecEventPayload = Record<string, unknown> | undefined;

export type SpecEvent = {
  readonly name: string;
  readonly payload?: Record<string, unknown>;
};

export type SpecEventListener = (event: SpecEvent) => void;

export interface SpecEventBus {
  subscribe(listener: SpecEventListener): () => void;
}
