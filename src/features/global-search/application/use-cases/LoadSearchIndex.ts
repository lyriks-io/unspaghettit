import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import type { DomainRepository } from '$features/domains/application/ports/DomainRepository';
import { buildSearchDocs } from '../../domain/buildSearchDocs';
import type {
  SearchDoc,
  SearchDomainInput,
  SearchProjectInput
} from '../../domain/SearchDoc';

/**
 * Loads the entire model and flattens it into the global-search index.
 *
 * Depends only on the repository ports (dependency inversion) — never on the
 * concrete container — mirroring use cases like GetProjectAggregate. Reads are
 * fanned out with Promise.all so the cost is dominated by the slowest fetch,
 * not their sum. The pure {@link buildSearchDocs} does all the walking; this
 * use case is just orchestration: list → fetch → hand off.
 */
export const loadSearchIndexUseCase = (deps: {
  features: FeatureRepository;
  projects: ProjectRepository;
  domains: DomainRepository;
}) => {
  return async (): Promise<readonly SearchDoc[]> => {
    const [projectSummaries, featureSummaries, domainSummaries] = await Promise.all([
      deps.projects.list(),
      deps.features.list(),
      deps.domains.list()
    ]);

    const [projects, features] = await Promise.all([
      Promise.all(
        projectSummaries.map((summary) => deps.projects.get(asProjectId(String(summary.id))))
      ),
      Promise.all(
        featureSummaries.map((summary) => deps.features.get(asFeatureId(String(summary.id))))
      )
    ]);

    const projectInputs: SearchProjectInput[] = projects
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((project) => ({
        id: String(project.id),
        name: project.name,
        description: project.description,
        tags: project.tags,
        featureIds: project.featureIds.map(String)
      }));

    const featureInputs: Feature[] = features.filter(
      (f): f is Feature => f !== null
    );

    const domainInputs: SearchDomainInput[] = domainSummaries.map((domain) => ({
      id: String(domain.id),
      name: domain.name,
      description: domain.description
    }));

    return buildSearchDocs({
      projects: projectInputs,
      features: featureInputs,
      domains: domainInputs
    });
  };
};
