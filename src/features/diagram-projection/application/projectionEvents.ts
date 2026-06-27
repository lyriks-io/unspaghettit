import type {
  ProjectionEvent,
  ProjectionEventBus,
  ProjectionEventSink
} from '../domain/ports/ProjectionEvents';

/**
 * In-memory event bus implementing the `ProjectionEventBus` port. Components
 * emit projection events here; interested listeners (analytics, the share
 * feature, tests) subscribe. No external IO.
 */
export const createProjectionEventBus = (): ProjectionEventBus => {
  const listeners = new Set<ProjectionEventSink>();
  return {
    emit: (event: ProjectionEvent): void => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener: ProjectionEventSink): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

/** Shared bus instance for the projection context. */
export const projectionEvents: ProjectionEventBus = createProjectionEventBus();
