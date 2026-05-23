import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { replaceSnapshotViaSync } from '$lib/server/syncBridge';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo } = getSnapshotRepository();
  const project = await projectRepo.get(id);
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
  await replaceSnapshotViaSync('project', id, project);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo } = getSnapshotRepository();
  await projectRepo.delete(id);
  return new Response(null, { status: 204 });
};
