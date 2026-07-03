import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { contentExtraBlueprints } from './extras';
import { reviewsBlueprint } from './ReviewsBlueprint';

export const contentBlueprints: readonly SurfaceBlueprint[] = [
  reviewsBlueprint,
  ...contentExtraBlueprints
];
