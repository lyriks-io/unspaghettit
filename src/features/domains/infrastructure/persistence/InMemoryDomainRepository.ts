import type {
  DomainRepository,
  DomainSummary
} from '$features/domains/application/ports/DomainRepository';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';

const toSummary = (d: Domain): DomainSummary => ({
  id: d.id,
  name: d.name,
  description: d.description,
  projectCount: d.projectIds.length,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt
});

export class InMemoryDomainRepository implements DomainRepository {
  private store = new Map<DomainId, Domain>();

  async list(): Promise<readonly DomainSummary[]> {
    return Array.from(this.store.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }

  async get(id: DomainId): Promise<Domain | null> {
    return this.store.get(id) ?? null;
  }

  async save(domain: Domain): Promise<void> {
    this.store.set(domain.id, domain);
  }

  async delete(id: DomainId): Promise<void> {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}
