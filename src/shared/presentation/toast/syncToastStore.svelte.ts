import { subscribeSyncEvents, type SyncEvent } from '$lib/client/sync/syncEvents';

/**
 * Activity toast for out-of-band changes (currently driven by the MCP
 * server). Each MCP write fans out as a SyncEvent; this store turns those
 * into short-lived toast entries the user can dismiss or click through to
 * the affected feature/project. Three caps:
 *   - MAX visible at once (FIFO eviction so a burst of MCP writes doesn't
 *     cover the whole screen)
 *   - DEFAULT_TTL_MS auto-dismiss
 *   - Skip the very first event after subscribe (the page reload that
 *     just happened replays the most recent room state and we don't want
 *     a phantom toast on every navigation)
 */

export type SyncToast = {
  readonly id: number;
  readonly kind: SyncEvent['kind'];
  readonly entityId: string;
  readonly name?: string;
  readonly projectName?: string;
  readonly op: 'save' | 'delete';
  /** Specific change verb computed from the snapshot diff. */
  readonly changeOp?: SyncEvent['changeOp'];
  /** Breadcrumb names from the entity root inward to the leaf that changed. */
  readonly changePath?: readonly string[];
  readonly previousName?: string;
  /** Human currently driving the AI (for MCP-driven events). */
  readonly actingFor?: string;
  /** Where the "View" button navigates. Omitted for deletes. */
  readonly href?: string;
};

const MAX_VISIBLE = 4;
const DEFAULT_TTL_MS = 10_000;

const hrefFor = (evt: SyncEvent): string | undefined => {
  if (evt.op === 'delete') return undefined;
  switch (evt.kind) {
    case 'feature':
      return `/features/${evt.id}`;
    case 'project':
      return `/projects/${evt.id}`;
    case 'implementation-status':
      // The sidecar belongs to a feature; route to that feature so the
      // user lands in a useful place.
      return `/features/${evt.id}`;
  }
};

const DEDUPE_WINDOW_MS = 800;

class SyncToastStore {
  toasts = $state<SyncToast[]>([]);
  private nextId = 1;
  private subscribed = false;
  private unsubscribe: (() => void) | null = null;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /**
   * Implementation-status writes ride the same notify channel as feature
   * saves, but they fire as part of every audit pass and would spam the
   * toast feed. Tracked per-(kind:id) so a burst of identical events
   * within DEDUPE_WINDOW_MS collapses into a single toast.
   */
  private recentKeys = new Map<string, number>();
  /**
   * Per-toast auto-dismiss deadline (epoch ms) and, while the pointer/focus is
   * over a toast, the frozen time that was left — so hovering pauses the
   * countdown and resumes it on leave instead of racing a fixed timer.
   */
  private deadlines = new Map<number, number>();
  private paused = new Map<number, number>();

  /**
   * Idempotent. Call once from the root layout. Re-calls are no-ops, so
   * mounting/unmounting layout fragments won't tear the stream down.
   */
  start(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.unsubscribe = subscribeSyncEvents((evt) => this.handle(evt));
  }

  dismiss(id: number): void {
    this.clearTimers(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** Clear a toast's timer and all bookkeeping for its id. */
  private clearTimers(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.deadlines.delete(id);
    this.paused.delete(id);
  }

  /** (Re)arm the auto-dismiss timer for `ms` from now. */
  private arm(id: number, ms: number): void {
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    this.deadlines.set(id, Date.now() + ms);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ms)
    );
  }

  /** Freeze a toast's countdown while the pointer/focus is over it. */
  pause(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
    const remaining = Math.max(1_000, (this.deadlines.get(id) ?? Date.now()) - Date.now());
    this.paused.set(id, remaining);
  }

  /** Resume the countdown with the time that was left when it paused. */
  resume(id: number): void {
    if (!this.paused.has(id)) return;
    const remaining = this.paused.get(id) ?? DEFAULT_TTL_MS;
    this.paused.delete(id);
    this.arm(id, remaining);
  }

  /** Test/teardown hook. Not used in production. */
  reset(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.deadlines.clear();
    this.paused.clear();
    this.toasts = [];
    this.recentKeys.clear();
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.subscribed = false;
  }

  private handle(evt: SyncEvent): void {
    const key = `${evt.kind}:${evt.id}:${evt.op ?? 'save'}`;
    const now = Date.now();
    const seen = this.recentKeys.get(key);
    if (seen !== undefined && now - seen < DEDUPE_WINDOW_MS) {
      this.recentKeys.set(key, now);
      return;
    }
    this.recentKeys.set(key, now);

    const id = this.nextId++;
    const toast: SyncToast = {
      id,
      kind: evt.kind,
      entityId: evt.id,
      name: evt.name,
      projectName: evt.projectName,
      op: evt.op ?? 'save',
      changeOp: evt.changeOp,
      changePath: evt.changePath,
      previousName: evt.previousName,
      actingFor: evt.actingFor,
      ...(hrefFor(evt) ? { href: hrefFor(evt)! } : {})
    };
    const next = [toast, ...this.toasts].slice(0, MAX_VISIBLE);
    // Evict the toasts that fell off the cap so their timers don't fire
    // a dismiss on a no-longer-rendered id.
    const surviving = new Set(next.map((t) => t.id));
    for (const oldId of new Set([...this.timers.keys(), ...this.paused.keys()])) {
      if (!surviving.has(oldId)) this.clearTimers(oldId);
    }
    this.toasts = next;
    this.arm(id, DEFAULT_TTL_MS);
  }
}

export const syncToastStore = new SyncToastStore();
