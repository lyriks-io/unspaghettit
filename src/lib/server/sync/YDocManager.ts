import * as Y from 'yjs';
import { parseRoomId, ROOM_DOC_MAP, ROOM_DOC_FIELD, type RoomId } from '../../sync/roomId';
import type { HistoryEntry } from '../../sync/protocol';
import { loadSnapshotFromDisk, persistSnapshotToDisk } from './snapshotIo';
import type { HistoryStore } from './historyStore';
import { computeChangeDescriptor, formatChangeLabel } from './changeDescriptor';
import { currentActiveUser } from './identityRegistry';

const PERSIST_DEBOUNCE_MS = 400;

type Subscriber = {
  send: (update: Uint8Array, origin: unknown) => void;
};

type Room = {
  doc: Y.Doc;
  subscribers: Set<Subscriber>;
  persistTimer: NodeJS.Timeout | null;
  loadedAt: number;
};

const newEntryId = (): string =>
  // 12 chars of base36 timestamp + 6 random. Enough collision resistance for
  // an append-only log and short enough to embed in WS frames cheaply.
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Origins the server uses internally. Anything not in this set OR not a string
// is treated as "author writing through Yjs" and logged. The author tag, when
// the update came from a client WS, is the subscriber instance object. We
// resolve a human-readable id via getAuthor() in wsServer.
const SYSTEM_ORIGINS = new Set<unknown>(['persist', 'load', 'history-jump']);

const extractName = (value: unknown): string => {
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'untitled';
};

/**
 * Cheap structural equality for snapshot values. Used to detect no-op
 * updates so the history log doesn't fill up with empty entries on
 * dashboard restart (see maybeLogHistory). JSON.stringify is fine here
 * because snapshots are written by the same serializer code so key
 * order is stable; the only failure mode is undefined values, which we
 * already guard against before calling.
 */
const snapshotsAreEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export type AuthorResolver = (origin: unknown) => string;

export class YDocManager {
  private rooms = new Map<RoomId, Room>();
  private authorResolver: AuthorResolver = () => 'unknown';
  /**
   * Master switch. State: sync.acceptingConnections. When false, callers
   * should reject new ops at the boundary. Flipped by ops/maintenance code.
   */
  acceptingConnections = true;
  /** State: sync.broadcasts. Incremented on every server-originated fan-out. */
  broadcastCount = 0;
  /** State: sync.lastPersistAt. ISO timestamp of the most recent snapshot write. */
  lastPersistAt: string | null = null;

  constructor(
    private readonly directory: string,
    private readonly history: HistoryStore | null = null
  ) {}

  /** Subscribe a function to translate a write origin to a human author label. */
  setAuthorResolver(resolver: AuthorResolver): void {
    this.authorResolver = resolver;
  }

  /** State: sync.acceptingConnections setter for ops / maintenance flows. */
  setAcceptingConnections(accept: boolean): void {
    this.acceptingConnections = accept;
  }

  /** Per-fan-out hook from the WS layer so the counter stays in YDocManager. */
  recordBroadcast(): void {
    this.broadcastCount += 1;
  }

  /** State: sync.connectedClients. Aggregate of every room's subscriber set. */
  get connectedClients(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.subscribers.size;
    return n;
  }

  /** State: sync.dirtyDocs. Number of rooms with a pending persist timer. */
  get dirtyDocs(): number {
    let n = 0;
    for (const room of this.rooms.values()) if (room.persistTimer !== null) n += 1;
    return n;
  }

  getStats(): {
    docs: number;
    subscribers: number;
    connectedClients: number;
    dirtyDocs: number;
    acceptingConnections: boolean;
    broadcasts: number;
    lastPersistAt: string | null;
  } {
    return {
      docs: this.rooms.size,
      subscribers: this.connectedClients,
      connectedClients: this.connectedClients,
      dirtyDocs: this.dirtyDocs,
      acceptingConnections: this.acceptingConnections,
      broadcasts: this.broadcastCount,
      lastPersistAt: this.lastPersistAt
    };
  }

  async getOrLoad(roomId: RoomId): Promise<Y.Doc> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing.doc;

    const parsed = parseRoomId(roomId);
    if (!parsed) throw new Error(`Invalid room id: ${roomId}`);

    const doc = new Y.Doc();
    const snapshot = await loadSnapshotFromDisk(this.directory, parsed.kind, parsed.id);
    if (snapshot !== null) {
      doc.transact(() => {
        doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, snapshot);
      }, 'load');
    }

    const room: Room = { doc, subscribers: new Set(), persistTimer: null, loadedAt: Date.now() };
    this.rooms.set(roomId, room);

    if (this.history) {
      // Seed (or rehydrate) the history view. If the on-disk log is empty and
      // we have a snapshot, plant a single "initial" entry so the timeline is
      // never blank for an existing feature.
      const view = this.history.getOrInit(
        roomId,
        parsed.kind,
        parsed.id,
        extractName(snapshot)
      );
      if (view.entries.length === 0 && snapshot !== null) {
        this.history.append(roomId, parsed.kind, parsed.id, {
          id: newEntryId(),
          ts: Date.now(),
          author: 'system',
          label: 'Initial state',
          snapshot
        });
      }
    }

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'persist' || origin === 'load') return;
      this.schedulePersist(roomId);
      this.maybeLogHistory(roomId, origin);
      this.broadcast(roomId, update, origin);
    });

    return doc;
  }

  private maybeLogHistory(roomId: RoomId, origin: unknown): void {
    if (!this.history) return;
    if (SYSTEM_ORIGINS.has(origin)) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const parsed = parseRoomId(roomId);
    if (!parsed) return;
    const map = room.doc.getMap(ROOM_DOC_MAP);
    const snapshot = map.get(ROOM_DOC_FIELD);
    if (snapshot == null) return;
    const author = this.authorResolver(origin);
    const view = this.history.view(roomId);
    const previousSnapshot = view?.entries[view.entries.length - 1]?.snapshot;
    // Skip no-op updates. After a dashboard restart, the YDoc is
    // rehydrated fresh from disk (new CRDT bookkeeping), but every
    // connected client still has its OLD CRDT structures. On reconnect
    // the handshake re-applies the client's structures into the fresh
    // doc — Yjs fires 'update' with origin=self even though the
    // resulting snapshot value is byte-identical to what's already on
    // disk. Without this guard, every restart would pile up an empty
    // "Saved <name>" entry per connected client per room. Real edits
    // always bump `updatedAt`, so a JSON-equal comparison only catches
    // the spurious case.
    if (previousSnapshot !== undefined && snapshotsAreEqual(previousSnapshot, snapshot)) {
      return;
    }
    const descriptor = computeChangeDescriptor(parsed.kind, previousSnapshot, snapshot);
    // When the AI made this write, attribute to the human currently at
    // the dashboard (if any). Direct human writes (author = a real
    // display name) skip this — the author already IS the human.
    const actingFor =
      author === 'mcp' ? currentActiveUser() ?? undefined : undefined;
    const entry: HistoryEntry = {
      id: newEntryId(),
      ts: Date.now(),
      author,
      label: formatChangeLabel(descriptor),
      ...(actingFor ? { actingFor } : {}),
      snapshot
    };
    this.history.append(roomId, parsed.kind, parsed.id, entry);
    // One-line diagnostic so a restarted dev server visibly confirms each
    // MCP-driven reload (origin='reload') and UI write (origin=subscriber)
    // is landing in the shared history.
    process.stderr.write(`[unspa-sync] history+1  ${roomId}  author=${author}\n`);
  }

  /**
   * Time-travel: set the room's snapshot to entry[entryId]. Trims the log tail
   * is deferred until the next append (classic redo-stack semantics).
   * Returns the entry's new cursor + a flag indicating whether anything moved.
   */
  jumpHistory(
    roomId: RoomId,
    entryId: string
  ): { cursor: number; entry: HistoryEntry } | null {
    if (!this.history) return null;
    const parsed = parseRoomId(roomId);
    if (!parsed) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const result = this.history.jumpTo(roomId, parsed.kind, parsed.id, entryId);
    if (!result) return null;
    const view = this.history.view(roomId);
    const entry = view?.entries[result.cursor];
    if (!entry) return null;
    // Apply with the 'history-jump' origin so the doc.on('update') listener
    // skips re-logging (otherwise jump would itself become a new entry -
    // breaking the cursor semantics).
    room.doc.transact(() => {
      const map = room.doc.getMap(ROOM_DOC_MAP);
      map.set(ROOM_DOC_FIELD, entry.snapshot);
    }, 'history-jump');
    return { cursor: result.cursor, entry };
  }

  subscribe(roomId: RoomId, sub: Subscriber): () => void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not loaded`);
    room.subscribers.add(sub);
    return () => {
      room.subscribers.delete(sub);
    };
  }

  /**
   * Wipe the room's history and re-seed with a single anchor entry that
   * holds the current Y.Doc snapshot. Returns the fresh view (or null
   * when the room / history aren't loaded) so the caller can broadcast a
   * `history_snapshot` frame to peers. Time-travel still works after the
   * clear — the anchor entry is jumpable — but everything prior is gone.
   */
  clearHistory(roomId: RoomId): import('../../sync/protocol').HistoryView | null {
    if (!this.history) return null;
    const parsed = parseRoomId(roomId);
    if (!parsed) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const map = room.doc.getMap(ROOM_DOC_MAP);
    const snapshot = map.get(ROOM_DOC_FIELD);
    return this.history.clear(
      roomId,
      parsed.kind,
      parsed.id,
      snapshot != null
        ? { snapshot, label: 'Cleared history', author: 'system' }
        : undefined
    );
  }

  broadcast(roomId: RoomId, update: Uint8Array, origin: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const sub of room.subscribers) sub.send(update, origin);
  }

  applyUpdate(roomId: RoomId, update: Uint8Array, origin: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    Y.applyUpdate(room.doc, update, origin);
  }

  encodeFullState(roomId: RoomId): Uint8Array | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return Y.encodeStateAsUpdate(room.doc);
  }

  /**
   * Read the current snapshot for a room without loading it. Used by the
   * reload endpoint to capture the "before" state for diffing against the
   * post-reload snapshot. Returns null when the room isn't loaded — the
   * caller treats that as "no prior state" so a freshly opened room
   * doesn't break the diff path.
   */
  getSnapshot(roomId: RoomId): unknown {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const map = room.doc.getMap(ROOM_DOC_MAP);
    const value = map.get(ROOM_DOC_FIELD);
    return value ?? null;
  }

  encodeStateVector(roomId: RoomId): Uint8Array | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return Y.encodeStateVector(room.doc);
  }

  private schedulePersist(roomId: RoomId): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = setTimeout(() => {
      void this.persist(roomId);
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persist(roomId: RoomId): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.persistTimer = null;
    const parsed = parseRoomId(roomId);
    if (!parsed) return;
    const map = room.doc.getMap(ROOM_DOC_MAP);
    const value = map.get(ROOM_DOC_FIELD);
    if (value == null) return;
    try {
      await persistSnapshotToDisk(this.directory, parsed.kind, parsed.id, value);
      this.lastPersistAt = new Date().toISOString();
    } catch (err) {
      process.stderr.write(
        `[unspa-sync] persist failed for ${roomId}: ${(err as Error).message}\n`
      );
    }
  }

  async flush(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [roomId, room] of this.rooms) {
      if (room.persistTimer) {
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
        promises.push(this.persist(roomId));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Reload the room's snapshot from disk into the Y.Doc. Used when an
   * out-of-band writer (e.g. the MCP server in standalone mode) modifies the
   * underlying JSON file. Calling this brings the in-memory Y.Doc back in
   * step and broadcasts the new state to every connected peer.
   */
  async reloadFromDisk(roomId: RoomId): Promise<void> {
    const parsed = parseRoomId(roomId);
    if (!parsed) return;
    const room = this.rooms.get(roomId);
    if (!room) {
      // Not loaded yet: nothing in memory to diverge. Next subscriber will
      // load fresh from disk on first attach.
      return;
    }
    const snapshot = await loadSnapshotFromDisk(this.directory, parsed.kind, parsed.id);
    room.doc.transact(() => {
      if (snapshot === null) room.doc.getMap(ROOM_DOC_MAP).delete(ROOM_DOC_FIELD);
      else room.doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, snapshot);
    }, 'reload');
    // Mark not-dirty: the doc and disk now match, no need to schedule a persist.
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
  }
}
