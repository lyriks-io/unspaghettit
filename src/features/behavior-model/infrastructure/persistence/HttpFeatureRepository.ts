import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { apiFetch } from '$shared/security/apiFetch';

const BASE = '/api/snapshots';
const itemUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export class HttpFeatureRepository implements FeatureRepository {
  async list(): Promise<readonly FeatureSummary[]> {
    const res = await apiFetch(BASE);
    if (!res.ok) throw new Error(`Snapshot list failed (${res.status})`);
    const body = (await res.json()) as { summaries: readonly FeatureSummary[] };
    return body.summaries;
  }

  async get(id: FeatureId): Promise<Feature | null> {
    const res = await apiFetch(itemUrl(id));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Snapshot get failed (${res.status})`);
    return (await res.json()) as Feature;
  }

  async save(feature: Feature): Promise<void> {
    const res = await apiFetch(itemUrl(feature.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feature)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Snapshot save failed (${res.status})${text ? `: ${text}` : ''}`);
    }
  }

  async delete(id: FeatureId): Promise<void> {
    const res = await apiFetch(itemUrl(id), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Snapshot delete failed (${res.status})`);
  }
}
