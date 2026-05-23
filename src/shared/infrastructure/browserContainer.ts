import { browser } from '$app/environment';
import { HttpFeatureRepository } from '$features/behavior-model/infrastructure/persistence/HttpFeatureRepository';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { seedFeatures } from '$features/behavior-model/infrastructure/seed/seedFeatures';
import {
  sampleFeatureSnapshots,
  sampleProjectSnapshots
} from '$features/behavior-model/infrastructure/seed/sampleSnapshots';
import { HttpProjectRepository } from '$features/projects/infrastructure/persistence/HttpProjectRepository';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import { HttpDomainRepository } from '$features/domains/infrastructure/persistence/HttpDomainRepository';
import { InMemoryDomainRepository } from '$features/domains/infrastructure/persistence/InMemoryDomainRepository';
import { createContainer, type Container } from './container';

let cached: Container | null = null;

export const getBrowserContainer = async (): Promise<Container> => {
  if (cached) return cached;
  const repository = browser
    ? new HttpFeatureRepository()
    : new InMemoryFeatureRepository();
  const projectRepository = browser
    ? new HttpProjectRepository()
    : new InMemoryProjectRepository();
  const domainRepository = browser
    ? new HttpDomainRepository()
    : new InMemoryDomainRepository();
  const container = createContainer({
    repository,
    projectRepository,
    domainRepository,
    samples: [...seedFeatures, ...sampleFeatureSnapshots],
    projectSamples: sampleProjectSnapshots
  });
  cached = container;
  return container;
};
