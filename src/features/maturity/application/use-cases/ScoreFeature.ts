import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import type { MaturityReport } from '$features/maturity/domain/MaturityReport';
import type { ReportLanguage } from '$shared/language';

export const scoreFeatureUseCase = () => {
  return (feature: Feature, language: ReportLanguage = 'en'): MaturityReport =>
    scoreFeature(feature, language);
};
