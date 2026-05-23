import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

export const GET: RequestHandler = async () => {
  const { domainRepo, directory } = getSnapshotRepository();
  const summaries = await domainRepo.list();
  return json({ directory, summaries });
};
