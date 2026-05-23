import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { statusRepo } = getSnapshotRepository();
  const status = await statusRepo.get(id);
  return json(status);
};
