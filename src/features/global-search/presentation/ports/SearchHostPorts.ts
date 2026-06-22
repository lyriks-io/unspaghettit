import type { Container } from '$shared/infrastructure/container';
import type { SyncEvent } from '$lib/client/sync/syncEvents';
import type { SearchDoc } from '$features/global-search/domain/SearchDoc';

/**
 * Driven ports for the global-search view (hexagonal architecture). Each
 * interface is one responsibility the view's store needs from its host;
 * `SearchHost` composes them. Type-only imports, no concrete singletons — the
 * store depends on *these*, never on the app's infrastructure directly. The
 * concrete adapter lives under `infrastructure/adapters` and the composition
 * root (the store module) wires it in. Same shape as `BuilderHost`.
 */

/** Hands the view the resolved DI container (repositories + use-cases). Used
 *  only by the in-browser fallback build when the index endpoint is down. */
export interface SearchDataGateway {
  getContainer(): Promise<Container>;
}

/**
 * Loads the precomputed search index, built and cached server-side. This is the
 * primary, fast path: one fetch instead of walking the whole model in the
 * browser.
 */
export interface SearchIndexGateway {
  load(): Promise<readonly SearchDoc[]>;
}

/** Live "projects/features changed" notifications, to invalidate the index. */
export interface SyncGateway {
  subscribe(handler: (event: SyncEvent) => void): () => void;
}

/** The composed set of host services the global-search view depends on. */
export interface SearchHost {
  /** Primary: the server-built index. */
  readonly search: SearchIndexGateway;
  /** Fallback only: in-browser build from repositories if the index fails. */
  readonly data: SearchDataGateway;
  readonly sync: SyncGateway;
}
