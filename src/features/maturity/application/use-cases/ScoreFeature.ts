import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import type { MaturityReport } from '$features/maturity/domain/MaturityReport';

export const scoreFeatureUseCase = () => {
  return (feature: Feature): MaturityReport => scoreFeature(feature);
};
