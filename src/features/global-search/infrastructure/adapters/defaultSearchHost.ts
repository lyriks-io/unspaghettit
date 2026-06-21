import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';
import type { SearchHost } from '$features/global-search/presentation/ports/SearchHostPorts';

/**
 * Default adapter binding the global-search view's driven ports to the
 * dashboard app's services. The one place that knows the concrete singletons
 * (DI container, sync channel); to host the view elsewhere, supply a different
 * `SearchHost`. Mirrors `defaultBuilderHost`.
 */
export const defaultSearchHost: SearchHost = {
  data: {
    getContainer: () => getBrowserContainer()
  },
  sync: {
    subscribe: (handler) => subscribeSyncEvents(handler)
  }
};
