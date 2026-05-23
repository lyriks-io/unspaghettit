import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

/**
 * Returns the full self-contained ProjectBundleV1 for one Project so the
 * browser can encrypt it client-side and trigger a `.unspa` download.
 *
 * Plaintext only — encryption is the caller's responsibility. The
 * passphrase never reaches the server, which keeps the security model
 * simple ("the only way to decrypt is the user's passphrase") and avoids
 * any server-side key storage. The endpoint is GET and unauthenticated
 * for the same reason every other API on this dashboard is: it's
 * intended for `127.0.0.1` use only (the dashboard CLI warns loudly on
 * any non-loopback bind).
 */
export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as ProjectId;
  const { projectRepo, repo: featureRepo, statusRepo } = getSnapshotRepository();
  const project = await projectRepo.get(id);
  if (!project) throw error(404, `Project ${id} not found`);

  const features: Feature[] = [];
  const statuses: ImplementationStatus[] = [];
  for (const fid of project.featureIds) {
    const feature = await featureRepo.get(asFeatureId(String(fid)));
    if (feature) features.push(feature);
    const status = await statusRepo.get(asFeatureId(String(fid)));
    if (status) statuses.push(status);
  }

  const bundle: ProjectBundleV1 = {
    format: 'unspaghettit-project-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    features,
    statuses
  };
  return json(bundle);
};
