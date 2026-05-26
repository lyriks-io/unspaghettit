import type { TagPalette } from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';
import { apiFetch } from '$shared/security/apiFetch';

const BASE = '/api/tag-palette';

export class HttpTagPaletteRepository implements TagPaletteRepository {
  async get(): Promise<TagPalette> {
    const res = await apiFetch(BASE);
    if (!res.ok) throw new Error(`Tag palette get failed (${res.status})`);
    return (await res.json()) as TagPalette;
  }

  async save(palette: TagPalette): Promise<void> {
    const res = await apiFetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(palette)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tag palette save failed (${res.status})${text ? `: ${text}` : ''}`);
    }
  }
}
