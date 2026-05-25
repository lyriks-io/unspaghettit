import * as Y from 'yjs';
import { decode, encode, type HistoryEntry, type HistoryView } from '../../sync/protocol';
import { ROOM_DOC_FIELD, ROOM_DOC_MAP, type RoomId } from '../../sync/roomId';
import { identityStore } from '$shared/identity/identityStore.svelte';
import { authStore } from '$shared/security/authStore.svelte';

/**
 * Browser-side per-room sync client. Lazy-connects a WebSocket to /sync/<roomId>,
 * keeps a local Y.Doc in step with the server, and exposes the snapshot value
 * + a typed mutate() helper.
 *
 * Reconnects with exponential backoff (1s → 8s, capped). Buffers local writes
 * during disconnects in the Y.Doc itself; on reconnect the sync_step1 / step2
 * handshake catches both sides up.
 *
 * Undo/redo and time travel are both served by the server-side shared
 * history: Ctrl+Z / Ctrl+Y / the toolbar buttons all route through jumpTo()
 * to step the shared cursor. Never replay an inverse Y.Map write locally,
 * because that would land back on the server as a fresh edit and produce a
 * duplicate history entry.
 */

const WS_SCHEME = (): string => (location.protocol === 'https:' ? 'wss:' : 'ws:');
const WS_BASE = (): string => `${WS_SCHEME()}//${location.host}/sync`;

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 8000;

export type SnapshotChangeListener<T> = (next: T | null, origin: 'remote' | 'local') => void;
export type HistoryChangeListener = (view: HistoryView) => void;

export class YDocClient<T> {
  readonly doc = new Y.Doc();
  private readonly map = this.doc.getMap(ROOM_DOC_MAP);
  private ws: WebSocket | null = null;
  private listeners = new Set<SnapshotChangeListener<T>>();
  private historyListeners = new Set<HistoryChangeListener>();
  private historyView: HistoryView = { entries: [], cursor: -1 };
  private connected = false;
  private closed = false;
  private backoffMs = BACKOFF_START_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffered: Uint8Array[] = [];

  constructor(readonly roomId: RoomId) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const isRemote = origin === 'remote';
      // Send local updates to the server
      if (!isRemote) {
        this.send(encode({ kind: 'update', update }));
      }
      // Tell observers what the current snapshot looks like.
      const value = this.map.get(ROOM_DOC_FIELD) as T | undefined;
      const fanOrigin: 'remote' | 'local' = isRemote ? 'remote' : 'local';
      for (const l of this.listeners) l(value ?? null, fanOrigin);
    });
  }

  connect(): void {
    if (this.ws || this.closed) return;
    // Carry the user's chosen display name as a URL query so the server
    // can tag history entries from this connection accordingly. Re-read
    // on every (re)connect so a mid-session name change applies to new
    // sockets without a page reload. Falls back to a generic literal
    // when the store isn't initialized — the server also sanitizes, so
    // an unusable value here can't poison the log.
    const author = identityStore.author;
    // Optional dashboard auth token rides as a `?token=` query for the
    // same reason as SSE: browsers can't set headers on WS upgrades.
    // The server's `checkQueryAuth` is the WS-upgrade gate.
    const token = authStore.token;
    const params = new URLSearchParams({ author });
    if (token.length > 0) params.set('token', token);
    const url = `${WS_BASE()}/${encodeURIComponent(this.roomId)}?${params.toString()}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this.backoffMs = BACKOFF_START_MS;
      // Flush any updates we tried to send while disconnected.
      for (const u of this.buffered) ws.send(u);
      this.buffered = [];
      // Tell the server our state vector so it can send anything we don't have.
      ws.send(encode({ kind: 'sync_step1', stateVector: Y.encodeStateVector(this.doc) }));
    });
    ws.addEventListener('message', (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : null;
      if (!data) return;
      const msg = decode(data);
      if (!msg) return;
      if (msg.kind === 'sync_step1') {
        const diff = Y.encodeStateAsUpdate(this.doc, msg.stateVector);
        ws.send(encode({ kind: 'sync_step2', update: diff }));
        return;
      }
      if (msg.kind === 'sync_step2' || msg.kind === 'update') {
        Y.applyUpdate(this.doc, msg.update, 'remote');
        return;
      }
      if (msg.kind === 'history_snapshot') {
        this.historyView = msg.view;
        this.fanHistoryChange();
        return;
      }
      if (msg.kind === 'history_append') {
        // Defensive trim: if a history_append arrives while we still have stale
        // entries past the server's cursor, normalize to the server's view.
        if (msg.cursor < this.historyView.entries.length) {
          this.historyView = {
            entries: this.historyView.entries.slice(0, msg.cursor),
            cursor: msg.cursor
          };
        }
        this.historyView = {
          entries: [...this.historyView.entries, msg.entry],
          cursor: msg.cursor
        };
        this.fanHistoryChange();
        return;
      }
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      this.connected = false;
      if (this.closed) return;
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // close handler will run; nothing to do here.
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(frame: Uint8Array): void {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
      return;
    }
    this.buffered.push(frame);
  }

  /** Read the current snapshot from the Y.Map. */
  get snapshot(): T | null {
    return (this.map.get(ROOM_DOC_FIELD) as T | undefined) ?? null;
  }

  /** Set the whole snapshot. Yjs encodes the diff under the hood. */
  setSnapshot(next: T): void {
    this.doc.transact(() => {
      this.map.set(ROOM_DOC_FIELD, next);
    });
  }

  /** Subscribe to snapshot changes (both remote and local). */
  observe(listener: SnapshotChangeListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current shared history view (entries + cursor). */
  get history(): HistoryView {
    return this.historyView;
  }

  /** Look up an entry by id. Convenience for the panel. */
  historyEntry(entryId: string): HistoryEntry | null {
    return this.historyView.entries.find((e) => e.id === entryId) ?? null;
  }

  /** Subscribe to shared history changes. */
  observeHistory(listener: HistoryChangeListener): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
    };
  }

  /**
   * Step the shared cursor to the entry one before the current one. No-op if
   * the cursor is already at the oldest entry. This is what Ctrl+Z / the
   * toolbar undo button call into. Never a local Y.UndoManager replay.
   */
  undo(): void {
    const target = this.historyView.entries[this.historyView.cursor - 1];
    if (target) this.jumpTo(target.id);
  }

  /** Step the shared cursor forward by one entry. */
  redo(): void {
    const target = this.historyView.entries[this.historyView.cursor + 1];
    if (target) this.jumpTo(target.id);
  }

  /** True when there's a previous entry to step back to. */
  get canUndo(): boolean {
    return this.historyView.cursor > 0;
  }

  /** True when there's a forward entry to step to. */
  get canRedo(): boolean {
    return this.historyView.cursor < this.historyView.entries.length - 1;
  }

  /**
   * Request the server to time-travel to the entry with id. The server applies
   * the snapshot to the Y.Doc and broadcasts a fresh history_snapshot, which
   * keeps cursors aligned across peers.
   */
  jumpTo(entryId: string): void {
    this.send(encode({ kind: 'history_jump', entryId }));
  }

  /**
   * Wipe the shared history log for this room. The server replies with a
   * fresh history_snapshot containing a single "Cleared history" anchor
   * entry that points at the current snapshot, so time-travel still works
   * — there's just nothing prior to jump back to.
   */
  clearHistory(): void {
    this.send(encode({ kind: 'history_clear' }));
  }

  private fanHistoryChange(): void {
    for (const l of this.historyListeners) l(this.historyView);
  }

  destroy(): void {
    this.closed = true;
    this.listeners.clear();
    this.historyListeners.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.doc.destroy();
  }
}
