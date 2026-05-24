import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '../ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { FeatureCardModel } from './ListFeaturesWithMaturity';

export const getFeatureCardUseCase = (deps: {
  repository: FeatureRepository;
  statusRepository: ImplementationStatusRepository;
}) => {
  return async (id: FeatureId): Promise<FeatureCardModel | null> => {
    const [feature, status] = await Promise.all([
      deps.repository.get(id),
      deps.statusRepository.get(id)
    ]);
    if (!feature) return null;
    const report = scoreFeature(feature);
    const impl = computeImplementationBreakdown(feature, status);
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
      recommendedIssueCount: report.recommendedIssues.length,
      implementationPercentage:
        impl.expectedCount === 0 ? null : impl.percentage,
      implementationFoundCount: impl.foundCount,
      implementationExpectedCount: impl.expectedCount,
      implementationHasReport: impl.hasReport
    };
  };
};
