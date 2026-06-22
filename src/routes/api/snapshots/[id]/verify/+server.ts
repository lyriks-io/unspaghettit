import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';
import { verifyFeaturesUseCase } from '$features/verification/application/use-cases/VerifyFeatures';
import { fileBehavioralIndexReader } from '$features/verification/infrastructure/persistence/FileBehavioralIndexReader';

export const prerender = false;

/**
 * Run the verification spine for one feature and return the report. The cohort
 * is scoped to the feature's project (when it belongs to one) so the
 * cross-feature checks — event coherence, cascade resolution — see the siblings
 * they need; otherwise it's just this feature. Model checking is on by default
 * (so the view can show counterexamples); pass `?modelCheck=0` to skip the
 * heavier state-space exploration.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id as FeatureId;
  const { repo, projectRepo } = getSnapshotRepository();

  let cohort: readonly FeatureId[] = [id];
  for (const summary of await projectRepo.list()) {
    const project = await projectRepo.get(summary.id);
    if (project?.featureIds.some((f) => String(f) === String(id))) {
      cohort = project.featureIds;
      break;
    }
  }

  const verify = verifyFeaturesUseCase({ features: repo, index: fileBehavioralIndexReader({}) });
  const report = await verify({
    featureIds: cohort,
    modelCheck: url.searchParams.get('modelCheck') !== '0'
  });
  return json(report);
};
