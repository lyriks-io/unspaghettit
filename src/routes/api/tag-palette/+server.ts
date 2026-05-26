import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  isTagColor,
  normalizeTagColor,
  type TagAssignment,
  type TagPalette
} from '$shared/domain/TagPalette';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

export const GET: RequestHandler = async () => {
  const { tagPaletteRepo } = getSnapshotRepository();
  const palette = await tagPaletteRepo.get();
  return json(palette);
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') {
    throw error(400, 'Body must be a TagPalette object');
  }
  const assignmentsRaw = (body as { assignments?: unknown }).assignments;
  if (!assignmentsRaw || typeof assignmentsRaw !== 'object') {
    throw error(400, 'TagPalette.assignments must be an object');
  }
  const assignments: Record<string, TagAssignment> = {};
  for (const [type, value] of Object.entries(assignmentsRaw as Record<string, unknown>)) {
    const key = type.trim().toLowerCase();
    if (!key) continue;
    if (value === null) {
      assignments[key] = null;
      continue;
    }
    if (!isTagColor(value)) {
      throw error(
        400,
        `Invalid value for tag type "${type}". Expected #rrggbb or null.`
      );
    }
    assignments[key] = normalizeTagColor(value);
  }
  const palette: TagPalette = { assignments };
  const { tagPaletteRepo } = getSnapshotRepository();
  await tagPaletteRepo.save(palette);
  return json(palette);
};
