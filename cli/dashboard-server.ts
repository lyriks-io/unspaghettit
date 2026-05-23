import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getSyncManager } from '../src/lib/server/sync';
import { attachSyncWebSocket } from '../src/lib/server/sync/wsServer';

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
  const portRaw = process.env.PORT ?? '3000';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PORT env: ${portRaw}`);
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

  httpServer.listen(port, host, () => {
    process.stderr.write(
      `[unspa-dashboard] listening on http://${host}:${port}  snapshots=${directory}\n`
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[unspa-dashboard] ${signal} - flushing...\n`);
    try {
      await Promise.all([manager.flush(), history.flush()]);
    } catch {
      // Best-effort flush; we still want to exit even if disk I/O is wedged.
    }
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
