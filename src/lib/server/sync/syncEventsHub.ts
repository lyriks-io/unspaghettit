import type { RoomKind } from '../../sync/roomId';

/**
 * Out-of-band sync invalidation event. The shape is the wire contract
 * with both the per-tab SSE consumers AND the activity-toast renderer.
 *
 * Required:
 *   kind, id  - the entity that changed; also the key for refetches.
 *
 * Optional, for human-facing UI:
 *   name        - the entity's own display name.
 *   projectName - for kind=feature, the containing project (lookup done
 *                 server-side in the reload endpoint so each consumer
 *                 doesn't have to re-query).
 *   op          - 'save' | 'delete' - what the MCP did to the entity.
 *   changeOp    - the *specific* sub-change ('added', 'removed',
 *                 'renamed', 'edited', 'queued', 'unqueued', 'created',
 *                 'saved'), produced by diffing the pre- and post-reload
 *                 snapshots. Lets the toast say "added Action X under
 *                 Surface Y" instead of just "saved feature Z".
 *   changePath  - breadcrumb names from the entity root inward to the
 *                 leaf that changed. e.g. ["Inbox v2", "Inbox List",
 *                 "Archive Item"] for an Action add.
 *   previousName - for renames, the entity's prior name.
 *
 * Subscribers must tolerate every optional field being undefined (older
 * MCP versions, deletes where the post-state isn't available, etc.).
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
  /**
   * For MCP-driven events only: the human currently at the dashboard
   * whose name should be attributed alongside the AI badge. Lets the
   * toast read "AI · John saved feature X" without losing the AI/human
   * distinction. Resolved server-side from the identity registry.
   */
  readonly actingFor?: string;
};
type Subscriber = (evt: SyncEvent) => void;

/**
 * In-memory fan-out for list-level cache invalidation. Per-room Y.Doc
 * collaboration handles individual editors; this hub exists so that *list*
 * views (projects index, project page's feature list) get notified when a
 * project or feature is created/updated/deleted by another process, most
 * notably the MCP server, which writes directly to disk and POSTs to
 * /api/sync/reload.
 */
class SyncEventsHub {
  private subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  broadcast(evt: SyncEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(evt);
      } catch {
        // A misbehaving subscriber must not block the rest.
      }
    }
  }

  size(): number {
    return this.subscribers.size;
  }
}

// Same globalThis-symbol pattern as getSyncManager, Vite plugin and SSR
// share one instance so MCP-triggered broadcasts reach SSR-served SSE clients.
const KEY = Symbol.for('unspa-sync.eventsHub');
type Globals = { [KEY]?: SyncEventsHub };

export const getSyncEventsHub = (): SyncEventsHub => {
  const g = globalThis as unknown as Globals;
  const existing = g[KEY];
  if (existing) return existing;
  const created = new SyncEventsHub();
  g[KEY] = created;
  return created;
};
