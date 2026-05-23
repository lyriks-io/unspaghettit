import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { validateFeature } from '$features/behavior-model/domain/services/FeatureValidator';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { replaceSnapshotViaSync } from '$lib/server/syncBridge';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { repo } = getSnapshotRepository();
  const feature = await repo.get(id);
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
  if (typeof feature.name !== 'string' || feature.name.trim().length === 0) {
    throw error(400, 'Feature name is required');
  }
  const validation = validateFeature(feature);
  if (!validation.valid) {
    throw error(400, `Feature validation failed:\n - ${validation.errors.join('\n - ')}`);
  }
  await replaceSnapshotViaSync('feature', id, feature);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { repo } = getSnapshotRepository();
  await repo.delete(id);
  return new Response(null, { status: 204 });
};
