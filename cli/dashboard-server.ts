import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getSyncManager } from '../src/lib/server/sync';
import { attachSyncWebSocket } from '../src/lib/server/sync/wsServer';
import {
  DEFAULT_DASHBOARD_PORT,
  clearDashboardEndpoint,
  loopbackUrlFor,
  publishDashboardEndpoint
} from '../src/lib/server/sync/dashboardEndpoint';

// Custom dashboard entrypoint. The default `build/index.js` that adapter-node
// emits creates an HTTP server and routes requests through the SvelteKit
// `handler`, but it has no hook to attach a WebSocket upgrade listener. That
// works under `vite dev` because `vitePlugin.ts` attaches to Vite's own
// httpServer; under `unspa dashboard` (which runs the production build) the
// upgrade listener is missing and every Yjs client retries
// `GET /sync/<room>` forever, getting 404s logged in the console with no live
// collaboration.
//
// This file imports adapter-node's `handler` (the same one `build/index.js`
// uses) and pairs it with `attachSyncWebSocket` on a single `http.Server`,
// so HTTP requests are served by SvelteKit and `upgrade` events on `/sync/...`
// are caught by the Yjs WebSocket server.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const handlerPath = resolve(repoRoot, 'build', 'handler.js');

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const main = async (): Promise<void> => {
  // Dynamic ESM import: handler.js is ESM (adapter-node default). This file
  // is loaded under tsx/cjs so a static `import` would compile to `require`
  // and fail on an ESM module; the await-import path works in both modes.
  //
  // Convert the absolute path to a file:// URL because Node's ESM loader
  // rejects raw Windows paths like "c:\..." (they look like a URL with the
  // "c:" scheme).
  const handlerUrl = pathToFileURL(handlerPath).href;
  const mod = (await import(handlerUrl)) as { handler: Handler };
  const handler = mod.handler;

  const host = process.env.HOST ?? '127.0.0.1';
  // An explicit PORT (from `unspa dashboard --port`) is honoured strictly. With
  // no override we start on the uncommon shared default and advance to the next
  // free port if it is taken, so a squatted port (e.g. a WSL/Docker relay on
  // 3000) never crashes the boot. The real bound port is published below.
  const explicitPort = (process.env.PORT ?? '').trim().length > 0;
  const startPort = explicitPort
    ? Number.parseInt(process.env.PORT as string, 10)
    : DEFAULT_DASHBOARD_PORT;
  if (!Number.isFinite(startPort)) {
    throw new Error(`Invalid PORT env: ${process.env.PORT}`);
  }

  const httpServer = createServer((req, res) => {
    handler(req, res, () => {
      // SvelteKit's handler always responds; the next() fallback only fires
      // on a route miss, in which case we send the default 404.
      res.statusCode = 404;
      res.end('Not found');
    });
  });

  const { manager, history, directory } = getSyncManager();
  attachSyncWebSocket(httpServer, manager, history);

  // Bind, advancing past a taken port unless the user pinned one. Rejects (and
  // so exits loudly via main().catch) on a pinned-but-taken port or after 20
  // busy ports in a row.
  const listenWithFallback = (): Promise<number> =>
    new Promise((resolvePort, rejectPort) => {
      let port = startPort;
      let attempts = 0;
      const tryOnce = (): void => {
        httpServer.removeAllListeners('error');
        httpServer.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && !explicitPort && attempts < 20) {
            attempts += 1;
            port += 1;
            tryOnce();
            return;
          }
          rejectPort(err);
        });
        httpServer.listen(port, host, () => resolvePort(port));
      };
      tryOnce();
    });

  const boundPort = await listenWithFallback();
  httpServer.removeAllListeners('error');
  httpServer.on('error', (err: NodeJS.ErrnoException) =>
    process.stderr.write(`[unspa-dashboard] server error: ${err.message}\n`)
  );
  // Publish the URL we actually bound so the MCP sync-notifier can push live
  // reloads without guessing the port (see src/lib/server/sync/dashboardEndpoint).
  const publishedUrl = loopbackUrlFor(httpServer.address()) ?? `http://${host}:${boundPort}`;
  publishDashboardEndpoint(publishedUrl);
  process.stderr.write(`[unspa-dashboard] listening on ${publishedUrl}  snapshots=${directory}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[unspa-dashboard] ${signal} - flushing...\n`);
    try {
      await Promise.all([manager.flush(), history.flush()]);
    } catch {
      // Best-effort flush; we still want to exit even if disk I/O is wedged.
    }
    clearDashboardEndpoint();
    httpServer.close(() => process.exit(0));
    // Hard timeout in case `close` hangs on a half-open connection.
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((err) => {
  process.stderr.write(`[unspa-dashboard] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
