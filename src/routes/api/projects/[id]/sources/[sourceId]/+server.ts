import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

/** Read one stored source document, full content included. */
export const GET: RequestHandler = async ({ params }) => {
  const { sourceRepo } = getSnapshotRepository();
  const source = await sourceRepo.find(params.sourceId);
  if (!source || source.projectId !== params.id) {
    throw error(404, `Source ${params.sourceId} not found in project ${params.id}`);
  }
  return json(source);
};

/**
 * Delete a stored source. Destructive: provenance spans recorded from it keep
 * only their snippet text. The dashboard confirms before calling this.
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const { sourceRepo } = getSnapshotRepository();
  const source = await sourceRepo.find(params.sourceId);
  if (!source || source.projectId !== params.id) {
    throw error(404, `Source ${params.sourceId} not found in project ${params.id}`);
  }
  await sourceRepo.delete(params.sourceId);
  return new Response(null, { status: 204 });
};
