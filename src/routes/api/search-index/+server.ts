import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSearchIndex } from '$lib/server/searchIndex';

export const prerender = false;

/**
 * Serves the precomputed whole-model search index that backs the header global
 * search. The build + freshness logic lives in `$lib/server/searchIndex`; this
 * route is just the transport. Auth rides the same hooks/token as every other
 * `/api` route (the browser sends it via `apiFetch`).
 */
export const GET: RequestHandler = async () => {
  const docs = await getSearchIndex();
  return json({ docs });
};
