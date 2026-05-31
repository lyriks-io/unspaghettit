import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';
import type { BuilderHost } from '$features/builder-mode/presentation/ports/BuilderHostPorts';

/**
 * Default adapter binding the builder view's driven ports to the dashboard
 * app's services. This is the one place that knows the concrete singletons
 * (DI container, tag-palette store, sync channel); to host the view elsewhere,
 * supply a different `BuilderHost`.
 */
export const defaultBuilderHost: BuilderHost = {
  data: {
    getContainer: () => getBrowserContainer()
  },
  tags: {
    refresh: () => tagPaletteStore.refresh(),
    registerTypes: (types) => tagPaletteStore.registerTypes(types),
    colorForTag: (tag) => tagPaletteStore.colorForTag(tag),
    renameTag: async (from, to) => {
      await tagPaletteStore.renameTag(from, to);
    }
  },
  sync: {
    subscribe: (handler) => subscribeSyncEvents(handler)
  }
};
