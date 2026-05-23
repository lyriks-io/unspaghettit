import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';

export type DomainSummary = {
  readonly id: DomainId;
  readonly name: string;
  readonly description?: string;
  readonly projectCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface DomainRepository {
  list(): Promise<readonly DomainSummary[]>;
  get(id: DomainId): Promise<Domain | null>;
  save(domain: Domain): Promise<void>;
  delete(id: DomainId): Promise<void>;
}
