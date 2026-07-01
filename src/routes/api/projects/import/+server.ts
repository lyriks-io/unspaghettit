import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import {
  createSyncAwareFeatureRepository,
  createSyncAwareProjectRepository
} from '$lib/server/syncAwareRepositories';
import {
  BundleValidationError,
  importProjectBundleUseCase
} from '$features/projects/application/use-cases/ImportProjectBundle';

export const prerender = false;

/**
 * Restore a decrypted ProjectBundleV1 onto the snapshot repository. The
 * write-ordering + conflict policy lives in the importProjectBundle use case;
 * this handler only validates the wire envelope and wires sync-aware repos so
 * open editors get the restored snapshots reactively.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'Body must be a ProjectBundle');
  const bundle = body as ProjectBundleV1;
  if (bundle.format !== 'unspaghettit-project-bundle') {
    throw error(400, 'Body is not a ProjectBundle (wrong format tag)');
  }
  if (bundle.version !== 1) {
    throw error(400, `Unsupported bundle version ${bundle.version}`);
  }
  if (!bundle.project || typeof bundle.project.id !== 'string') {
    throw error(400, 'Bundle is missing a project');
  }

  const { repo, projectRepo, statusRepo } = getSnapshotRepository();
  const importBundle = importProjectBundleUseCase({
    features: createSyncAwareFeatureRepository(repo),
    projects: createSyncAwareProjectRepository(projectRepo),
    statuses: statusRepo
  });
  try {
    const result = await importBundle(bundle);
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof BundleValidationError) throw error(400, e.message);
    throw e;
  }
};
