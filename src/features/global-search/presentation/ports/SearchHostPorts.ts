import type { Container } from '$shared/infrastructure/container';
import type { SyncEvent } from '$lib/client/sync/syncEvents';

/**
 * Driven ports for the global-search view (hexagonal architecture). Each
 * interface is one responsibility the view's store needs from its host;
 * `SearchHost` composes them. Type-only imports, no concrete singletons — the
 * store depends on *these*, never on the app's infrastructure directly. The
 * concrete adapter lives under `infrastructure/adapters` and the composition
 * root (the store module) wires it in. Same shape as `BuilderHost`.
 */

/** Hands the view the resolved DI container (repositories + use-cases). */
export interface SearchDataGateway {
  getContainer(): Promise<Container>;
}

/** Live "projects/features changed" notifications, to invalidate the index. */
export interface SyncGateway {
  subscribe(handler: (event: SyncEvent) => void): () => void;
}

/** The composed set of host services the global-search view depends on. */
export interface SearchHost {
  readonly data: SearchDataGateway;
  readonly sync: SyncGateway;
}
