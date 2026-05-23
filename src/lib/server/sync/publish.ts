import { ROOM_DOC_FIELD, ROOM_DOC_MAP, makeRoomId, type RoomKind } from '../../sync/roomId';
import { getSyncManager } from './index';

/**
 * Apply a full snapshot value to the server-side Y.Doc for the given room.
 * This:
 *   1. Hydrates the Y.Doc from disk if not already cached.
 *   2. Sets the map's `data` field to `value`.
 *   3. The Y.Doc update listener will broadcast to peers + debounce-persist.
 *
 * Used by REST PUT handlers so HTTP writes and WS writes converge on a single
 * source of truth.
 */
export const publishSnapshot = async (
  kind: RoomKind,
  id: string,
  value: unknown
): Promise<void> => {
  const { manager } = getSyncManager();
  const roomId = makeRoomId(kind, id);
  const doc = await manager.getOrLoad(roomId);
  doc.transact(() => {
    doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, value);
  }, 'http');
  // YDocManager's doc.on('update') listener fans out the incremental update
  // to subscribed WS peers and schedules a debounced disk persist.
};

export const closeRoom = async (kind: RoomKind, id: string): Promise<void> => {
  // No explicit close in the manager API today. The room stays in cache.
  // Persistence is handled by the file-level delete in the HTTP DELETE handler.
  // This stub exists so callers don't need to know that.
  void kind;
  void id;
};
