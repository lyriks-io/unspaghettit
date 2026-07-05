import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';
import { getSnapshotRepository } from '$lib/server/snapshotRepository';

export const prerender = false;

/**
 * Provenance for one feature: the sidecar (spans + source links + legacy
 * embedded file) plus the linked project-level source documents resolved to
 * full content, so the viewer can render highlights without a second
 * round-trip per source.
 */
export const GET: RequestHandler = async ({ params }) => {
  const id = params.id as FeatureId;
  const { provenanceRepo, sourceRepo } = getSnapshotRepository();
  const provenance = await provenanceRepo.get(id);
  if (!provenance) return json({ provenance: null, sources: [] });

  const sources: ProjectSource[] = [];
  for (const sourceId of provenance.sourceIds) {
    const source = await sourceRepo.find(sourceId);
    if (source) sources.push(source);
  }
  return json({ provenance, sources });
};
