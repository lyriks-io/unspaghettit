import { persistSnapshotToDisk } from './sync/snapshotIo';
import { getSyncManager } from './sync';
import { makeRoomId, ROOM_DOC_FIELD, ROOM_DOC_MAP, type RoomKind } from '../sync/roomId';

/**
 * Route a REST PUT-style "replace this snapshot" through the Y.Doc AND
 * synchronously persist to disk before returning. The Y.Doc write keeps live
 * editors in sync; the immediate disk write closes the read-after-write race
 * that bit the dashboard's create-then-navigate flow:
 *
 *   1. POST a new project; server writes Y.Doc, schedules debounced disk flush
 *      (~400ms).
 *   2. Browser receives 200 and immediately `goto('/projects/<new-id>')`.
 *   3. Page load fires GET /api/projects/<new-id> within milliseconds.
 *   4. GET reads from disk via JsonFolderProjectRepository, finds nothing
 *      (debounce hasn't fired) -> 404 -> "Project not found".
 *
 * Persisting here means the subsequent GET always sees the snapshot. The
 * YDocManager's debounced flush will still fire ~400ms later with the same
 * value; redundant but harmless and we let it run so concurrent WebSocket
 * edits during that window still flush together.
 */
export const replaceSnapshotViaSync = async (
  kind: RoomKind,
  id: string,
  value: unknown
): Promise<void> => {
  const { manager, directory } = getSyncManager();
  const doc = await manager.getOrLoad(makeRoomId(kind, id));
  // 'http' origin (same as publish.ts): the author resolver attributes the
  // resulting history entry to the connected user instead of 'unknown'.
  doc.transact(() => {
    doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, value);
  }, 'http');
  await persistSnapshotToDisk(directory, kind, id, value);
};
