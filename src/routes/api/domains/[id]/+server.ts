import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import { systemClock } from '$shared/domain/Clock';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { getDomainUseCase } from '$features/domains/application/use-cases/GetDomain';
import { saveDomainUseCase } from '$features/domains/application/use-cases/SaveDomain';
import { deleteDomainUseCase } from '$features/domains/application/use-cases/DeleteDomain';

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as DomainId;
  const { domainRepo } = getSnapshotRepository();
  const domain = await getDomainUseCase({ repository: domainRepo })(id);
  if (!domain) throw error(404, `Domain ${id} not found`);
  return json(domain);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const id = params.id as DomainId;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be a Domain object');
  const domain = body as Domain;
  if (domain.id !== id) {
    throw error(400, `Body id "${domain.id}" does not match URL id "${id}"`);
  }
  if (typeof domain.name !== 'string' || domain.name.trim().length === 0) {
    throw error(400, 'Domain name is required');
  }
  const { domainRepo } = getSnapshotRepository();
  await saveDomainUseCase({ repository: domainRepo, clock: systemClock })(domain);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id as DomainId;
  const { domainRepo } = getSnapshotRepository();
  await deleteDomainUseCase({ repository: domainRepo })(id);
  return new Response(null, { status: 204 });
};
