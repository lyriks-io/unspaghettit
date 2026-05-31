import type { Container } from '$shared/infrastructure/container';
import type { SyncEvent } from '$lib/client/sync/syncEvents';
import type { Tag } from '$shared/domain/Tags';
import type { TagColor } from '$shared/domain/TagPalette';

/**
 * Driven ports for the builder view (hexagonal architecture). Each interface is
 * one responsibility the view needs from its host; `BuilderHost` composes them.
 *
 * These are pure abstractions — type-only imports, no concrete singletons — so
 * the view's store depends on *these*, never on the app's infrastructure
 * directly (dependency inversion). Concrete implementations ("adapters") live
 * under `infrastructure/adapters`, and the composition root wires them in.
 */

/** Hands the view the resolved DI container (repositories + use-cases). */
export interface BuilderDataGateway {
  getContainer(): Promise<Container>;
}

/** Tag colors and cross-entity tag rename. */
export interface TagPaletteGateway {
  refresh(): Promise<void>;
  registerTypes(types: readonly string[]): void;
  colorForTag(tag: Tag): TagColor | null;
  renameTag(from: Tag, to: Tag): Promise<void>;
}

/** Live "projects/features changed" notifications. */
export interface SyncGateway {
  subscribe(handler: (event: SyncEvent) => void): () => void;
}

/** The composed set of host services the builder view depends on. */
export interface BuilderHost {
  readonly data: BuilderDataGateway;
  readonly tags: TagPaletteGateway;
  readonly sync: SyncGateway;
}
