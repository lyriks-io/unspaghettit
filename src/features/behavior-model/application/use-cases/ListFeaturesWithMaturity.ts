import type { FeatureSummary } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureRepository } from '../ports/FeatureRepository';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';

export type FeatureCardModel = FeatureSummary & {
  readonly maturityPercentage: number;
  readonly criticalIssueCount: number;
  readonly recommendedIssueCount: number;
  /**
   * Implementation coverage for the feature's expected tags. Null when the
   * feature has nothing taggable yet (no actions/states/etc.) - the chip
   * collapses to "-" rather than misleading 100%.
   */
  readonly implementationPercentage: number | null;
  readonly implementationFoundCount: number;
  readonly implementationExpectedCount: number;
  /** False when the repo has no `.unspa.json` report yet for this feature. */
  readonly implementationHasReport: boolean;
};

export const listFeaturesWithMaturityUseCase = (deps: {
  repository: FeatureRepository;
  statusRepository: ImplementationStatusRepository;
}) => {
  return async (): Promise<readonly FeatureCardModel[]> => {
    const summaries = await deps.repository.list();
    const enriched = await Promise.all(
      summaries.map(async (summary): Promise<FeatureCardModel> => {
        const [full, status] = await Promise.all([
          deps.repository.get(summary.id),
          deps.statusRepository.get(summary.id)
        ]);
        if (!full) {
          return {
            ...summary,
            maturityPercentage: 100,
            criticalIssueCount: 0,
            recommendedIssueCount: 0,
            implementationPercentage: null,
            implementationFoundCount: 0,
            implementationExpectedCount: 0,
            implementationHasReport: false
          };
        }
        const report = scoreFeature(full);
        const impl = computeImplementationBreakdown(full, status);
        return {
          ...summary,
          maturityPercentage: report.percentage,
          criticalIssueCount: report.criticalIssues.length,
          recommendedIssueCount: report.recommendedIssues.length,
          implementationPercentage:
            impl.expectedCount === 0 ? null : impl.percentage,
          implementationFoundCount: impl.foundCount,
          implementationExpectedCount: impl.expectedCount,
          implementationHasReport: impl.hasReport
        };
      })
    );
    return enriched;
  };
};
