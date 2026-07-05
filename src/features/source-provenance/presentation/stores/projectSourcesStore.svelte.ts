import { browser } from '$app/environment';
import type { ProjectSourceMeta } from '$features/source-provenance/domain/ProjectSource';
import { apiFetch } from '$shared/security/apiFetch';

/**
 * The project's stored source documents, backing the Project Sources panel.
 * Paste stores a new immutable source in the project folder (deduplicated by
 * content hash server-side); an agent then pulls it through the MCP
 * (list_sources / get_source) to extract behavior from it.
 */
class ProjectSourcesStore {
  loading = $state(false);
  saving = $state(false);
  sources = $state<readonly ProjectSourceMeta[]>([]);
  error = $state<string | null>(null);
  /** Set after a paste that resolved to an already-stored document. */
  lastPasteDeduped = $state(false);
  private currentProjectId: string | null = null;

  async load(projectId: string): Promise<void> {
    this.currentProjectId = projectId;
    this.error = null;
    this.loading = true;
    try {
      await this.fetchOnce(projectId);
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.currentProjectId) return;
    await this.fetchOnce(this.currentProjectId);
  }

  /** Store pasted text as a new source. Returns true when the call succeeded. */
  async paste(name: string, content: string): Promise<boolean> {
    if (!this.currentProjectId) return false;
    this.saving = true;
    this.error = null;
    this.lastPasteDeduped = false;
    try {
      const res = await apiFetch(`/api/projects/${this.currentProjectId}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, content })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        this.error = body?.message ?? `Could not store the source (${res.status}).`;
        return false;
      }
      const body = (await res.json()) as { deduped?: boolean };
      this.lastPasteDeduped = body.deduped === true;
      await this.fetchOnce(this.currentProjectId);
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    } finally {
      this.saving = false;
    }
  }

  async remove(sourceId: string): Promise<boolean> {
    if (!this.currentProjectId) return false;
    this.error = null;
    try {
      const res = await apiFetch(`/api/projects/${this.currentProjectId}/sources/${sourceId}`, {
        method: 'DELETE'
      });
      if (!res.ok && res.status !== 204) {
        this.error = `Could not remove the source (${res.status}).`;
        return false;
      }
      await this.fetchOnce(this.currentProjectId);
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    }
  }

  reset(): void {
    this.currentProjectId = null;
    this.sources = [];
    this.error = null;
    this.loading = false;
    this.saving = false;
    this.lastPasteDeduped = false;
  }

  private async fetchOnce(projectId: string): Promise<void> {
    if (!browser) return;
    try {
      const res = await apiFetch(`/api/projects/${projectId}/sources`);
      if (!res.ok) {
        this.sources = [];
        return;
      }
      const body = (await res.json()) as { sources?: readonly ProjectSourceMeta[] } | null;
      if (this.currentProjectId !== projectId) return;
      this.sources = body?.sources ?? [];
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
}

export const projectSourcesStore = new ProjectSourcesStore();
