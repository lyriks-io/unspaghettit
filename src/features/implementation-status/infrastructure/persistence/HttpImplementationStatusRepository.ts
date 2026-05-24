import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import { apiFetch } from '$shared/security/apiFetch';

const itemUrl = (id: string) =>
  `/api/snapshots/${encodeURIComponent(id)}/implementation-status`;

export class HttpImplementationStatusRepository implements ImplementationStatusRepository {
  async get(id: FeatureId): Promise<ImplementationStatus | null> {
    const res = await apiFetch(itemUrl(id));
    if (!res.ok) return null;
    const body = (await res.json()) as ImplementationStatus | null;
    return body ?? null;
  }

  async save(_status: ImplementationStatus): Promise<void> {
    throw new Error(
      'HttpImplementationStatusRepository.save is not implemented. Status writes go through the MCP server.'
    );
  }

  async delete(_id: FeatureId): Promise<void> {
    throw new Error('HttpImplementationStatusRepository.delete is not implemented.');
  }
}
