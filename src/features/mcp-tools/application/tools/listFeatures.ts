import type { FeatureSummary } from '$features/behavior-model/application/ports/FeatureRepository';

export type ListFeaturesOutput = readonly FeatureSummary[];

export const listFeaturesTool = (
  summaries: readonly FeatureSummary[]
): ListFeaturesOutput => summaries;
