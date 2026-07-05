import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import {
  createProjectSource,
  toSourceMeta
} from '$features/source-provenance/domain/ProjectSource';
import { systemClock } from '$shared/domain/Clock';
import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

/** List the project's stored source documents (metadata only, no content). */
export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo, sourceRepo } = getSnapshotRepository();
  const project = await projectRepo.get(id);
  if (!project) throw error(404, `Project ${id} not found`);
  const sources = await sourceRepo.listForProject(String(id));
  return json({ sources: sources.map(toSourceMeta) });
};

/**
 * Store text pasted in the dashboard as a new immutable source in the
 * project's sources/ folder. Identical content resolves to the existing
 * source (`deduped: true`) instead of storing a second copy.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const id = params.id as ProjectId;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  const { name, content } = (body ?? {}) as { name?: unknown; content?: unknown };
  if (typeof name !== 'string' || typeof content !== 'string') {
    throw error(400, 'Body must be { name: string, content: string }');
  }

  const { projectRepo, sourceRepo } = getSnapshotRepository();
  const project = await projectRepo.get(id);
  if (!project) throw error(404, `Project ${id} not found`);

  const existing = await sourceRepo.listForProject(String(id));
  const created = createProjectSource(
    {
      id: cryptoIdGenerator(),
      projectId: String(id),
      name,
      kind: 'pasted',
      content,
      attachedAt: systemClock()
    },
    existing
  );
  if (!created.ok) throw error(422, created.reason);
  if (!created.deduped) await sourceRepo.save(created.source);
  return json({ source: toSourceMeta(created.source), deduped: created.deduped });
};
