import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { systemClock } from '$shared/domain/Clock';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { createSyncAwareProjectRepository } from '$lib/server/syncAwareRepositories';
import { getProjectUseCase } from '$features/projects/application/use-cases/GetProject';
import { saveProjectUseCase } from '$features/projects/application/use-cases/SaveProject';
import { deleteProjectUseCase } from '$features/projects/application/use-cases/DeleteProject';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo } = getSnapshotRepository();
  const project = await getProjectUseCase({ repository: projectRepo })(id);
  if (!project) throw error(404, `Project ${id} not found`);
  return json(project);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const id = params.id as ProjectId;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be a Project object');
  const project = body as Project;
  if (project.id !== id) {
    throw error(400, `Body id "${project.id}" does not match URL id "${id}"`);
  }
  if (typeof project.name !== 'string' || project.name.trim().length === 0) {
    throw error(400, 'Project name is required');
  }
  if (typeof project.description !== 'string' || project.description.trim().length === 0) {
    throw error(400, 'Project description is required');
  }
  // Persist (tag normalization + updatedAt + sync-bridge write) through the use
  // case + port instead of calling replaceSnapshotViaSync straight from transport.
  const { projectRepo } = getSnapshotRepository();
  await saveProjectUseCase({
    repository: createSyncAwareProjectRepository(projectRepo),
    clock: systemClock
  })(project);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo } = getSnapshotRepository();
  await deleteProjectUseCase({ repository: projectRepo })(id);
  return new Response(null, { status: 204 });
};
