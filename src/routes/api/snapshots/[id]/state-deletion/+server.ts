import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stateDeletionCommand } from '$lib/server/stateDeletionComposition';
import { getSyncManager } from '$lib/server/sync';
import { makeRoomId } from '$lib/sync/roomId';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    ['surfaceId', 'stateDefinitionId'].some((k) => typeof body[k] !== 'string' || !body[k]) ||
    (body.featureId !== undefined && body.featureId !== params.id) ||
    (body.projectId != null && typeof body.projectId !== 'string')
  )
    error(400, 'Invalid state deletion command');
  try {
    // Make pending collaborative edits visible to the host's authoritative read.
    await getSyncManager().manager.flush();
    const result = await stateDeletionCommand(request).execute({
      featureId: params.id,
      projectId: body.projectId ?? null,
      surfaceId: body.surfaceId,
      stateDefinitionId: body.stateDefinitionId
    });
    if (result.ok) await getSyncManager().manager.reloadFromDisk(makeRoomId('feature', params.id));
    return json(result);
  } catch (cause) {
    error(503, (cause as Error).message);
  }
};
