import type { RequestHandler } from './$types';
import { getSyncEventsHub } from '$lib/server/sync/syncEventsHub';

export const prerender = false;

/**
 * Server-Sent Events stream for list-level invalidations. Clients on the
 * projects index / project page subscribe and re-fetch their summaries when
 * they receive an event whose `kind` they care about. Per-feature live
 * collaboration still flows over the Y.Doc WebSocket; this channel only
 * announces that "something in the list-shaped view has changed."
 */
export const GET: RequestHandler = async ({ request }) => {
  const hub = getSyncEventsHub();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string): void => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream already closed; the cancel handler will tear down.
        }
      };

      // Initial comment unblocks the browser's EventSource so onopen fires.
      send(': connected\n\n');

      // Forward the FULL event payload (kind, id, name?, op?). The earlier
      // shape destructured only {kind, id}, which silently dropped the
      // human-meaningful labels added later — toasts ended up showing bare
      // ids on the wire even though the server-side broadcast carried the
      // name. Don't introduce another partial destructure here; new optional
      // fields on SyncEvent should reach subscribers without a server edit.
      unsubscribe = hub.subscribe((evt) => {
        send(`event: sync\ndata: ${JSON.stringify(evt)}\n\n`);
      });

      // Heartbeat keeps intermediate proxies from closing the long-poll.
      heartbeat = setInterval(() => send(': hb\n\n'), 25_000);

      // Abort cleanup when the client navigates away.
      request.signal.addEventListener('abort', () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
};
