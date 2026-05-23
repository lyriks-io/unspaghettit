import type { FeatureSummary } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureRepository } from '../ports/FeatureRepository';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';

export type FeatureCardModel = FeatureSummary & {
  readonly maturityPercentage: number;
  readonly criticalIssueCount: number;
  readonly recommendedIssueCount: number;
};

export const listFeaturesWithMaturityUseCase = (deps: { repository: FeatureRepository }) => {
  return async (): Promise<readonly FeatureCardModel[]> => {
    const summaries = await deps.repository.list();
    const enriched = await Promise.all(
      summaries.map(async (summary): Promise<FeatureCardModel> => {
        const full = await deps.repository.get(summary.id);
        if (!full) {
          return {
            ...summary,
            maturityPercentage: 100,
            criticalIssueCount: 0,
            recommendedIssueCount: 0
          };
        }
        const report = scoreFeature(full);
        return {
          ...summary,
          maturityPercentage: report.percentage,
          criticalIssueCount: report.criticalIssues.length,
          recommendedIssueCount: report.recommendedIssues.length
        };
      })
    );
    return enriched;
  };
};
