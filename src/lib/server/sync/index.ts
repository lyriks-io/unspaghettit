import { YDocManager } from './YDocManager';
import { HistoryStore } from './historyStore';
import { discoverSnapshotDirectory } from '../../../features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { migrateFlatLayoutAndLog } from '../../../shared/infrastructure/persistence/snapshotLayout';

type SyncSingleton = {
  manager: YDocManager;
  history: HistoryStore;
  directory: string;
};

// Pinned on globalThis so the Vite-plugin context (which attaches the
// WebSocket server) and the SvelteKit SSR context (which serves
// /api/sync/reload) share the same YDocManager instance. Without this they
// each evaluate this module separately, end up with their own caches, and
// MCP-driven reload requests would hit a manager that has no loaded rooms.
const KEY = Symbol.for('unspa-sync.singleton');
type Globals = { [KEY]?: SyncSingleton };

export const getSyncManager = (): SyncSingleton => {
  const g = globalThis as unknown as Globals;
  const existing = g[KEY];
  if (existing) return existing;
  const override = process.env.UNSPA_SNAPSHOTS;
  const { directory } = discoverSnapshotDirectory({ override });
  migrateFlatLayoutAndLog(directory, 'unspa-sync');
  const history = new HistoryStore(directory);
  const manager = new YDocManager(directory, history);
  const created: SyncSingleton = { manager, history, directory };
  g[KEY] = created;
  return created;
};

export { YDocManager } from './YDocManager';
export { HistoryStore } from './historyStore';
export { attachSyncWebSocket, SYNC_WS_PATH } from './wsServer';
