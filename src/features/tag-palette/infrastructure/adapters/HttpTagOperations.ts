import type { TagOperations } from '$features/tag-palette/application/ports/TagOperations';
import type { RenameTagInput, RenameTagResult } from '$features/tag-palette/application/use-cases/RenameTag';
import { apiFetch } from '$shared/security/apiFetch';

const RENAME_URL = '/api/tag-palette/rename';

export class HttpTagOperations implements TagOperations {
  async renameTag(input: RenameTagInput): Promise<RenameTagResult> {
    const res = await apiFetch(RENAME_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tag rename failed (${res.status})${text ? `: ${text}` : ''}`);
    }
    return (await res.json()) as RenameTagResult;
  }
}
