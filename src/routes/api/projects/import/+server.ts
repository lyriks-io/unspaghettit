import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { replaceSnapshotViaSync } from '$lib/server/syncBridge';

export const prerender = false;

/**
 * Restore a decrypted ProjectBundleV1 onto the snapshot repository. Writes:
 *   1. every Feature first (so add_feature_to_project guard in the
 *      project save can resolve them) — wrapped via the sync bridge so
 *      open editors get the new snapshots reactively.
 *   2. then the Project itself, with the same id + featureIds[] from the
 *      bundle. This preserves the original ordering, queue, and any
 *      project metadata.
 *   3. lastly the implementation-status sidecars (idempotent if absent).
 *
 * Conflict policy (v1): IDs from the bundle are preserved. If a project
 * with the same id already exists, this overwrites it. That's intentional
 * for the "I'm restoring my own backup" flow; if you need a fresh copy
 * with new ids, that's a separate "fork" feature.
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

  const { repo: featureRepo, statusRepo } = getSnapshotRepository();

  for (const feature of bundle.features) {
    await replaceSnapshotViaSync('feature', feature.id, feature as Feature);
  }

  await replaceSnapshotViaSync('project', bundle.project.id, bundle.project as Project);

  for (const status of bundle.statuses) {
    // ImplementationStatus uses its own repo; not wrapped through the
    // sync bridge yet. Write directly. A future iteration could route
    // through a sync-aware status repo for cross-tab freshness.
    void featureRepo; // imported above; statuses are written via statusRepo
    await statusRepo.save(status as ImplementationStatus);
  }

  return json({
    ok: true,
    projectId: bundle.project.id,
    featuresImported: bundle.features.length,
    statusesImported: bundle.statuses.length
  });
};
