import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { Server as HttpServer } from 'node:http';
import { attachSyncWebSocket } from './wsServer';
import { getSyncManager } from './index';
import {
  clearDashboardEndpoint,
  loopbackUrlFor,
  publishDashboardEndpoint
} from './dashboardEndpoint';

const attach = (server: ViteDevServer | PreviewServer): void => {
  // Vite's httpServer can be an HTTP/2 secure server depending on config; the
  // upgrade-event API is identical for both, so we cast to the plain http.Server
  // shape that ws expects.
  const http = server.httpServer as unknown as HttpServer | null;
  if (!http) return;
  if ((http as unknown as { __unspaSyncAttached?: boolean }).__unspaSyncAttached) return;
  const { manager, history, directory } = getSyncManager();
  attachSyncWebSocket(http, manager, history);
  (http as unknown as { __unspaSyncAttached: boolean }).__unspaSyncAttached = true;
  process.stderr.write(`[unspa-sync] WS attached  snapshots=${directory}\n`);

  // Publish the URL Vite actually bound (it advances past a taken port on its
  // own) so the MCP sync-notifier reaches this dev server without guessing.
  const publish = (): void => {
    const url = loopbackUrlFor(http.address());
    if (url) {
      publishDashboardEndpoint(url);
      process.stderr.write(`[unspa-sync] endpoint ${url}\n`);
    }
  };
  if (http.listening) publish();
  else http.once('listening', publish);
  http.once('close', clearDashboardEndpoint);

  const flush = async (): Promise<void> => {
    try {
      await Promise.all([manager.flush(), history.flush()]);
    } catch {
      // best effort
    }
  };
  process.once('SIGINT', () => {
    clearDashboardEndpoint();
    void flush().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    clearDashboardEndpoint();
    void flush().finally(() => process.exit(0));
  });
};

export const unspaSyncPlugin = (): Plugin => ({
  name: 'unspa-sync',
  configureServer(server) {
    attach(server);
  },
  configurePreviewServer(server) {
    attach(server);
  }
});
