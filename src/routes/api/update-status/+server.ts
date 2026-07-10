import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pkg from '../../../../package.json';
import { resolveUpdateStatus } from '$features/update-check/infrastructure/updateCheck';

export const prerender = false;

/**
 * Server-side update check for the dashboard banner. Runs on the Node server
 * (where network + the cache file live), cache-first with a short bounded
 * fetch on a cold cache, and fail-silent: an unreachable registry yields
 * `latest:null` rather than an error. The env opt-out
 * (UNSPA_NO_UPDATE_CHECK / CI) turns it into an "unknown" status so the banner
 * stays hidden. The client fetches this on mount, so a slow check never blocks
 * page render.
 */
export const GET: RequestHandler = async () => {
  const status = await resolveUpdateStatus({ current: (pkg as { version: string }).version });
  return json(status);
};
