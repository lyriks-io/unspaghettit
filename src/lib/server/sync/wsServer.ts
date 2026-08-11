import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import * as Y from 'yjs';
import { parseRoomId, type RoomId } from '../../sync/roomId';
import {
  decode,
  encode,
  MSG_SYNC_STEP1,
  MSG_SYNC_STEP2,
  MSG_UPDATE,
  MSG_HISTORY_SNAPSHOT,
  MSG_HISTORY_APPEND,
  MSG_HISTORY_JUMP
} from '../../sync/protocol';
import { YDocManager } from './YDocManager';
import type { HistoryStore } from './historyStore';
import { currentActiveUser, recordIdentity, releaseIdentity } from './identityRegistry';
import {
  checkQueryAuth,
  isAuthEnabled,
  isOriginCheckEnabled
} from '../security/auth';
import { checkLocalUpgrade } from '../security/localGuard';
import { normalizeBasePath, stripBaseFromRequestUrl } from '../../../shared/routing/basePath';

export const SYNC_WS_PATH = '/sync';

const toUint8 = (data: RawData): Uint8Array => {
  if (data instanceof Uint8Array) return data;
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.concat(data);
  return new Uint8Array(data as ArrayBuffer);
};

const extractRoomFromUrl = (url: string | undefined): RoomId | null => {
  if (!url) return null;
  // Expected: /sync/<kind>:<id>  (URL-decoded). Tolerate /sync/<kind>/<id>.
  const cleaned = url.split('?')[0] ?? url;
  if (!cleaned.startsWith(SYNC_WS_PATH + '/')) return null;
  const rest = decodeURIComponent(cleaned.slice(SYNC_WS_PATH.length + 1));
  if (rest.includes(':')) return parseRoomId(rest) ? (rest as RoomId) : null;
  // Tolerate slash form
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const reformed = `${rest.slice(0, slash)}:${rest.slice(slash + 1)}`;
  return parseRoomId(reformed) ? (reformed as RoomId) : null;
};

const AUTHOR_MAX_LENGTH = 40;
// Mirrors the client-side sanitizer in identityStore. Done on both sides
// so a hand-crafted WS URL still can't put control characters or
// unprintable bytes into the history log (rendered verbatim in the
// dashboard's history panel).
const ALLOWED_AUTHOR_CHARS = /^[\p{L}\p{N} \-_.@'’]+$/u;

const extractAuthorFromUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  const raw = params.get('author');
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, AUTHOR_MAX_LENGTH);
  if (trimmed.length === 0 || !ALLOWED_AUTHOR_CHARS.test(trimmed)) return null;
  return trimmed;
};

// Fallback author when the client didn't send one (e.g. older client, or
// the user hasn't set a name). Stable for the lifetime of one socket.
const newAnonymousAuthorId = (): string =>
  `Anon-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export const attachSyncWebSocket = (
  httpServer: HttpServer,
  manager: YDocManager,
  history: HistoryStore | null = null
): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });

  // Author resolver: when the doc 'update' fires with `origin` being a
  // Subscriber object (set on the WS message handler below), we look up the
  // author tag we stored on it. String origins get mapped explicitly:
  // 'reload' is the MCP's out-of-band write; 'http' is a REST write from the
  // dashboard UI (publish.ts / syncBridge.ts), which we attribute to whoever
  // is currently connected — the REST request came from their browser.
  // Everything else falls back to 'unknown'.
  manager.setAuthorResolver((origin) => {
    if (origin && typeof origin === 'object' && 'author' in origin) {
      const author = (origin as { author?: unknown }).author;
      if (typeof author === 'string') return author;
    }
    if (origin === 'reload') return 'mcp';
    if (origin === 'http') return currentActiveUser() ?? 'dashboard';
    return 'unknown';
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const roomId = extractRoomFromUrl(req.url);
    if (!roomId) {
      ws.close(1008, 'Invalid sync room');
      return;
    }

    let doc: Y.Doc;
    try {
      doc = await manager.getOrLoad(roomId);
    } catch (err) {
      ws.close(1011, `Load failed: ${(err as Error).message}`);
      return;
    }

    // Prefer the client-supplied name; fall back to an anonymous tag so
    // an old client or a malformed URL still produces sensible history.
    const author = extractAuthorFromUrl(req.url) ?? newAnonymousAuthorId();
    const self = { ws, author };
    // Register the human identity so MCP writes can be attributed back
    // to whoever is currently at the dashboard ("AI · John"). Anonymous
    // tags are filtered by the registry — we only attribute to named
    // users so the sub-label stays meaningful.
    recordIdentity(author);
    const sendUpdateFromOther = (update: Uint8Array, origin: unknown) => {
      if (origin === self) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(encode({ kind: 'update', update }));
      manager.recordBroadcast();
    };

    const unsubscribe = manager.subscribe(roomId, { send: sendUpdateFromOther });

    // Forward history changes for this room to the connected client. The
    // store doesn't have an event bus, so we wrap the manager's hooks with a
    // tiny pub/sub maintained here per-room.
    const historyUnsubscribe = history
      ? subscribeHistory(roomId, (msg) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(encode(msg));
        })
      : () => undefined;

    // Initial Y.Doc sync: send full state as sync_step2.
    const full = Y.encodeStateAsUpdate(doc);
    ws.send(encode({ kind: 'sync_step2', update: full }));
    // And our state vector so the peer can reply with anything we don't have.
    ws.send(encode({ kind: 'sync_step1', stateVector: Y.encodeStateVector(doc) }));

    // Initial history sync.
    if (history) {
      const view = history.view(roomId);
      if (view) ws.send(encode({ kind: 'history_snapshot', view }));
    }

    ws.on('message', (raw) => {
      const data = toUint8(raw);
      const msg = decode(data);
      if (!msg) return;
      if (msg.kind === 'sync_step1') {
        const diff = Y.encodeStateAsUpdate(doc, msg.stateVector);
        ws.send(encode({ kind: 'sync_step2', update: diff }));
        return;
      }
      if (msg.kind === 'sync_step2' || msg.kind === 'update') {
        // applyUpdate fires the doc 'update' listener with origin=self, which
        // schedules persistence, logs to history (with author=self.author),
        // and broadcasts to peers (excluding self).
        Y.applyUpdate(doc, msg.update, self);
        return;
      }
      if (msg.kind === 'history_jump') {
        const result = manager.jumpHistory(roomId, msg.entryId);
        if (result && history) {
          // Re-broadcast the new history view to everyone (cursor changed).
          const view = history.view(roomId);
          if (view) emitHistory(roomId, { kind: 'history_snapshot', view });
        }
        return;
      }
      if (msg.kind === 'history_clear') {
        // Clear bypasses the patched `append` so peers receive a fresh
        // snapshot (entries=[anchor], cursor=0) rather than an append
        // landing on top of stale entries.
        if (!history) return;
        const view = manager.clearHistory(roomId);
        if (view) emitHistory(roomId, { kind: 'history_snapshot', view });
        return;
      }
    });

    // close + error both fire on a broken connection; guard so we only
    // unwind once. Double-release would corrupt the identityRegistry's
    // refcount (a multi-tab user named "John" could vanish from the
    // registry while one of their tabs is still open).
    let teardown = false;
    const onSocketGone = () => {
      if (teardown) return;
      teardown = true;
      unsubscribe();
      historyUnsubscribe();
      releaseIdentity(author);
    };
    ws.on('close', onSocketGone);
    ws.on('error', onSocketGone);
  });

  // The history hook on YDocManager needs a way to fan out append events to
  // every connection in the room. We patch the existing append flow: each
  // call to history.append() inside YDocManager.maybeLogHistory() will be
  // followed by an explicit emitHistory(). Wired via the patch below.
  if (history) wireHistoryFanout(manager, history);

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Same runtime base-path contract as the HTTP funnel in
    // cli/dashboard-server.ts, which never sees upgrade requests: strip the
    // prefix when present so /<base>/sync/... and /sync/... both reach the
    // room logic below (and checkQueryAuth sees the canonical URL).
    const basePath = normalizeBasePath(process.env.PUBLIC_UNSPA_BASE_PATH);
    if (basePath.length > 0 && req.url) {
      req.url = stripBaseFromRequestUrl(basePath, req.url);
    }
    if (!req.url || !req.url.startsWith(SYNC_WS_PATH + '/')) return;

    // Default-on loopback guard: reject a DNS-rebinding page opening a Yjs
    // socket to the local dashboard. The Host header carries the attacker's
    // domain, not `localhost`, so the check fails closed. Mirrors the HTTP
    // guard in hooks.server.ts; self-disables on a wildcard bind.
    if (!checkLocalUpgrade(req.headers.host, req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Optional shared-token gate. Browsers can't set headers on the WS
    // upgrade so the token rides as `?token=...`. When auth is off the
    // checker is a no-op; when on, a missing/wrong token gets a clean
    // 401 close instead of an unauthenticated room subscription.
    if (isAuthEnabled() && !checkQueryAuth(`http://x${req.url}`)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Origin allowlist (paired with auth on the LAN-share tier). A
    // missing Origin header means the caller isn't a browser; pass
    // through. The threat we're closing is "malicious page in your
    // other tab opens a WS to localhost:3000" — those carry Origin.
    if (isOriginCheckEnabled()) {
      const origin = req.headers.origin;
      const allowed = (process.env.UNSPA_ALLOWED_ORIGIN ?? '').replace(/\/$/, '');
      if (origin && origin.replace(/\/$/, '') !== allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return wss;
};

// â”€â”€ Per-room history pub/sub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The HistoryStore is a passive container; this small registry lets the
// wsServer fan history changes out to all peers in a room.

import type { SyncMessage } from '../../sync/protocol';

type HistoryListener = (msg: SyncMessage) => void;
const historySubscribers = new Map<RoomId, Set<HistoryListener>>();

const subscribeHistory = (roomId: RoomId, listener: HistoryListener): (() => void) => {
  let set = historySubscribers.get(roomId);
  if (!set) {
    set = new Set();
    historySubscribers.set(roomId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) historySubscribers.delete(roomId);
  };
};

const emitHistory = (roomId: RoomId, msg: SyncMessage): void => {
  const set = historySubscribers.get(roomId);
  if (!set) return;
  for (const l of set) l(msg);
};

// Wrap HistoryStore.append so every successful append broadcasts to peers in
// the room. Idempotent: only patches once even if attachSyncWebSocket is
// called multiple times in tests.
type PatchedStore = HistoryStore & { __wsServerPatched?: true };

const wireHistoryFanout = (_manager: YDocManager, history: HistoryStore): void => {
  const store = history as PatchedStore;
  if (store.__wsServerPatched) return;
  store.__wsServerPatched = true;
  const original = history.append.bind(history);
  history.append = ((roomId, kind, id, entry) => {
    const result = original(roomId, kind, id, entry);
    if (result) {
      // If the cursor was not at the tip, the log was trimmed first. Clients
      // need a fresh snapshot to drop the abandoned entries from their view.
      if (result.trimmed) {
        const view = history.view(roomId);
        if (view) emitHistory(roomId, { kind: 'history_snapshot', view });
      } else {
        emitHistory(roomId, {
          kind: 'history_append',
          entry: result.entry,
          cursor: result.cursor
        });
      }
    }
    return result;
  }) as HistoryStore['append'];
};

// Re-export so callers don't have to import constants directly.
export const SYNC_MESSAGE_TYPES = {
  SYNC_STEP1: MSG_SYNC_STEP1,
  SYNC_STEP2: MSG_SYNC_STEP2,
  UPDATE: MSG_UPDATE,
  HISTORY_SNAPSHOT: MSG_HISTORY_SNAPSHOT,
  HISTORY_APPEND: MSG_HISTORY_APPEND,
  HISTORY_JUMP: MSG_HISTORY_JUMP
} as const;
