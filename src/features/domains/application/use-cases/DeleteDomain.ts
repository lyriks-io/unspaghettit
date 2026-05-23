import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { DomainRepository } from '../ports/DomainRepository';

export const deleteDomainUseCase = (deps: { repository: DomainRepository }) => {
  return (id: DomainId): Promise<void> => deps.repository.delete(id);
};
