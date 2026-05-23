import type {
  DomainRepository,
  DomainSummary
} from '$features/domains/application/ports/DomainRepository';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import { apiFetch } from '$shared/security/apiFetch';

const BASE = '/api/domains';
const itemUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export class HttpDomainRepository implements DomainRepository {
  async list(): Promise<readonly DomainSummary[]> {
    const res = await apiFetch(BASE);
    if (!res.ok) throw new Error(`Domain list failed (${res.status})`);
    const body = (await res.json()) as { summaries: readonly DomainSummary[] };
    return body.summaries;
  }

  async get(id: DomainId): Promise<Domain | null> {
    const res = await apiFetch(itemUrl(id));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Domain get failed (${res.status})`);
    return (await res.json()) as Domain;
  }

  async save(domain: Domain): Promise<void> {
    const res = await apiFetch(itemUrl(domain.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(domain)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Domain save failed (${res.status})${text ? `: ${text}` : ''}`);
    }
  }

  async delete(id: DomainId): Promise<void> {
    const res = await apiFetch(itemUrl(id), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Domain delete failed (${res.status})`);
  }
}
