/**
 * Sync wire protocol. One WebSocket = one room (path-encoded).
 *
 *   byte 0     = MessageType
 *   bytes 1..N = payload (binary for Yjs frames, UTF-8 JSON for history frames)
 *
 * Yjs frames (Y.Doc sync. Binary payload):
 *   0 sync_step1  : state vector
 *   1 sync_step2  : encoded update
 *   2 update      : encoded update
 *
 * History frames (server-authoritative shared edit log. JSON payload):
 *   3 history_snapshot : full { entries, cursor } as a fresh view (server -> client)
 *   4 history_append   : one { entry, cursor } appended at the end   (server -> client)
 *   5 history_jump     : { entryId } request to time-travel          (client -> server)
 *   6 history_clear    : empty body, asks the server to wipe the log (client -> server)
 *
 * Connection handshake:
 *   1. server sends MSG_SYNC_STEP2 with the full doc state on connect
 *   2. server sends MSG_HISTORY_SNAPSHOT with the current history
 *   3. client sends MSG_SYNC_STEP1 with its state vector
 *   4. server replies MSG_SYNC_STEP2 with diff vs client SV
 *   5. both sides emit MSG_UPDATE on every local change; the other side applies it
 *   6. server emits MSG_HISTORY_APPEND for every new logged write
 *   7. client may emit MSG_HISTORY_JUMP at any time
 *   8. client may emit MSG_HISTORY_CLEAR; server replies with a fresh
 *      MSG_HISTORY_SNAPSHOT broadcast that the consumer applies wholesale
 */

export const MSG_SYNC_STEP1 = 0;
export const MSG_SYNC_STEP2 = 1;
export const MSG_UPDATE = 2;
export const MSG_HISTORY_SNAPSHOT = 3;
export const MSG_HISTORY_APPEND = 4;
export const MSG_HISTORY_JUMP = 5;
export const MSG_HISTORY_CLEAR = 6;

export type HistoryEntry = {
  id: string;
  ts: number;
  author: string;
  label?: string;
  /**
   * When the author is the AI (`mcp`), the human currently at the
   * dashboard whose name is attributed alongside. Render as `AI · John`
   * so the AI-vs-human distinction stays while still surfacing whoever
   * drove the change. Absent for direct human writes (the author IS the
   * human) and for headless MCP sessions where no dashboard tab is
   * connected with a named identity.
   */
  actingFor?: string;
  // The post-write snapshot is opaque to the protocol layer. It's whatever
  // shape the room kind happens to store (Feature, Project, …).
  snapshot: unknown;
};

export type HistoryView = {
  entries: HistoryEntry[];
  cursor: number;
};

export type SyncMessage =
  | { kind: 'sync_step1'; stateVector: Uint8Array }
  | { kind: 'sync_step2'; update: Uint8Array }
  | { kind: 'update'; update: Uint8Array }
  | { kind: 'history_snapshot'; view: HistoryView }
  | { kind: 'history_append'; entry: HistoryEntry; cursor: number }
  | { kind: 'history_jump'; entryId: string }
  | { kind: 'history_clear' };

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const encodeJsonFrame = (type: number, body: unknown): Uint8Array => {
  const bytes = TEXT_ENCODER.encode(JSON.stringify(body));
  const out = new Uint8Array(1 + bytes.length);
  out[0] = type;
  out.set(bytes, 1);
  return out;
};

export const encode = (msg: SyncMessage): Uint8Array => {
  if (msg.kind === 'sync_step1') {
    const out = new Uint8Array(1 + msg.stateVector.length);
    out[0] = MSG_SYNC_STEP1;
    out.set(msg.stateVector, 1);
    return out;
  }
  if (msg.kind === 'sync_step2') {
    const out = new Uint8Array(1 + msg.update.length);
    out[0] = MSG_SYNC_STEP2;
    out.set(msg.update, 1);
    return out;
  }
  if (msg.kind === 'update') {
    const out = new Uint8Array(1 + msg.update.length);
    out[0] = MSG_UPDATE;
    out.set(msg.update, 1);
    return out;
  }
  if (msg.kind === 'history_snapshot') {
    return encodeJsonFrame(MSG_HISTORY_SNAPSHOT, msg.view);
  }
  if (msg.kind === 'history_append') {
    return encodeJsonFrame(MSG_HISTORY_APPEND, { entry: msg.entry, cursor: msg.cursor });
  }
  if (msg.kind === 'history_jump') {
    return encodeJsonFrame(MSG_HISTORY_JUMP, { entryId: msg.entryId });
  }
  return encodeJsonFrame(MSG_HISTORY_CLEAR, {});
};

const decodeJsonFrame = <T>(payload: Uint8Array): T | null => {
  try {
    return JSON.parse(TEXT_DECODER.decode(payload)) as T;
  } catch {
    return null;
  }
};

export const decode = (data: Uint8Array): SyncMessage | null => {
  if (data.length < 1) return null;
  const type = data[0];
  const payload = data.subarray(1);
  if (type === MSG_SYNC_STEP1) return { kind: 'sync_step1', stateVector: payload };
  if (type === MSG_SYNC_STEP2) return { kind: 'sync_step2', update: payload };
  if (type === MSG_UPDATE) return { kind: 'update', update: payload };
  if (type === MSG_HISTORY_SNAPSHOT) {
    const view = decodeJsonFrame<HistoryView>(payload);
    if (!view || !Array.isArray(view.entries) || typeof view.cursor !== 'number') return null;
    return { kind: 'history_snapshot', view };
  }
  if (type === MSG_HISTORY_APPEND) {
    const body = decodeJsonFrame<{ entry: HistoryEntry; cursor: number }>(payload);
    if (!body || !body.entry || typeof body.cursor !== 'number') return null;
    return { kind: 'history_append', entry: body.entry, cursor: body.cursor };
  }
  if (type === MSG_HISTORY_JUMP) {
    const body = decodeJsonFrame<{ entryId: string }>(payload);
    if (!body || typeof body.entryId !== 'string') return null;
    return { kind: 'history_jump', entryId: body.entryId };
  }
  if (type === MSG_HISTORY_CLEAR) {
    return { kind: 'history_clear' };
  }
  return null;
};
