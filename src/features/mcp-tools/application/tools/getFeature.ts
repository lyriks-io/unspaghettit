import type { Feature } from '$features/behavior-model/domain/entities/Feature';

export type GetFeatureOutput = Feature;

export const getFeatureTool = (feature: Feature): GetFeatureOutput => feature;
