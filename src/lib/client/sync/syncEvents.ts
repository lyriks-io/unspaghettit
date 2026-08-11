import { browser } from '$app/environment';
import type { RoomKind } from '../../sync/roomId';
import { authStore } from '$shared/security/authStore.svelte';
import { withBase } from '$shared/routing/appBase';

/**
 * Mirrors the server-side SyncEvent shape (syncEventsHub.ts). All fields
 * beyond {kind, id} are optional and added at different points in the
 * pipeline; subscribers must tolerate every one being undefined.
 */
export type SyncEvent = {
  readonly kind: RoomKind;
  readonly id: string;
  readonly name?: string;
  readonly projectName?: string;
  readonly op?: 'save' | 'delete';
  readonly changeOp?:
    | 'added'
    | 'removed'
    | 'renamed'
    | 'edited'
    | 'queued'
    | 'unqueued'
    | 'created'
    | 'saved'
    | 'deleted';
  readonly changePath?: readonly string[];
  readonly previousName?: string;
  /** For MCP events: human currently driving (rendered as "AI · John"). */
  readonly actingFor?: string;
};
type Listener = (evt: SyncEvent) => void;

/**
 * Browser subscription to /api/sync/events. One shared EventSource for the
 * tab; many local listeners. Subscribers re-fetch their list-shaped state
 * when they receive an event whose kind they care about. Per-room Y.Doc
 * collaboration is handled separately by getRoomClient, this channel is
 * strictly for "the set of projects/features changed, refetch the index".
 */
let source: EventSource | null = null;
const listeners = new Set<Listener>();

const ensureSource = (): void => {
  if (!browser) return;
  if (source) return;
  // EventSource can't set custom headers, so the optional dashboard
  // token rides as a `?token=` query param. The server's `checkRequestAuth`
  // accepts either form. Empty token = no param = unauthenticated SSE
  // (which is fine when the dashboard isn't gated).
  const token = authStore.token;
  const url = withBase(
    token.length > 0 ? `/api/sync/events?token=${encodeURIComponent(token)}` : '/api/sync/events'
  );
  source = new EventSource(url);
  source.addEventListener('sync', (e) => {
    let evt: SyncEvent;
    try {
      evt = JSON.parse((e as MessageEvent).data) as SyncEvent;
    } catch {
      return;
    }
    for (const l of listeners) {
      try {
        l(evt);
      } catch {
        // A misbehaving listener must not block the rest.
      }
    }
  });
  // EventSource auto-reconnects on error; nothing to do here.
};

export const subscribeSyncEvents = (fn: Listener): (() => void) => {
  if (!browser) return () => {};
  ensureSource();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
