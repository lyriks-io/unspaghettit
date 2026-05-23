/**
 * Process-wide event bus for spec-declared events. Stores, components, and
 * MCP tools emit through `emit(name, payload?)` so the spec's `emit_event`
 * effects have a real runtime hook. Subscribers are diagnostic only (console
 * logs in dev, audit sinks in prod) so a no-op when no one listens is fine.
 */

export type SpecEvent = {
  readonly name: string;
  readonly payload?: Record<string, unknown>;
  readonly at: string;
};

type Listener = (event: SpecEvent) => void;

const listeners = new Set<Listener>();

export const emit = (name: string, payload?: Record<string, unknown>): void => {
  const event: SpecEvent = {
    name,
    ...(payload ? { payload } : {}),
    at: new Date().toISOString()
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener faults must never break the producer.
    }
  }
};

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
