import type { Clock } from '$shared/domain/Clock';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainRepository } from '../ports/DomainRepository';

export const saveDomainUseCase = (deps: { repository: DomainRepository; clock: Clock }) => {
  return async (domain: Domain): Promise<Domain> => {
    const updated: Domain = { ...domain, updatedAt: deps.clock() };
    await deps.repository.save(updated);
    return updated;
  };
};
