import type { Clock } from '$shared/domain/Clock';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { DomainRepository } from '../ports/DomainRepository';

export const removeProjectFromDomainUseCase = (deps: {
  repository: DomainRepository;
  clock: Clock;
}) => {
  return async (domainId: DomainId, projectId: ProjectId): Promise<Domain> => {
    const current = await deps.repository.get(domainId);
    if (!current) throw new Error(`Domain ${domainId} not found`);
    const next: Domain = {
      ...current,
      projectIds: current.projectIds.filter((id) => id !== projectId),
      updatedAt: deps.clock()
    };
    await deps.repository.save(next);
    return next;
  };
};
