import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { systemClock } from '$shared/domain/Clock';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { createSyncAwareFeatureRepository } from '$lib/server/syncAwareRepositories';
import { getFeatureUseCase } from '$features/behavior-model/application/use-cases/GetFeature';
import { saveFeatureUseCase } from '$features/behavior-model/application/use-cases/SaveFeature';
import { deleteFeatureUseCase } from '$features/behavior-model/application/use-cases/DeleteFeature';
import { FeatureValidationError } from '$features/behavior-model/application/use-cases/MutateFeature';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { repo } = getSnapshotRepository();
  const feature = await getFeatureUseCase({ repository: repo })(id);
  if (!feature) throw error(404, `Snapshot ${id} not found`);
  return json(feature);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const id = params.id as FeatureId;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be an Feature object');
  const feature = body as Feature;
  if (feature.id !== id) {
    throw error(400, `Body id "${feature.id}" does not match URL id "${id}"`);
  }
  // Delegate validation + persistence to the use case (the same diff-aware gate
  // and sync-bridge write path the rest of the app saves through), instead of
  // re-implementing validateFeature here where it could drift.
  const { repo } = getSnapshotRepository();
  const saveFeature = saveFeatureUseCase({
    repository: createSyncAwareFeatureRepository(repo),
    clock: systemClock
  });
  try {
    await saveFeature(feature);
  } catch (e) {
    if (e instanceof FeatureValidationError) {
      throw error(400, `Feature validation failed:\n - ${e.errors.join('\n - ')}`);
    }
    throw e;
  }
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { repo } = getSnapshotRepository();
  await deleteFeatureUseCase({ repository: repo })(id);
  return new Response(null, { status: 204 });
};
