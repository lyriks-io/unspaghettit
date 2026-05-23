import { browser } from '$app/environment';
import { makeRoomId, type RoomKind } from '../../sync/roomId';
import { YDocClient } from './YDocClient';

type AnyClient = YDocClient<unknown>;

const registry = new Map<string, AnyClient>();

const ensureBrowser = (): void => {
  if (!browser || typeof WebSocket === 'undefined') {
    throw new Error('Sync client is only available in the browser');
  }
};

export const getRoomClient = <T>(kind: RoomKind, id: string): YDocClient<T> => {
  ensureBrowser();
  const room = makeRoomId(kind, id);
  const existing = registry.get(room);
  if (existing) return existing as YDocClient<T>;
  const client = new YDocClient<T>(room);
  registry.set(room, client as AnyClient);
  client.connect();
  return client;
};

export const dropRoomClient = (kind: RoomKind, id: string): void => {
  const room = makeRoomId(kind, id);
  const existing = registry.get(room);
  if (!existing) return;
  existing.destroy();
  registry.delete(room);
};

export { YDocClient } from './YDocClient';
