import type { Clock } from '$shared/domain/Clock';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { DomainRepository } from '../ports/DomainRepository';

export const addProjectToDomainUseCase = (deps: {
  repository: DomainRepository;
  clock: Clock;
}) => {
  return async (domainId: DomainId, projectId: ProjectId): Promise<Domain> => {
    const current = await deps.repository.get(domainId);
    if (!current) throw new Error(`Domain ${domainId} not found`);
    if (current.projectIds.includes(projectId)) return current;
    const next: Domain = {
      ...current,
      projectIds: [...current.projectIds, projectId],
      updatedAt: deps.clock()
    };
    await deps.repository.save(next);
    return next;
  };
};
