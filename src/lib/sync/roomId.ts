export type RoomKind = 'feature' | 'project' | 'implementation-status';

export type RoomId = `${RoomKind}:${string}`;

// Room ids reach the snapshot-on-disk layer through `statusFilePath(directory,
// ownerSlug, id)`, which builds a path via `path.join`. Without a charset
// guard, a WebSocket client connecting to `/sync/implementation-status:..%2F..%2Fevil`
// would persist attacker-controlled JSON outside the snapshot tree. The
// charset below is intentionally narrow: lowercase alphanumerics + hyphen +
// underscore covers slugs and UUIDs and rejects every path-traversal byte
// (`/`, `\`, `..`, `:`, null) as well as percent-encoded variants.
const VALID_ID = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LEN = 128;

export const makeRoomId = (kind: RoomKind, id: string): RoomId =>
  `${kind}:${id}` as RoomId;

export const parseRoomId = (
  room: string
): { kind: RoomKind; id: string } | null => {
  const i = room.indexOf(':');
  if (i < 0) return null;
  const kind = room.slice(0, i);
  const id = room.slice(i + 1);
  if (kind !== 'feature' && kind !== 'project' && kind !== 'implementation-status')
    return null;
  if (!id || id.length > MAX_ID_LEN) return null;
  if (!VALID_ID.test(id)) return null;
  return { kind, id };
};

export const ROOM_DOC_FIELD = 'data';
export const ROOM_DOC_MAP = 'snapshot';
