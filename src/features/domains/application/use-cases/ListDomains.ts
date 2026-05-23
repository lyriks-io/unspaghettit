import type {
  DomainRepository,
  DomainSummary
} from '$features/domains/application/ports/DomainRepository';

export const listDomainsUseCase = (deps: { repository: DomainRepository }) => {
  return (): Promise<readonly DomainSummary[]> => deps.repository.list();
};
