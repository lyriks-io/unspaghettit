import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { HistoryEntry, HistoryView } from '../../sync/protocol';
import type { RoomId, RoomKind } from '../../sync/roomId';
import {
  UNASSIGNED_FOLDER,
  ensureHistoryDir,
  findProjectSlugForFeature,
  historyFilePath,
  historySuffix,
  walkBySuffix,
  type HistoryKind
} from '../../../shared/infrastructure/persistence/snapshotLayout';

const MAX_ENTRIES = 200;

const slugify = (name: string, fallback: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : fallback;
};

const roomKindToHistoryKind = (kind: RoomKind): HistoryKind => kind;

type LocatedHistory = { readonly path: string; readonly folder: string; readonly slug: string };

const findHistoryFile = (
  directory: string,
  kind: RoomKind,
  id: string
): LocatedHistory | null => {
  const suffix = historySuffix(roomKindToHistoryKind(kind));
  for (const { folder, file, path } of walkBySuffix(directory, suffix)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { id?: string };
      if (data.id === id) {
        return { path, folder, slug: file.slice(0, -suffix.length) };
      }
    } catch {
      // skip malformed
    }
  }
  return null;
};

const loadHistoryFromDisk = (
  directory: string,
  kind: RoomKind,
  id: string
): HistoryView | null => {
  const found = findHistoryFile(directory, kind, id);
  if (!found) return null;
  try {
    const data = JSON.parse(readFileSync(found.path, 'utf8')) as {
      entries?: HistoryEntry[];
      cursor?: number;
    };
    if (!Array.isArray(data.entries) || typeof data.cursor !== 'number') return null;
    return { entries: data.entries, cursor: data.cursor };
  } catch {
    return null;
  }
};

/**
 * Resolve which project folder a history file should live in.
 * - project history → the project's own folder.
 * - feature / status history → the owning project's folder, or __unassigned/.
 */
const ownerForHistory = (
  directory: string,
  kind: RoomKind,
  id: string,
  fallbackSlug: string
): string | null => {
  if (kind === 'project') return fallbackSlug;
  return findProjectSlugForFeature(directory, id);
};

const writeHistoryToDisk = async (
  directory: string,
  kind: RoomKind,
  id: string,
  name: string,
  view: HistoryView
): Promise<void> => {
  const historyKind = roomKindToHistoryKind(kind);
  const suffix = historySuffix(historyKind);
  const target = slugify(name, id);
  const existing = findHistoryFile(directory, kind, id);

  const ownerSlug = ownerForHistory(directory, kind, id, target);
  const ownerFolder = ownerSlug ?? UNASSIGNED_FOLDER;
  ensureHistoryDir(directory, ownerSlug);

  // Slugs are scoped to the owning folder.
  const takenSlugs = walkBySuffix(directory, suffix)
    .filter(({ folder }) => folder === ownerFolder)
    .map(({ file }) => file.slice(0, -suffix.length))
    .filter((slug) => !existing || slug !== existing.slug);
  const finalSlug = takenSlugs.includes(target)
    ? `${target}-${id.slice(0, 8)}`
    : target;

  if (
    existing &&
    (existing.folder !== ownerFolder || existing.slug !== finalSlug) &&
    existsSync(existing.path)
  ) {
    unlinkSync(existing.path);
  }

  const path = historyFilePath(directory, ownerSlug, historyKind, finalSlug);
  const body = { id, entries: view.entries, cursor: view.cursor };
  await writeFileAtomic(path, JSON.stringify(body, null, 2), 'utf8');
};

const PERSIST_DEBOUNCE_MS = 400;

type RoomHistory = {
  view: HistoryView;
  name: string;
  persistTimer: NodeJS.Timeout | null;
};

/**
 * Per-feature/project edit log. Append-only with a cursor: jumping back and
 * editing wipes everything past the new cursor (classic redo-stack semantics).
 * Persisted to unspa/<slug>.<kind>.history.json next to the snapshot file.
 *
 * The history is intentionally separate from the Y.Doc: keeping ~200 full POJO
 * snapshots inside the Y.Doc would balloon the per-room replication payload
 * for every new joiner. Clients fetch the history via dedicated wire frames
 * (history_snapshot / history_append) instead.
 */
export class HistoryStore {
  private rooms = new Map<RoomId, RoomHistory>();

  constructor(private readonly directory: string) {}

  /** Load (or initialize) history for a room. Returns the current view. */
  getOrInit(roomId: RoomId, kind: RoomKind, id: string, name: string): HistoryView {
    const existing = this.rooms.get(roomId);
    if (existing) {
      existing.name = name;
      return existing.view;
    }
    const fromDisk = loadHistoryFromDisk(this.directory, kind, id);
    const view: HistoryView = fromDisk ?? { entries: [], cursor: -1 };
    this.rooms.set(roomId, { view, name, persistTimer: null });
    return view;
  }

  view(roomId: RoomId): HistoryView | null {
    return this.rooms.get(roomId)?.view ?? null;
  }

  /**
   * Append a new entry for a write that just landed. If the cursor is not at
   * the tip, everything past it is trimmed first (the user branched off after
   * a jump). Returns the appended entry + new cursor for broadcast.
   */
  append(
    roomId: RoomId,
    kind: RoomKind,
    id: string,
    entry: HistoryEntry
  ): { entry: HistoryEntry; cursor: number; trimmed: boolean } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const view = room.view;
    let trimmed = false;
    if (view.cursor < view.entries.length - 1) {
      view.entries.length = view.cursor + 1;
      trimmed = true;
    }
    view.entries.push(entry);
    if (view.entries.length > MAX_ENTRIES) {
      const overflow = view.entries.length - MAX_ENTRIES;
      view.entries.splice(0, overflow);
    }
    view.cursor = view.entries.length - 1;
    this.schedulePersist(roomId, kind, id);
    return { entry, cursor: view.cursor, trimmed };
  }

  /**
   * Jump cursor to the entry with id. Does not mutate the entry list; the
   * caller is expected to apply the entry's snapshot to the Y.Doc. The next
   * append() will trim the tail if the cursor is not at the tip.
   */
  jumpTo(
    roomId: RoomId,
    kind: RoomKind,
    id: string,
    entryId: string
  ): { snapshot: unknown; cursor: number } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.view.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return null;
    room.view.cursor = idx;
    this.schedulePersist(roomId, kind, id);
    return { snapshot: room.view.entries[idx]?.snapshot, cursor: idx };
  }

  /**
   * Wipe the log for a room and optionally seed a single anchor entry so
   * the timeline isn't empty. Mutates the view in place — the caller is
   * responsible for broadcasting a fresh history_snapshot to peers (we
   * deliberately bypass the patched `append` so consumers don't see a
   * stale "append on top of existing" event).
   */
  clear(
    roomId: RoomId,
    kind: RoomKind,
    id: string,
    seed?: { readonly snapshot: unknown; readonly label: string; readonly author: string }
  ): HistoryView | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.view.entries = [];
    room.view.cursor = -1;
    if (seed) {
      const anchor: HistoryEntry = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        author: seed.author,
        label: seed.label,
        snapshot: seed.snapshot
      };
      room.view.entries.push(anchor);
      room.view.cursor = 0;
    }
    this.schedulePersist(roomId, kind, id);
    return room.view;
  }

  private schedulePersist(roomId: RoomId, kind: RoomKind, id: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = setTimeout(() => {
      void this.persist(roomId, kind, id);
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persist(roomId: RoomId, kind: RoomKind, id: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.persistTimer = null;
    try {
      await writeHistoryToDisk(this.directory, kind, id, room.name, room.view);
    } catch (err) {
      process.stderr.write(
        `[unspa-sync] history persist failed for ${roomId}: ${(err as Error).message}\n`
      );
    }
  }

  async flush(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [roomId, room] of this.rooms) {
      if (room.persistTimer) {
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
        const [kind, id] = roomId.split(':') as [RoomKind, string];
        tasks.push(this.persist(roomId, kind, id));
      }
    }
    await Promise.all(tasks);
  }
}
