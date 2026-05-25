import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSyncManager } from '$lib/server/sync';
import { getSyncEventsHub, type SyncEvent } from '$lib/server/sync/syncEventsHub';
import { makeRoomId, parseRoomId, type RoomId, type RoomKind } from '$lib/sync/roomId';
import { computeChangeDescriptor } from '$lib/server/sync/changeDescriptor';
import { currentActiveUser } from '$lib/server/sync/identityRegistry';
import { loadSnapshotFromDisk } from '$lib/server/sync/snapshotIo';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { asProjectId } from '$features/projects/domain/value-objects/ids';

export const prerender = false;

/**
 * Out-of-band invalidation hook for processes that wrote directly to disk
 * (notably the MCP server in standalone mode). The body is
 *   { kind, id, name?, op? }
 * — name/op are the MCP-provided human label and verb. We then:
 *
 *   1. Snapshot the room's in-memory state (the "before") for diffing.
 *   2. reloadFromDisk to pull in the new state.
 *   3. Snapshot again (the "after").
 *   4. Diff before vs after to produce a structured ChangeDescriptor
 *      (op = added | removed | renamed | edited | queued | ..., path =
 *      ["FeatureName", "SurfaceName", "ActionName"]).
 *   5. For feature events, look up the containing project so toasts can
 *      breadcrumb the full hierarchy.
 *   6. Broadcast a rich SyncEvent so consumers (SSE → SyncToast, history
 *      panel, etc.) all see the same diff.
 *
 * `id` flows into `statusFilePath(...).join()`, so we re-use the same
 * charset guard that `parseRoomId` enforces on the WebSocket path to make
 * sure an unauthenticated POST can't escape the snapshot directory.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be { kind, id }');
  const { kind, id, name, op } = body as {
    kind?: string;
    id?: string;
    name?: unknown;
    op?: unknown;
  };
  if (kind !== 'feature' && kind !== 'project' && kind !== 'implementation-status') {
    throw error(400, 'kind must be feature|project|implementation-status');
  }
  if (typeof id !== 'string' || id.length === 0) throw error(400, 'id is required');
  if (!parseRoomId(`${kind}:${id}`)) {
    throw error(400, 'id must match [A-Za-z0-9_-]+');
  }

  const { manager, directory } = getSyncManager();
  const roomKind = kind as RoomKind;
  const roomId: RoomId = makeRoomId(roomKind, id);

  // Capture the pre-reload snapshot. Null when the room hasn't been
  // loaded yet (no open editor for that entity).
  const previousSnapshot = manager.getSnapshot(roomId);
  await manager.reloadFromDisk(roomId);

  // Post-reload snapshot for diffing. The in-memory path is the fast
  // case (any open editor), but `reloadFromDisk` is a no-op when the
  // room wasn't loaded — so for MCP writes that target features no one
  // has opened yet, `getSnapshot` would return null and every toast
  // would fall through to the "unknown" placeholder. We eagerly load
  // the room on first MCP touch so:
  //   - this notification's nextSnapshot has the freshly-loaded state
  //   - every SUBSEQUENT MCP write on the same entity gets a true diff
  //     (prev = previously-loaded in-memory state, not null) and the
  //     toast can show the full breadcrumb path. The very first write
  //     after a dashboard restart will still appear as "created <name>"
  //     because no prior in-memory state exists — that's accepted.
  let nextSnapshot = manager.getSnapshot(roomId);
  if (nextSnapshot === null && op !== 'delete') {
    try {
      await manager.getOrLoad(roomId);
      nextSnapshot = manager.getSnapshot(roomId);
    } catch {
      // getOrLoad failed (e.g. malformed file). Fall back to a one-shot
      // disk read so we at least have the entity name for the toast.
      try {
        nextSnapshot = await loadSnapshotFromDisk(directory, roomKind, id);
      } catch {
        // Both paths failed — let the descriptor emit its generic
        // 'saved' fallback rather than 500ing the request.
      }
    }
  }

  const { repo: featureRepo, projectRepo } = getSnapshotRepository();
  let resolveFeatureName: ((featureId: string) => string | undefined) | undefined;
  if (roomKind === 'project') {
    // Resolve newly attached/detached/queued feature ids to names so the
    // breadcrumb reads "Project › Feature Name" instead of "Project ›
    // feature abcd1234". One bulk fetch up front beats N round-trips
    // inside the synchronous diff path — list() returns slim summaries
    // (id + name + counts) so this is cheap.
    try {
      const summaries = await featureRepo.list();
      const byId = new Map(summaries.map((s) => [String(s.id), s.name]));
      resolveFeatureName = (fid) => byId.get(fid);
    } catch {
      // Lookup is decorative; missing names fall back to "feature xxxx".
    }
  }
  const descriptor =
    op === 'delete'
      ? null
      : computeChangeDescriptor(roomKind, previousSnapshot, nextSnapshot, resolveFeatureName);

  // For feature events, find the containing project so toasts can
  // breadcrumb "Project › Feature › ...". Best-effort; missing project
  // just leaves projectName undefined and the toast renders without it.
  let projectName: string | undefined;
  if (roomKind === 'feature' && op !== 'delete') {
    try {
      const projects = await projectRepo.list();
      for (const summary of projects) {
        const project = await projectRepo.get(asProjectId(String(summary.id)));
        if (project?.featureIds.some((fid) => String(fid) === id)) {
          projectName = project.name;
          break;
        }
      }
    } catch {
      // Lookup is decorative — if it fails, the toast still renders.
    }
  }

  // Attribute MCP-driven SSE events to whichever human is currently at
  // the dashboard, so the toast can render "AI · John". Resolved here
  // (server-side) so SSE consumers don't have to round-trip to figure
  // out who's connected. The reload endpoint is reachable from any
  // process; the registry only holds names from named (non-anonymous)
  // WebSocket connections.
  const actingFor = currentActiveUser();

  const event: SyncEvent = {
    kind: roomKind,
    id,
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    ...(projectName ? { projectName } : {}),
    ...(op === 'save' || op === 'delete' ? { op } : {}),
    ...(descriptor ? { changeOp: descriptor.op, changePath: descriptor.path } : {}),
    ...(op === 'delete' ? { changeOp: 'deleted' as const } : {}),
    ...(descriptor?.previousName ? { previousName: descriptor.previousName } : {}),
    ...(actingFor ? { actingFor } : {})
  };
  getSyncEventsHub().broadcast(event);
  return json({ ok: true });
};

