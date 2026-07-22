import type { FeatureSummary } from '../../application/ports/FeatureRepository';
import type { Feature } from '../entities/Feature';
import { normalizeTags } from '$shared/domain/Tags';

/**
 * Build a Feature's summary. ONE definition, shared by every repository, so the
 * counts a client renders can't depend on which adapter answered.
 *
 * Every count here is SUMMABLE across features (see `FeatureSummary`), which is
 * what lets the project page total them without loading a single full Feature.
 */
export const summarizeFeature = (feature: Feature): FeatureSummary => ({
  id: feature.id,
  name: feature.name,
  description: feature.description,
  tags: normalizeTags(feature.tags),
  surfaceCount: feature.surfaces.length,
  actionCount: feature.surfaces.reduce((acc, s) => acc + s.actions.length, 0),
  stateCount: feature.surfaces.reduce((acc, s) => acc + s.stateDefinitions.length, 0),
  surfaceRuleCount: feature.surfaces.reduce((acc, s) => acc + s.rules.length, 0),
  personaCount: feature.personas.length,
  createdAt: feature.createdAt,
  updatedAt: feature.updatedAt
});
