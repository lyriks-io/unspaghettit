import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { DomainRepository } from '../ports/DomainRepository';

export const getDomainUseCase = (deps: { repository: DomainRepository }) => {
  return (id: DomainId): Promise<Domain | null> => deps.repository.get(id);
};
