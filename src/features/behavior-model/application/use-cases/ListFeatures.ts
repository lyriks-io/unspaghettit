import type {
  FeatureRepository,
  FeatureSummary
} from '../ports/FeatureRepository';

export const listFeaturesUseCase = (deps: { repository: FeatureRepository }) => {
  return async (): Promise<readonly FeatureSummary[]> => {
    return deps.repository.list();
  };
};
