import type { SurfaceBlueprint } from '../domain/entities/SurfaceBlueprint';
import type { BlueprintRepository } from '../domain/repositories/BlueprintRepository';
import type { BlueprintId } from '../domain/value-objects/BlueprintId';
import { authBlueprints } from './blueprints/auth';
import { commerceBlueprints } from './blueprints/commerce';
import { contentBlueprints } from './blueprints/content';
import { onboardingBlueprints } from './blueprints/onboarding';
import { utilityBlueprints } from './blueprints/utility';

const allBlueprints: readonly SurfaceBlueprint[] = [
  ...authBlueprints,
  ...commerceBlueprints,
  ...contentBlueprints,
  ...onboardingBlueprints,
  ...utilityBlueprints
];

const byId = new Map(allBlueprints.map((b) => [b.id, b] as const));

export const inMemoryBlueprintRepository: BlueprintRepository = {
  list: () => allBlueprints,
  findById: (id: BlueprintId) => byId.get(id)
};
