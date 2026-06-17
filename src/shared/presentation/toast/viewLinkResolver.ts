import type { SyncEvent } from '$lib/client/sync/syncEvents';

/**
 * Lets the active view teach the activity-toast where its "View" button should
 * point WITHOUT the shared toast layer importing any feature. A view (today the
 * Builder) registers a resolver while it is mounted; the toast asks it for an
 * in-view link to the changed entity first, and falls back to the default
 * (Expert) route when the resolver returns null (entity not shown in that view)
 * or no view is registered.
 *
 * Dependency inversion: the shared toast depends on this abstraction; the
 * feature supplies the implementation — the same shape as the BuilderHost ports.
 */
export type ViewLinkResolver = (kind: SyncEvent['kind'], id: string) => string | null;

let resolver: ViewLinkResolver | null = null;

/**
 * Register the active view's resolver. Returns an unregister fn; calling it
 * only clears the slot when it still holds THIS resolver, so a remount that
 * registers a new one before the old view's cleanup runs isn't torn down.
 */
export const registerViewLinkResolver = (next: ViewLinkResolver): (() => void) => {
  resolver = next;
  return () => {
    if (resolver === next) resolver = null;
  };
};

/** In-view link for the changed entity, or null to use the default route. */
export const resolveViewLink = (kind: SyncEvent['kind'], id: string): string | null =>
  resolver ? resolver(kind, id) : null;
