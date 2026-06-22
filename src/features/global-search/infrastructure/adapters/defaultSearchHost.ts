import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';
import { apiFetch } from '$shared/security/apiFetch';
import type { SearchDoc } from '$features/global-search/domain/SearchDoc';
import type { SearchHost } from '$features/global-search/presentation/ports/SearchHostPorts';

/**
 * Default adapter binding the global-search view's driven ports to the
 * dashboard app's services. The one place that knows the concrete singletons
 * (index endpoint, DI container, sync channel); to host the view elsewhere,
 * supply a different `SearchHost`. Mirrors `defaultBuilderHost`.
 */
export const defaultSearchHost: SearchHost = {
  search: {
    load: async () => {
      const res = await apiFetch('/api/search-index');
      if (!res.ok) throw new Error(`Search index fetch failed (${res.status})`);
      const body = (await res.json()) as { docs: readonly SearchDoc[] };
      return body.docs;
    }
  },
  data: {
    getContainer: () => getBrowserContainer()
  },
  sync: {
    subscribe: (handler) => subscribeSyncEvents(handler)
  }
};
