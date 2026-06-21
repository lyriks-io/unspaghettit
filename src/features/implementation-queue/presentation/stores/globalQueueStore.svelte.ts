import { browser } from '$app/environment';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
import type { QueueView } from '../../application/use-cases/ListQueue';
import type { QueueItemId } from '../../domain/entities/QueueItem';

const STORAGE_KEY = 'unspa.globalQueue';

type Persisted = {
  readonly projectId: string;
  readonly projectName: string;
  readonly open: boolean;
};

/**
 * Drives the always-visible floating queue widget (default/Expert view).
 *
 * Unlike the builder's queue (which lives on `builderModeStore` and only
 * shows while a project is selected on that page), this store has to stay
 * meaningful across EVERY route — including ones where no project is loaded
 * (the home page, the projects index). It does that by remembering the
 * last project the user touched: whenever a project or feature page loads,
 * the widget calls `setActiveProject`, which persists the id + name to
 * localStorage. On a route with no loaded project we keep showing that
 * remembered project's queue, so the corner widget is never empty just
 * because of navigation.
 *
 * The source of truth is still the repo (read via `listQueue`); the loaded
 * `projectStore` / `projectContextStore` snapshots are kept in sync on every
 * mutation so the inline "+ queue" chips flip in lockstep with the widget.
 */
class GlobalQueueStore {
  /** Project whose queue the widget currently shows (last one touched). */
  projectId = $state<string | null>(null);
  projectName = $state<string>('');
  views = $state<readonly QueueView[]>([]);
  error = $state<string | null>(null);
  /** Expanded panel vs. minimized bubble. Persisted so it survives reloads. */
  open = $state<boolean>(false);
  private hydrated = false;

  /** Restore the remembered project + open state from localStorage. Idempotent. */
  init(): void {
    if (this.hydrated || !browser) return;
    this.hydrated = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (typeof parsed.projectId === 'string') this.projectId = parsed.projectId;
      if (typeof parsed.projectName === 'string') this.projectName = parsed.projectName;
      if (typeof parsed.open === 'boolean') this.open = parsed.open;
    } catch {
      // Corrupt / blocked storage — start from a blank corner widget.
    }
    void this.refresh();
  }

  private persist(): void {
    if (!browser) return;
    try {
      if (!this.projectId) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const payload: Persisted = {
        projectId: this.projectId,
        projectName: this.projectName,
        open: this.open
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Non-fatal: the widget still works for this session without persistence.
    }
  }

  /**
   * Point the widget at a project. Called from the widget's reactive effect
   * whenever a project / feature page has a loaded project. A null argument is
   * intentionally a no-op (we keep the last remembered project) so navigating
   * to a project-less route doesn't blank the corner.
   */
  setActiveProject(id: string, name: string): void {
    const changed = this.projectId !== id;
    this.projectId = id;
    if (name) this.projectName = name;
    if (changed) this.persist();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.persist();
  }

  toggleOpen(): void {
    this.setOpen(!this.open);
  }

  /** Re-enrich `views` from the repo for the remembered project. */
  async refresh(): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) {
      this.views = [];
      return;
    }
    try {
      const container = await getBrowserContainer();
      this.views = await container.useCases.listQueue(asProjectId(projectId));
      this.error = null;
    } catch (e) {
      // The remembered project may have been deleted — forget it gracefully
      // rather than wedging the widget on a permanent error.
      this.views = [];
      this.error = (e as Error).message;
    }
  }

  async dequeue(itemId: QueueItemId): Promise<void> {
    await this.mutate((container, projectId) =>
      container.useCases.dequeueQueueItem(asProjectId(projectId), itemId)
    );
  }

  async moveTo(itemId: QueueItemId, targetIndex: number): Promise<void> {
    await this.mutate((container, projectId) =>
      container.useCases.moveQueueItem(asProjectId(projectId), itemId, {
        kind: 'to',
        targetIndex
      })
    );
  }

  /**
   * Run a queue mutation, then mirror the returned project into whichever
   * loaded store currently holds it so the inline "+ queue" chips on the
   * project / feature page reflect the change immediately (no Yjs round-trip),
   * before refreshing the widget's own enriched view.
   */
  private async mutate(
    op: (
      container: Awaited<ReturnType<typeof getBrowserContainer>>,
      projectId: string
    ) => Promise<Project>
  ): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) return;
    this.error = null;
    try {
      const container = await getBrowserContainer();
      const next = await op(container, projectId);
      this.syncLoadedStores(next);
      await this.refresh();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private syncLoadedStores(next: Project): void {
    const id = String(next.id);
    if (projectStore.project && String(projectStore.project.id) === id) {
      projectStore.project = next;
    }
    if (projectContextStore.project && String(projectContextStore.project.id) === id) {
      projectContextStore.project = next;
    }
  }
}

export const globalQueueStore = new GlobalQueueStore();
