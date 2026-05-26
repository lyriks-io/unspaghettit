import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { systemClock } from '$shared/domain/Clock';
import type { Tag } from '$shared/domain/Tags';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import {
  createSyncAwareFeatureRepository,
  createSyncAwareProjectRepository
} from '$lib/server/syncAwareRepositories';
import { renameTagUseCase } from '$features/tag-palette/application/use-cases/RenameTag';

export const prerender = false;

const parseTag = (raw: unknown, label: string): Tag => {
  if (!raw || typeof raw !== 'object') throw error(400, `${label} must be {type, value}`);
  const obj = raw as { type?: unknown; value?: unknown };
  const type = typeof obj.type === 'string' ? obj.type.trim() : '';
  const value = typeof obj.value === 'string' ? obj.value.trim() : '';
  if (!type) throw error(400, `${label}.type is required`);
  if (!value) throw error(400, `${label}.value is required`);
  return { type, value };
};

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be {from, to}');
  const from = parseTag((body as { from?: unknown }).from, 'from');
  const to = parseTag((body as { to?: unknown }).to, 'to');

  const { projectRepo, repo, tagPaletteRepo } = getSnapshotRepository();
  const useCase = renameTagUseCase({
    projects: createSyncAwareProjectRepository(projectRepo),
    features: createSyncAwareFeatureRepository(repo),
    palette: tagPaletteRepo,
    clock: systemClock
  });
  const result = await useCase({ from, to });
  return json(result);
};
