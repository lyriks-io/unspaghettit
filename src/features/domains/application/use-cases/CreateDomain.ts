import type { Clock } from '$shared/domain/Clock';
import type { IdGenerator } from '$shared/domain/IdGenerator';
import type { Domain } from '$features/domains/domain/entities/Domain';
import { asDomainId } from '$features/domains/domain/value-objects/ids';
import type { DomainRepository } from '../ports/DomainRepository';

export type CreateDomainInput = {
  readonly name: string;
  readonly description?: string;
};

export const createDomainUseCase = (deps: {
  repository: DomainRepository;
  ids: IdGenerator;
  clock: Clock;
}) => {
  return async (input: CreateDomainInput): Promise<Domain> => {
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Domain name is required');
    }
    const now = deps.clock();
    const domain: Domain = {
      id: asDomainId(deps.ids()),
      name: trimmedName,
      description: input.description?.trim() || undefined,
      projectIds: [],
      createdAt: now,
      updatedAt: now
    };
    await deps.repository.save(domain);
    return domain;
  };
};
