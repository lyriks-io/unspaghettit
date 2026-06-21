import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openLocalDirectory } from '$lib/server/openLocalDirectory';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

export const GET: RequestHandler = () => {
  const { directory } = getSnapshotRepository();
  return json({ directory });
};

export const POST: RequestHandler = async () => {
  const { directory } = getSnapshotRepository();

  try {
    await openLocalDirectory(directory);
  } catch (cause) {
    console.error(`Could not open snapshot directory "${directory}":`, cause);
    throw error(500, 'Could not open the snapshot directory on this computer.');
  }

  return json({ ok: true, directory });
};
