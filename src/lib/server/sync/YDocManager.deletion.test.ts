import { it, expect } from 'vitest';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YDocManager } from './YDocManager';
import { HistoryStore } from './historyStore';
import { loadSnapshotFromDisk } from './snapshotIo';
import { makeRoomId, ROOM_DOC_MAP, ROOM_DOC_FIELD } from '../../sync/roomId';
import { assertStateDefinitionsPreserved } from '../../../features/behavior-model/application/services/assertStateDefinitionsPreserved';

it('refuses a raw collaborative deletion before broadcasting or persisting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unspa-deletion-'));
  const manager = new YDocManager(dir, null, assertStateDefinitionsPreserved);
  const room = makeRoomId('feature', 'f');
  const doc = await manager.getOrLoad(room);
  const before = {
    id: 'f',
    name: 'Test',
    surfaces: [{ id: 's', stateDefinitions: [{ id: 'd' }] }]
  };
  doc.transact(() => doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, before), 'load');
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(doc);
    candidate.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, { ...before, surfaces: [] });
    expect(() =>
      manager.applyUpdate(room, Y.encodeStateAsUpdate(candidate, vector), 'client')
    ).toThrow('checked deletion command');
    expect(doc.getMap(ROOM_DOC_MAP).get(ROOM_DOC_FIELD)).toEqual(before);
    expect(manager.broadcastCount).toBe(0);
    expect(() => manager.assertSnapshotChange(room, { ...before, surfaces: [] })).toThrow(
      'checked deletion command'
    );
  } finally {
    candidate.destroy();
    doc.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});

it('preserves standalone collaborative deletion, persistence and undo/redo without a host guard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unspa-standalone-deletion-'));
  const history = new HistoryStore(dir);
  const manager = new YDocManager(dir, history);
  const room = makeRoomId('feature', 'f');
  const doc = await manager.getOrLoad(room);
  const before = {
    id: 'f',
    name: 'Standalone test',
    surfaces: [{ id: 's', stateDefinitions: [{ id: 'd' }] }]
  };
  const after = { ...before, surfaces: [{ id: 's', stateDefinitions: [] }] };
  const candidate = new Y.Doc();
  const broadcasts: Uint8Array[] = [];
  const unsubscribe = manager.subscribe(room, { send: (update) => broadcasts.push(update) });
  try {
    doc.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, before);
    const initialEntry = history.view(room)!.entries[0]!.id;
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(doc);
    candidate.getMap(ROOM_DOC_MAP).set(ROOM_DOC_FIELD, after);
    manager.applyUpdate(room, Y.encodeStateAsUpdate(candidate, vector), 'client');
    const deletionEntry = history.view(room)!.entries[1]!.id;
    expect(manager.getSnapshot(room)).toEqual(after);
    expect(broadcasts).toHaveLength(2);
    await manager.flush();
    expect(await loadSnapshotFromDisk(dir, 'feature', 'f')).toEqual(after);
    expect(manager.jumpHistory(room, initialEntry)?.cursor).toBe(0);
    expect(manager.getSnapshot(room)).toEqual(before);
    expect(manager.jumpHistory(room, deletionEntry)?.cursor).toBe(1);
    expect(manager.getSnapshot(room)).toEqual(after);
    expect(() => manager.assertSnapshotChange(room, after)).not.toThrow();
  } finally {
    await manager.flush();
    await history.flush();
    unsubscribe();
    candidate.destroy();
    doc.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});
