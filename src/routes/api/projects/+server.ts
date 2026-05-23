import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

export const GET: RequestHandler = async () => {
  const { projectRepo, directory } = getSnapshotRepository();
  const summaries = await projectRepo.list();
  return json({ directory, summaries });
};
