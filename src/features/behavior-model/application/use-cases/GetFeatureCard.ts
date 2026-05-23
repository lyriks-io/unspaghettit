import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '../ports/FeatureRepository';
import type { FeatureCardModel } from './ListFeaturesWithMaturity';

export const getFeatureCardUseCase = (deps: { repository: FeatureRepository }) => {
  return async (id: FeatureId): Promise<FeatureCardModel | null> => {
    const feature = await deps.repository.get(id);
    if (!feature) return null;
    const report = scoreFeature(feature);
    return {
      id: feature.id,
      name: feature.name,
      description: feature.description,
      tags: feature.tags,
      surfaceCount: feature.surfaces.length,
      actionCount: feature.surfaces.reduce((acc, s) => acc + s.actions.length, 0),
      createdAt: feature.createdAt,
      updatedAt: feature.updatedAt,
      maturityPercentage: report.percentage,
      criticalIssueCount: report.criticalIssues.length,
      recommendedIssueCount: report.recommendedIssues.length
    };
  };
};
